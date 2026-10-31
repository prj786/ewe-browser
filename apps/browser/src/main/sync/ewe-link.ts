import { EventEmitter } from 'node:events'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eweCloudPath, readEweAccount } from '../ewe-account'
import { runTool, toolPath } from '../files/places'
import { NUDGE_FILE, SNAPSHOT_FILE } from './snapshot'

export interface EweSyncState {
  managed: boolean
  signedIn: boolean
  browser: boolean | null
}

const RETRY_MS = 30_000
const CONFIG_DEBOUNCE_MS = 1000
const STATE_DEBOUNCE_MS = 300

export function managedMode(env: NodeJS.ProcessEnv, hasEweConf: boolean): boolean {
  if (env.EWE_SYNC_MANAGED === '1') return true
  if (env.EWE_SYNC_MANAGED === '0') return false
  return hasEweConf && env.EWE_USER_DATA === undefined && env.EWE_SYNC_URL === undefined
}

export function effectiveSync(state: EweSyncState, toggle: boolean): boolean {
  return state.managed ? state.signedIn && state.browser !== false : toggle
}

export function parseBrowserFlag(out: string | null): boolean | null {
  const text = out?.trim() ?? ''
  if (text === 'true') return true
  if (text === 'false') return false
  return null
}

export function eweSignedIn(path = eweCloudPath()): boolean {
  const account = readEweAccount(path)
  return account !== null && account.server !== null && account.server !== ''
}

export function eweStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'ewe')
}

export function eweConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ewe')
}

export class DirWatch {
  private watcher: FSWatcher | null = null
  private retry: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly changed = new Set<string>()
  private closed = false

  constructor(
    private readonly dir: string,
    private readonly names: readonly string[],
    private readonly onChange: (names: ReadonlySet<string>) => void,
    private readonly debounceMs: number,
  ) {
    this.open()
  }

  private open(): void {
    if (this.closed) return
    if (!existsSync(this.dir)) {
      this.later()
      return
    }
    try {
      this.watcher = watch(this.dir, (_event, filename) => {
        const name = typeof filename === 'string' ? filename : null
        if (name !== null && !this.names.includes(name)) return
        for (const n of name === null ? this.names : [name]) this.changed.add(n)
        if (this.timer !== null) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = null
          const names = new Set(this.changed)
          this.changed.clear()
          this.onChange(names)
        }, this.debounceMs)
      })
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
        this.later()
      })
    } catch {
      this.watcher = null
      this.later()
    }
  }

  private later(): void {
    if (this.closed || this.retry !== null) return
    this.retry = setTimeout(() => {
      this.retry = null
      if (existsSync(this.dir)) this.onChange(new Set(this.names))
      this.open()
    }, RETRY_MS)
    this.retry.unref()
  }

  close(): void {
    this.closed = true
    this.watcher?.close()
    this.watcher = null
    if (this.retry !== null) clearTimeout(this.retry)
    if (this.timer !== null) clearTimeout(this.timer)
    this.retry = null
    this.timer = null
  }
}

export interface EweLinkOptions {
  managed: boolean
  configDir?: string
  stateDir?: string
  signedIn?: () => boolean
  browserFlag?: () => Promise<boolean | null>
}

export class EweLink extends EventEmitter<{
  change: [EweSyncState]
  nudge: []
  folders: []
}> {
  private state: EweSyncState
  private readonly configDir: string
  private readonly stateDir: string
  private readonly signedIn: () => boolean
  private readonly browserFlag: () => Promise<boolean | null>
  private readonly watches: DirWatch[] = []
  private seq = 0

  constructor(options: EweLinkOptions) {
    super()
    this.configDir = options.configDir ?? eweConfigDir()
    this.stateDir = options.stateDir ?? eweStateDir()
    this.signedIn = options.signedIn ?? (() => eweSignedIn(join(this.configDir, 'cloud.json')))
    this.browserFlag =
      options.browserFlag ??
      (async () => parseBrowserFlag(await runTool('ewe-conf', ['get', 'sync.browser'], 10_000)))
    this.state = {
      managed: options.managed,
      signedIn: options.managed && this.signedIn(),
      browser: null,
    }
  }

  static detect(): EweLink {
    return new EweLink({ managed: managedMode(process.env, toolPath('ewe-conf') !== null) })
  }

  current(): EweSyncState {
    return this.state
  }

  snapshotPath(): string {
    return join(this.stateDir, SNAPSHOT_FILE)
  }

  start(): void {
    if (this.state.managed) {
      void this.refresh()
      this.watches.push(
        new DirWatch(
          this.configDir,
          ['ewe.conf', 'cloud.json'],
          () => void this.refresh(),
          CONFIG_DEBOUNCE_MS,
        ),
      )
    }
    this.watches.push(
      new DirWatch(
        this.stateDir,
        [SNAPSHOT_FILE, NUDGE_FILE],
        (names) => {
          if (names.has(SNAPSHOT_FILE)) this.emit('folders')
          if (names.has(NUDGE_FILE) && existsSync(join(this.stateDir, NUDGE_FILE)))
            this.emit('nudge')
        },
        STATE_DEBOUNCE_MS,
      ),
    )
  }

  async refresh(): Promise<void> {
    if (!this.state.managed) return
    const seq = ++this.seq
    const signedIn = this.signedIn()
    const browser = signedIn ? await this.browserFlag() : this.state.browser
    if (seq !== this.seq) return
    const next = { managed: true, signedIn, browser }
    if (next.signedIn === this.state.signedIn && next.browser === this.state.browser) return
    this.state = next
    this.emit('change', next)
  }

  dispose(): void {
    for (const w of this.watches.splice(0)) w.close()
  }
}
