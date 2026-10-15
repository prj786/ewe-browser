import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  FILES_PAGE_URL,
  HOME_URL,
  IPC,
  MUSIC_PAGE_URL,
  SETTINGS_URL,
  isMusicRequest,
  isFsRequest,
  isHomeRequest,
  isShellCommand,
  type Account,
  type ApiLayer,
  type ThemeTokens,
} from '@ewe/shared'
import type { DefaultHandler } from './files/default-handler'
import type { FileService } from './files/service'
import type { HomeService } from './home/service'
import type { MusicLibraryStore } from './media/library'
import type { ExtensionHost } from './extensions'
import { registerSafeIpc } from './safe/ipc'
import type { SafeService } from './safe/service'
import type { SyncService } from './sync/service'
import { matchPasswords } from './passwords'
import type { Startup } from './startup'
import type { BookmarksStore } from './storage/bookmarks-store'
import type { DownloadsStore } from './storage/downloads-store'
import type { HistoryStore } from './storage/history-store'
import type { RecentStore } from './storage/recent-store'
import type { SettingsStore } from './storage/settings-store'
import type { WindowManager } from './window-manager'

export function senderFrameUrl(event: IpcMainInvokeEvent, layer: ApiLayer): string | null {
  const frame = event.senderFrame
  if (frame === null || frame !== event.sender.mainFrame) return null
  if (layer === 'page' && !frame.url.startsWith('app://')) return null
  return frame.url
}

export interface IpcDeps {
  safe: SafeService
  sync: SyncService
  extensions: ExtensionHost
  startup: Startup
  getTheme(): ThemeTokens | null
  getAccount(): Account | null
  history: HistoryStore
  bookmarks: BookmarksStore
  downloads: DownloadsStore
  files: FileService
  defaultHandler: DefaultHandler
  music: MusicLibraryStore
  home: HomeService
  recents: RecentStore
}

export function registerIpc(windows: WindowManager, settings: SettingsStore, deps: IpcDeps): void {
  ipcMain.handle(IPC.command, (event, raw: unknown) => {
    if (!isShellCommand(raw)) return
    const owner = windows.fromContents(event.sender)
    if (owner === null) return
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (frameUrl === null) return
    owner.controller.dispatch(raw, owner.layer, event.sender, frameUrl)
  })

  ipcMain.handle(IPC.getState, (event) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || senderFrameUrl(event, owner.layer) === null) return null
    return owner.controller.snapshot()
  })

  ipcMain.handle(IPC.getSettings, (event) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || senderFrameUrl(event, owner.layer) === null) return null
    return settings.get()
  })

  ipcMain.handle(IPC.getTheme, (event) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || senderFrameUrl(event, owner.layer) === null) return null
    return deps.getTheme()
  })

  ipcMain.handle(IPC.getAccount, (event) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || senderFrameUrl(event, owner.layer) === null) return null
    return deps.getAccount()
  })

  ipcMain.handle(IPC.getBookmarks, (event) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || senderFrameUrl(event, owner.layer) === null) return null
    return deps.bookmarks.root()
  })

  ipcMain.handle(IPC.suggest, (event, raw: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || senderFrameUrl(event, owner.layer) === null) return []
    if (typeof raw !== 'string' || raw.length > 200) return []
    return deps.history.suggest(raw)
  })

  ipcMain.handle(IPC.fs, async (event, raw: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return { ok: false, error: 'Not allowed' }
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(FILES_PAGE_URL) ?? false)) return { ok: false, error: 'Not allowed' }
    if (!isFsRequest(raw)) return { ok: false, error: 'Bad request' }
    return deps.files.handle(raw, event.sender)
  })

  ipcMain.handle(IPC.music, (event, raw: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return { ok: false, error: 'Not allowed' }
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(MUSIC_PAGE_URL) ?? false)) return { ok: false, error: 'Not allowed' }
    if (!isMusicRequest(raw)) return { ok: false, error: 'Bad request' }
    if (raw.op === 'token') return { ok: true, value: deps.files.token }
    if (raw.op === 'played') {
      if (deps.music.track(raw.path) !== undefined) deps.recents.record(raw.path, 'played')
      return { ok: true, value: true }
    }
    const library = deps.music.snapshot()
    if (raw.op === 'rescan' || library.scannedAt === null) void deps.music.scan()
    return { ok: true, value: deps.music.snapshot() }
  })

  ipcMain.handle(IPC.home, (event, raw: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return { ok: false, error: 'Not allowed' }
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(HOME_URL) ?? false)) return { ok: false, error: 'Not allowed' }
    if (!isHomeRequest(raw)) return { ok: false, error: 'Bad request' }
    return deps.home.handle(raw)
  })

  ipcMain.handle(IPC.getExtensions, (event) => {
    const owner = windows.fromContents(event.sender)
    const empty = { partition: '', tabId: null, list: [] }
    if (owner === null) return empty
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (frameUrl === null) return empty
    if (owner.layer === 'page' && !frameUrl.startsWith(SETTINGS_URL)) return empty
    return deps.extensions.state()
  })

  ipcMain.handle(IPC.passwords, async (event, query: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'overlay') return null
    return matchPasswords(owner.controller.activeHost(), typeof query === 'string' ? query : '')
  })

  registerSafeIpc(windows, deps.safe)

  ipcMain.handle(IPC.sync, async (event, run: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return null
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(SETTINGS_URL) ?? false)) return null
    if (run === true) await deps.sync.run()
    return deps.sync.status()
  })

  ipcMain.handle(IPC.startup, (event, on: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return null
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(SETTINGS_URL) ?? false)) return null
    return typeof on === 'boolean' ? deps.startup.set(on) : deps.startup.status()
  })

  ipcMain.handle(IPC.defaultHandler, (event, set: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner?.layer !== 'page') return null
    const frameUrl = senderFrameUrl(event, owner.layer)
    if (!(frameUrl?.startsWith(SETTINGS_URL) ?? false)) return null
    if (typeof set === 'boolean') return deps.defaultHandler.set(set)
    return deps.defaultHandler.status()
  })

  ipcMain.handle(IPC.getDownloads, (event) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || owner.layer === 'page' || senderFrameUrl(event, owner.layer) === null)
      return []
    return deps.downloads.list()
  })

  ipcMain.handle(IPC.history, (event, query: unknown, limit: unknown) => {
    const owner = windows.fromContents(event.sender)
    if (owner === null || owner.layer === 'page' || senderFrameUrl(event, owner.layer) === null)
      return []
    if (typeof query !== 'string' || query.length > 200) return []
    const n = typeof limit === 'number' && Number.isInteger(limit) ? limit : 200
    return deps.history.list(query, Math.min(Math.max(1, n), 1000))
  })
}
