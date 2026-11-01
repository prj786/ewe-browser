import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import {
  BOOKMARKS_ROOT_ID,
  isHistoryClear,
  isRemoteTabsFile,
  isWorkspaceColor,
  keepCutoff,
  type RemoteMachine,
  type RemoteTabsFile,
  type RemoteWindow,
  type SessionWindow,
  type SyncStatus,
} from '@ewe/shared'
import type { HistoryEntry } from '../history'
import { debounce, readJson, writeJsonAtomic } from '../storage/json-file'
import type { BookmarksStore } from '../storage/bookmarks-store'
import type { HistoryStore } from '../storage/history-store'
import type { SettingsStore } from '../storage/settings-store'
import { effectiveSync, type EweSyncState } from './ewe-link'
import { legacyFileId, machineId, machineLabel } from './machine'
import {
  CLEAR_TTL,
  buildTree,
  filterHistory,
  flattenTree,
  historyRecords,
  mergeBookmarks,
  mergeHistory,
  mergeSettings,
  narrowHistory,
  sameClears,
  settingsRecords,
  type FlatBookmark,
  type Records,
} from './merge'
import { Dav, DavError, nextcloudAccount } from './webdav'

const INTERVAL = 10 * 60_000
const CHANGE_DELAY = 20_000
const TABS_HEARTBEAT = 6 * 3_600_000
const TABS_MAX_AGE = 30 * 86_400_000
const MAX_OWN_TABS = 500
const CLOCK_SAMPLES = 7
const CLOCK_APPLY = 5_000
const CLOCK_TRUST = 86_400_000
const CLOCK_KEEP = 7 * 86_400_000
export const SKEW_WARN = 5 * 60_000

interface RemoteFile<V> {
  version: 1
  machine?: unknown
  savedAt?: unknown
  data: Records<V>
  clears?: unknown
}

interface Kind<V> {
  name: 'bookmarks' | 'history' | 'settings'
  local(): Records<V>
  merge(base: Records<V>, local: Records<V>, remote: Records<V>): Records<V>
  apply(records: Records<V>, scope: string[]): void
  prepare?(remote: RemoteFile<V> | null): void
  filter?(records: Records<V>): Records<V>
  narrow?(
    base: Records<V>,
    local: Records<V>,
    remote: Records<V>,
  ): { local: Records<V>; dropped: string[] }
  extra?(): Record<string, unknown>
  extraSame?(remote: RemoteFile<V> | null): boolean
}

function isRemoteFile(value: unknown): value is RemoteFile<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === 1 && typeof v.data === 'object' && v.data !== null && !Array.isArray(v.data)
}

function isBase(value: unknown): value is Records<unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRemoteMachines(value: unknown): value is { version: 1; machines: RemoteMachine[] } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.version === 1 &&
    Array.isArray(v.machines) &&
    v.machines.every((m) => isRemoteTabsFile({ version: 1, ...(m as object) }))
  )
}

function isSavedClock(value: unknown): value is { clockOffset: number; updatedAt: number } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.clockOffset === 'number' &&
    Number.isFinite(v.clockOffset) &&
    typeof v.updatedAt === 'number' &&
    Number.isFinite(v.updatedAt)
  )
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

