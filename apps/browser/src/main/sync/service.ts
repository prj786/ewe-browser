import { EventEmitter } from 'node:events'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { BOOKMARKS_ROOT_ID, type SyncStatus } from '@ewe/shared'
import type { HistoryEntry } from '../history'
import { readJson, writeJsonAtomic } from '../storage/json-file'
import type { BookmarksStore } from '../storage/bookmarks-store'
import type { HistoryStore } from '../storage/history-store'
import type { SettingsStore } from '../storage/settings-store'
import {
  buildTree,
  flattenTree,
  historyRecords,
  mergeBookmarks,
  mergeHistory,
  mergeSettings,
  settingsRecords,
  type FlatBookmark,
  type Records,
} from './merge'
import { Dav, DavError, nextcloudAccount } from './webdav'

const INTERVAL = 10 * 60_000
const CHANGE_DELAY = 20_000

interface Kind<V> {
  name: 'bookmarks' | 'history' | 'settings'
  local(): Records<V>
  merge(base: Records<V>, local: Records<V>, remote: Records<V>): Records<V>
  apply(records: Records<V>): void
}

interface RemoteFile<V> {
  version: 1
  machine: string
  savedAt: number
  data: Records<V>
}

function isRemoteFile(value: unknown): value is RemoteFile<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === 1 && typeof v.data === 'object' && v.data !== null && !Array.isArray(v.data)
}

function isBase(value: unknown): value is Records<unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface SyncDeps {
  userData: string
  settings: SettingsStore
  bookmarks: BookmarksStore
  history: HistoryStore
}

export class SyncService extends EventEmitter<{ status: [SyncStatus] }> {
  private readonly deps: SyncDeps
  private readonly kinds: Kind<unknown>[]
  private current: SyncStatus = {
    enabled: false,
    state: 'off',
    lastSync: null,
    error: null,
    account: null,
  }
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private applying = false

  constructor(deps: SyncDeps) {
    super()
    this.deps = deps
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
        local: () => historyRecords(deps.history.all()),
        merge: (b, l, r) =>
          mergeHistory(
            b as Records<HistoryEntry>,
            l as Records<HistoryEntry>,
            r as Records<HistoryEntry>,
          ),
        apply: (records) =>
          deps.history.replaceAll(Object.values(records as Records<HistoryEntry>)),
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
    deps.settings.on('change', (next) => {
      if (next.sync !== this.current.enabled) this.configure()
      else onChange()
    })
  }

  status(): SyncStatus {
    return this.current
  }

  start(): void {
    this.configure()
  }

  private configure(): void {
    const enabled = this.deps.settings.get().sync
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    if (!enabled) {
      this.set({ enabled: false, state: 'off', error: null })
      return
    }
    this.set({ enabled: true, state: 'idle' })
    this.timer = setInterval(() => void this.run(), INTERVAL)
    setTimeout(() => void this.run(), 3000)
  }

  private scheduleSoon(): void {
    if (!this.current.enabled || this.changeTimer !== null) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      void this.run()
    }, CHANGE_DELAY)
  }

  run(): Promise<void> {
    if (!this.deps.settings.get().sync) return Promise.resolve()
    this.running ??= this.cycle().finally(() => {
      this.running = null
    })
    return this.running
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer)
    if (this.changeTimer !== null) clearTimeout(this.changeTimer)
  }

  private set(patch: Partial<SyncStatus>): void {
    this.current = { ...this.current, ...patch }
    this.emit('status', this.current)
  }

  private basePath(name: string): string {
    return join(this.deps.userData, 'sync', `${name}.base.json`)
  }

  private async cycle(): Promise<void> {
    this.set({ state: 'syncing', error: null })
    const account = await nextcloudAccount()
    if (account === null) {
      this.set({
        state: 'error',
        account: null,
        error: 'Sign in to Nextcloud in ewe Settings first',
      })
      return
    }
    this.set({ account: `${account.user} on ${new URL(account.server).host}` })
    const dav = new Dav(account)
    try {
      await dav.ensureFolder()
      for (const kind of this.kinds) await this.syncKind(dav, kind)
      this.set({ state: 'idle', lastSync: Date.now(), error: null })
    } catch (error: unknown) {
      const message =
        error instanceof DavError || error instanceof Error ? error.message : 'Sync failed'
      this.set({ state: 'error', error: message })
    }
  }

  private async syncKind(dav: Dav, kind: Kind<unknown>, attempt = 0): Promise<void> {
    const file = `${kind.name}.json`
    const remoteFile = await dav.get(file)
    let remote: Records<unknown> | null = null
    if (remoteFile !== null) {
      try {
        const parsed: unknown = JSON.parse(remoteFile.body)
        if (isRemoteFile(parsed)) remote = parsed.data
      } catch {
        remote = null
      }
    }
    const base = (await readJson(this.basePath(kind.name), isBase)) ?? {}
    const local = kind.local()
    const merged = kind.merge(base, local, remote ?? {})
    if (!same(merged, local)) {
      this.applying = true
      try {
        kind.apply(merged)
      } finally {
        this.applying = false
      }
    }
    if (remote === null || !same(merged, remote)) {
      const body: RemoteFile<unknown> = {
        version: 1,
        machine: hostname(),
        savedAt: Date.now(),
        data: merged,
      }
      const result = await dav.put(file, JSON.stringify(body), remoteFile?.etag ?? null)
      if (result === 'conflict') {
        if (attempt < 2) await this.syncKind(dav, kind, attempt + 1)
        return
      }
    }
    await writeJsonAtomic(this.basePath(kind.name), merged)
  }
}
