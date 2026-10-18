import { ipcMain, webContents, type Session } from 'electron'
import {
  HISTORY_PAGE_LIMIT,
  HISTORY_URL,
  IPC,
  isHistoryKeepDays,
  isHistoryRequest,
  parseHistoryQuery,
  rangeStart,
  type ClearDataResult,
  type FsResult,
  type HistoryRequest,
  type HistorySummary,
} from '@ewe/shared'
import { senderFrameUrl } from './ipc'
import type { DownloadsStore } from './storage/downloads-store'
import type { HistoryStore } from './storage/history-store'
import type { SettingsStore } from './storage/settings-store'
import type { SyncService } from './sync/service'
import type { WindowManager } from './window-manager'

const DAY = 86_400_000
const PUSH_DELAY = 400

export const SITE_DATA_TYPES = [
  'cookies',
  'localStorage',
  'indexedDB',
  'serviceWorkers',
  'fileSystems',
  'backgroundFetch',
  'webSQL',
] as const

export interface HistoryServiceDeps {
  history: HistoryStore
  settings: SettingsStore
  downloads: DownloadsStore
  sync: SyncService
  sessions(): Session[]
  extensionOrigins(): string[]
  onHistoryCleared?: ((from: number, to: number) => void) | undefined
}

export class HistoryService {
  private readonly deps: HistoryServiceDeps
  private retentionTimer: NodeJS.Timeout | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private keepDays: number

  constructor(deps: HistoryServiceDeps) {
    this.deps = deps
    this.keepDays = deps.settings.get().historyDays
  }

  start(): void {
    this.enforce()
    this.retentionTimer = setInterval(() => this.enforce(), DAY)
    this.retentionTimer.unref()
    this.deps.settings.on('change', (next) => {
      if (next.historyDays !== this.keepDays) {
        this.keepDays = next.historyDays
        this.enforce()
      }
    })
    this.deps.history.on('change', () => this.push())
    this.deps.sync.on('tabs', () => this.push())
    this.deps.sync.on('status', () => this.push())
  }

  dispose(): void {
    if (this.retentionTimer !== null) clearInterval(this.retentionTimer)
    if (this.pushTimer !== null) clearTimeout(this.pushTimer)
  }

  enforce(now = this.deps.history.now()): number {
    return this.deps.history.enforceRetention(this.deps.settings.get().historyDays, now)
  }

  private push(): void {
    if (this.pushTimer !== null) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      for (const wc of webContents.getAllWebContents())
        if (!wc.isDestroyed() && wc.getURL().startsWith(HISTORY_URL)) wc.send(IPC.historyChanged)
    }, PUSH_DELAY)
  }

  summary(): HistorySummary {
    const days = this.deps.settings.get().historyDays
    const status = this.deps.sync.status()
    return {
      pages: this.deps.history.size(),
      keepDays: isHistoryKeepDays(days) ? days : 0,
      sync: status.enabled,
      lastSync: status.lastSync,
      warning: status.enabled ? (status.warning ?? null) : null,
      machines: this.deps.sync.remoteTabs(),
    }
  }

  async handle(request: HistoryRequest, now = this.deps.history.now()): Promise<FsResult> {
    switch (request.op) {
      case 'rows': {
        const parsed = parseHistoryQuery(request.query)
        return {
          ok: true,
          value: this.deps.history.rows(parsed.query, {
            site: request.site ?? parsed.site,
            before: request.before,
            limit: Math.min(request.limit ?? 100, HISTORY_PAGE_LIMIT),
          }),
        }
      }
      case 'summary':
        return { ok: true, value: this.summary() }
      case 'delete': {
        const removed = this.deps.history.clearMany(
          request.items.map((item) => ({ from: item.from, to: item.to, url: item.url })),
          now,
        )
        return { ok: true, value: { removed } }
      }
      case 'siteCount':
        return { ok: true, value: this.deps.history.siteCount(request.site) }
      case 'deleteSite': {
        const hosts = this.deps.history.siteHosts(request.site).map((h) => h.host)
        const removed = this.deps.history.clear({ from: 0, to: now, site: request.site }, now)
        let siteData = false
        if (request.siteData) {
          const origins = [...new Set([request.site, `www.${request.site}`, ...hosts])].flatMap(
            (host) => [`https://${host}`, `http://${host}`],
          )
          await this.forEachSession((s) =>
            s.clearData({ dataTypes: [...SITE_DATA_TYPES, 'cache'], origins }),
          )
          siteData = true
        }
        return { ok: true, value: { removed, siteData } }
      }
      case 'clear':
        return { ok: true, value: await this.clearData(request, now) }
      case 'keep':
        this.deps.settings.update({ historyDays: request.days })
        this.enforce(now)
        return { ok: true, value: request.days }
    }
  }

  async clearData(
    request: Extract<HistoryRequest, { op: 'clear' }>,
    now = this.deps.history.now(),
  ): Promise<ClearDataResult> {
    const all = request.range === 'all'
    const from = rangeStart(request.range, now)
    const result: ClearDataResult = { history: 0, downloads: 0, cookies: false, cache: false }
    if (request.history) {
      result.history = this.deps.history.clear({ from, to: now }, now)
      this.deps.onHistoryCleared?.(from, now)
    }
    if (request.downloads) result.downloads = this.deps.downloads.clearRange(from, now)
    if (request.cookies && all) {
      const excluded = this.deps.extensionOrigins()
      await this.forEachSession((s) =>
        s.clearData({
          dataTypes: [...SITE_DATA_TYPES],
          ...(excluded.length > 0 ? { excludeOrigins: excluded } : {}),
        }),
      )
      result.cookies = true
    }
    if (request.cache && all) {
      await this.forEachSession(async (s) => {
        await s.clearCache()
        await s.clearCodeCaches({})
      })
      result.cache = true
    }
    return result
  }

  private async forEachSession(fn: (session: Session) => Promise<void>): Promise<void> {
    for (const session of this.deps.sessions()) {
      try {
        await fn(session)
      } catch (error: unknown) {
        console.error('[ewe] clear data', error)
      }
    }
  }
}

export function registerHistoryIpc(
  windows: WindowManager,
  service: HistoryService,
  sync: SyncService,
): void {
  ipcMain.handle(IPC.historyPage, async (event, raw: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return { ok: false, error: 'Not allowed' }
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(HISTORY_URL) ?? false)) return { ok: false, error: 'Not allowed' }
    if (!isHistoryRequest(raw)) return { ok: false, error: 'Bad request' }
    try {
      return await service.handle(raw)
    } catch (error: unknown) {
      console.error('[ewe] history page', error)
      return { ok: false, error: 'History could not be changed' }
    }
  })

  ipcMain.handle(IPC.remoteTabs, (event) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null) return []
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (frameUrl === null) return []
    if (owner.layer === 'page' && !frameUrl.startsWith(HISTORY_URL)) return []
    return sync.remoteTabs()
  })
}