export function describeSkew(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  if (minutes < 120) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`
}

export function tabsFileName(id: string): string {
  return `tabs-${id}.json`
}

export function ownTabs(windows: SessionWindow[]): RemoteWindow[] {
  let budget = MAX_OWN_TABS
  const out: RemoteWindow[] = []
  for (const win of windows) {
    const spaces = win.workspaces ?? [{ id: '', name: 'Home', color: 'ewellow' as const }]
    const workspaces = spaces.map((space, index) => ({
      name: space.name,
      color: isWorkspaceColor(space.color) ? space.color : null,
      tabs:
        space.remote !== undefined
          ? []
          : win.tabs
              .filter((t) => (t.workspace ?? 0) === index && /^https?:\/\//i.test(t.url))
              .map((t) => ({ url: t.url, title: t.title, pinned: t.pinned === true })),
    }))
    const kept = workspaces
      .map((ws) => {
        const tabs = ws.tabs.slice(0, Math.max(0, budget))
        budget -= tabs.length
        return { ...ws, tabs }
      })
      .filter((ws) => ws.tabs.length > 0)
    if (kept.length > 0) out.push({ workspaces: kept })
  }
  return out
}

export interface EweSource {
  current(): EweSyncState
  on(event: 'change' | 'nudge', listener: () => void): unknown
}

export interface SyncDeps {
  userData: string
  settings: SettingsStore
  bookmarks: BookmarksStore
  history: HistoryStore
  ewe?: EweSource | undefined
}

export class SyncService extends EventEmitter<{ status: [SyncStatus]; tabs: [RemoteMachine[]] }> {
  private readonly deps: SyncDeps
  private readonly kinds: Kind<unknown>[]
  readonly id: string
  private current: SyncStatus = {
    enabled: false,
    managed: false,
    signedIn: false,
    state: 'off',
    lastSync: null,
    error: null,
    account: null,
    warning: null,
  }
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private kickTimer: NodeJS.Timeout | null = null
  private applying = false
  private disposed = false
  private tabsSource: (() => SessionWindow[]) | null = null
  private machines: RemoteMachine[] = []
  private tabsSent = ''
  private tabsSentAt = 0
  private legacyChecked = false
  private offset = 0
  private rawOffset = 0
  private readonly samples: number[] = []
  private readonly skews = new Map<string, number>()
  private readonly etags = new Map<
    string,
    { etag: string; machine: RemoteMachine | null; skew: number | null }
  >()
  private readonly writeStatus = debounce(() => {
    void writeJsonAtomic(join(this.deps.userData, 'sync', 'status.json'), {
      version: 1,
      ...this.current,
      machine: machineLabel(),
      machineId: this.id,
      clockOffset: this.offset,
      updatedAt: Date.now(),
    }).catch(() => undefined)
  }, 500)

  constructor(deps: SyncDeps) {
    super()
    this.deps = deps
    this.id = machineId(deps.userData)
    this.kinds = [
      {
        name: 'bookmarks',
        local: () => flattenTree(deps.bookmarks.root()),
        merge: (b, l, r) =>
          mergeBookmarks(
            b as Records<FlatBookmark>,
            l as Records<FlatBookmark>,
            r as Records<FlatBookmark>,
          ),
        apply: (records) =>
          deps.bookmarks.replace(
            buildTree(records as Records<FlatBookmark>, {
              ...deps.bookmarks.root(),
              id: BOOKMARKS_ROOT_ID,
            }),
          ),
      },
      {
        name: 'history',
        prepare: (remote) => {
          const clears = Array.isArray(remote?.clears) ? remote.clears.filter(isHistoryClear) : []
          deps.history.applyClears(clears, this.now())
        },
        filter: (records) =>
          filterHistory(
            records as Records<HistoryEntry>,
            deps.history.clears(this.now()),
            keepCutoff(deps.settings.get().historyDays, this.now()),
          ),
        narrow: (b, l, r) =>
          narrowHistory(
            b as Records<HistoryEntry>,
            l as Records<HistoryEntry>,
            r as Records<HistoryEntry>,
            this.now() - CLEAR_TTL,
          ),
        local: () => historyRecords(deps.history.all()),
        merge: (b, l, r) =>
          mergeHistory(
            b as Records<HistoryEntry>,
            l as Records<HistoryEntry>,
            r as Records<HistoryEntry>,
          ),
        apply: (records, scope) =>
          deps.history.applyMerged(records as Records<HistoryEntry>, scope),
        extra: () => {
          if (!deps.history.isOpen()) throw new Error('History is closed')
          return { clears: deps.history.clears(this.now()) }
        },
        extraSame: (remote) => sameClears(remote?.clears, deps.history.clears(this.now())),
      },
      {
        name: 'settings',
        local: () => settingsRecords(deps.settings.get()),
        merge: mergeSettings,
        apply: (records) => deps.settings.update(records),
      },
    ]
    const onChange = (): void => {
      if (!this.applying) this.scheduleSoon()
    }
    deps.bookmarks.on('change', onChange)
    deps.history.on('change', onChange)
    deps.settings.on('change', () => {
      if (this.wanted() !== this.current.enabled) this.configure()
      else onChange()
    })
    deps.ewe?.on('change', () => {
      const ewe = this.ewe()
      if (
        this.wanted() !== this.current.enabled ||
        ewe.managed !== this.current.managed ||
        ewe.signedIn !== this.current.signedIn
      )
        this.configure()
    })
    deps.ewe?.on('nudge', () => {
      if (this.wanted()) void this.run()
    })
  }

  private ewe(): EweSyncState {
    return this.deps.ewe?.current() ?? { managed: false, signedIn: false, browser: null }
  }

  private wanted(): boolean {
    return effectiveSync(this.ewe(), this.deps.settings.get().sync)
  }

  status(): SyncStatus {
    return this.current
  }

  now(): number {
    return Date.now() + this.offset
  }

  clockOffset(): number {
    return this.offset
  }

  remoteTabs(): RemoteMachine[] {
    return this.current.enabled ? this.machines : []
  }

  setTabsSource(source: () => SessionWindow[]): void {
    this.tabsSource = source
  }

  start(): void {
    void readJson(this.cachePath(), isRemoteMachines).then((cached) => {
      if (cached === null || this.machines.length > 0) return
      this.machines = cached.machines
      this.emit('tabs', this.remoteTabs())
    })
    void readJson(join(this.deps.userData, 'sync', 'status.json'), isSavedClock).then((saved) => {
      if (saved === null || this.samples.length > 0) return
      if (Date.now() - saved.updatedAt > CLOCK_KEEP) return
      if (Math.abs(saved.clockOffset) <= CLOCK_TRUST) this.offset = saved.clockOffset
    })
    this.configure()
  }

  observeServerTime(server: number, local: number): void {
    this.samples.push(server - local)
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift()
    this.rawOffset = median(this.samples)
    const raw = this.rawOffset
    this.offset = Math.abs(raw) > CLOCK_TRUST || Math.abs(raw) < CLOCK_APPLY ? 0 : Math.round(raw)
  }

  private configure(): void {
    const enabled = this.wanted()
    const { managed, signedIn } = this.ewe()
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    if (!enabled) {
      if (this.kickTimer !== null) clearTimeout(this.kickTimer)
      this.kickTimer = null
      this.set({ enabled: false, managed, signedIn, state: 'off', error: null })
      this.emit('tabs', [])
      return
    }
    this.set({ enabled: true, managed, signedIn, state: 'idle' })
    this.emit('tabs', this.machines)
    this.timer = setInterval(() => void this.run(), INTERVAL)
    if (this.kickTimer !== null) clearTimeout(this.kickTimer)
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      void this.run()
    }, 3000)
  }

  private scheduleSoon(): void {
    if (!this.current.enabled || this.changeTimer !== null) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      void this.run()
    }, CHANGE_DELAY)
  }

  run(): Promise<void> {
    if (this.disposed || !this.wanted()) return Promise.resolve()
    this.running ??= this.cycle().finally(() => {
      this.running = null
    })
    return this.running
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) clearInterval(this.timer)
    if (this.changeTimer !== null) clearTimeout(this.changeTimer)
    if (this.kickTimer !== null) clearTimeout(this.kickTimer)
    this.timer = null
    this.changeTimer = null
    this.kickTimer = null
    this.writeStatus.flush()
  }

  private set(patch: Partial<SyncStatus>): void {
    this.current = { ...this.current, ...patch }
    this.emit('status', this.current)
    this.writeStatus()
  }

  private basePath(name: string): string {
    return join(this.deps.userData, 'sync', `${name}.base.json`)
  }

  private cachePath(): string {
    return join(this.deps.userData, 'sync', 'tabs-remote.json')
  }

  private noteSkew(machine: unknown, savedAt: unknown, modified: number | null): number | null {
    if (typeof machine !== 'string' || typeof savedAt !== 'number' || modified === null) return null
    if (machine === machineLabel()) return null
    const skew = savedAt - modified
    this.skews.set(machine, skew)
    return skew
  }

  private warning(): string | null {
    const parts: string[] = []
    const raw = this.rawOffset
    if (Math.abs(raw) > CLOCK_TRUST)
      parts.push(
        `This computer's clock is ${describeSkew(raw)} off the Nextcloud server's. Fix the date and time; history times may be wrong.`,
      )
    else if (Math.abs(raw) > SKEW_WARN)
      parts.push(
        `This computer's clock is ${describeSkew(raw)} ${raw > 0 ? 'behind' : 'ahead of'} the Nextcloud server; history uses the server's time.`,
      )
    for (const [machine, skew] of this.skews)
      if (Math.abs(skew) > SKEW_WARN)
        parts.push(
          `The clock on ${machine} is ${describeSkew(skew)} ${skew > 0 ? 'ahead' : 'behind'}; pages deleted here may come back from there.`,
        )
    return parts.length === 0 ? null : parts.join(' ')
  }

  private async cycle(): Promise<void> {
    this.set({ state: 'syncing', error: null })
    const account = await nextcloudAccount()
    if (account === null) {
      this.set({
        state: 'error',
        account: null,
        error: this.current.managed
          ? 'Your ewe account is not available here. Open ewe-sync to sign in again.'
          : 'Sign in to your ewe account in ewe-sync first',
      })
      return
    }
    this.set({ account: `${account.user} on ${new URL(account.server).host}` })
    const dav = new Dav(account, (server, local) => this.observeServerTime(server, local))
    this.skews.clear()
    try {
      await dav.ensureFolder()
      for (const kind of this.kinds) await this.syncKind(dav, kind)
      try {
        await this.syncTabs(dav)
      } catch (error: unknown) {
        console.error('[ewe] sync tabs', error)
      }
      this.set({ state: 'idle', lastSync: this.now(), error: null, warning: this.warning() })
    } catch (error: unknown) {
      const message =
        error instanceof DavError || error instanceof Error ? error.message : 'Sync failed'
      this.set({ state: 'error', error: message })
    }
  }

  private async syncKind(dav: Dav, kind: Kind<unknown>, attempt = 0): Promise<void> {
    const file = `${kind.name}.json`
    const remoteFile = await dav.get(file)
    let parsed: RemoteFile<unknown> | null = null
    if (remoteFile !== null) {
      try {
        const value: unknown = JSON.parse(remoteFile.body)
        if (isRemoteFile(value)) parsed = value
      } catch {
        parsed = null
      }
    }
    if (parsed !== null) this.noteSkew(parsed.machine, parsed.savedAt, remoteFile?.modified ?? null)
    if (kind.prepare !== undefined) {
      this.applying = true
      try {
        kind.prepare(parsed)
      } finally {
        this.applying = false
      }
    }
    const filter = (records: Records<unknown>): Records<unknown> =>
      kind.filter === undefined ? records : kind.filter(records)
    const savedBase = parsed === null ? {} : await readJson(this.basePath(kind.name), isBase)
    const base = filter(savedBase ?? {})
    const remote = parsed === null ? {} : filter(parsed.data)
    let local = filter(kind.local())
    let dropped: string[] = []
    if (kind.narrow !== undefined) {
      const narrowed = kind.narrow(base, local, remote)
      local = narrowed.local
      dropped = narrowed.dropped
    }
    const merged = kind.merge(base, local, remote)
    if (!same(merged, local) || dropped.length > 0) {
      this.applying = true
      try {
        kind.apply(merged, [...Object.keys(local), ...dropped])
      } finally {
        this.applying = false
      }
    }
    const extraSame = kind.extraSame?.(parsed) ?? true
    if (parsed === null || !same(merged, parsed.data) || !extraSame) {
      const body = {
        version: 1,
        machine: machineLabel(),
        savedAt: this.now(),
        data: merged,
        ...kind.extra?.(),
      }
      const result = await dav.put(file, JSON.stringify(body), remoteFile?.etag ?? null)
      if (result === 'conflict') {
        if (attempt < 2) await this.syncKind(dav, kind, attempt + 1)
        return
      }
    }
    await writeJsonAtomic(this.basePath(kind.name), merged)
  }

  private async dropLegacyTabs(dav: Dav, label: string, own: string): Promise<void> {
    const legacy = `tabs-${legacyFileId(label)}.json`
    if (legacy === own) return
    const file = await dav.get(legacy)
    if (file === null) return
    try {
      const value: unknown = JSON.parse(file.body)
      if (isRemoteTabsFile(value) && value.id === undefined && value.machine === label)
        await dav.remove(legacy)
    } catch {
      return
    }
  }

  private async syncTabs(dav: Dav): Promise<void> {
    const label = machineLabel()
    const own = tabsFileName(this.id)
    const windows = ownTabs(this.tabsSource?.() ?? [])
    const key = JSON.stringify(windows)
    const now = this.now()
    if (key !== this.tabsSent || now - this.tabsSentAt > TABS_HEARTBEAT) {
      const body: RemoteTabsFile = {
        version: 1,
        id: this.id,
        machine: label,
        savedAt: now,
        windows,
      }
      await dav.putAlways(own, JSON.stringify(body))
      this.tabsSent = key
      this.tabsSentAt = now
      if (!this.legacyChecked) {
        this.legacyChecked = true
        await this.dropLegacyTabs(dav, label, own)
      }
    }
    const entries = (await dav.list()).filter(
      (e) => e.name !== own && /^tabs-[A-Za-z0-9._-]+\.json$/.test(e.name),
    )
    const machines: RemoteMachine[] = []
    for (const entry of entries) {
      const cached = this.etags.get(entry.name)
      let found: RemoteMachine | null
      let skew: number | null
      if (cached !== undefined && entry.etag !== null && cached.etag === entry.etag) {
        found = cached.machine
        skew = cached.skew
      } else {
        const file = await dav.get(entry.name)
        found = null
        skew = null
        if (file !== null) {
          try {
            const value: unknown = JSON.parse(file.body)
            if (isRemoteTabsFile(value)) {
              found = {
                ...(value.id === undefined ? {} : { id: value.id }),
                machine: value.machine,
                savedAt: value.savedAt,
                windows: value.windows,
              }
              skew = file.modified === null ? null : value.savedAt - file.modified
            }
          } catch {
            found = null
          }
        }
        const etag = entry.etag ?? file?.etag ?? null
        if (etag !== null) this.etags.set(entry.name, { etag, machine: found, skew })
      }
      if (found === null || found.id === this.id) continue
      if (found.id === undefined && found.machine === label) continue
      if (skew !== null && found.machine !== label) this.skews.set(found.machine, skew)
      if (now - found.savedAt <= TABS_MAX_AGE) machines.push(found)
    }
    machines.sort((a, b) => b.savedAt - a.savedAt || a.machine.localeCompare(b.machine))
    if (!same(machines, this.machines)) {
      this.machines = machines
      await writeJsonAtomic(this.cachePath(), { version: 1, machines })
      this.emit('tabs', this.remoteTabs())
    }
  }
}
