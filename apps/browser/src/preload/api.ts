import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Account,
  type ApiLayer,
  type BookmarkFolder,
  type DownloadEntry,
  type FsRequest,
  type HomeRequest,
  type MusicLibrary,
  type MusicRequest,
  type PasswordItem,
  type ExtensionsState,
  type SyncStatus,
  type PasswordStatus,
  type FsResult,
  type HistoryVisit,
  type HistorySuggestion,
  type BrowserApi,
  type Settings,
  type ShellCommand,
  type ThemeTokens,
  type UiEvent,
  type WindowSnapshot,
} from '@ewe/shared'

function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export function createApi(layer: ApiLayer): BrowserApi {
  return {
    layer,
    send: (command: ShellCommand) => ipcRenderer.invoke(IPC.command, command) as Promise<void>,
    getState: () => ipcRenderer.invoke(IPC.getState) as Promise<WindowSnapshot | null>,
    getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<Settings | null>,
    getTheme: () => ipcRenderer.invoke(IPC.getTheme) as Promise<ThemeTokens | null>,
    getAccount: () => ipcRenderer.invoke(IPC.getAccount) as Promise<Account | null>,
    getBookmarks: () => ipcRenderer.invoke(IPC.getBookmarks) as Promise<BookmarkFolder | null>,
    suggest: (query: string) =>
      ipcRenderer.invoke(IPC.suggest, query) as Promise<HistorySuggestion[]>,
    getDownloads: () => ipcRenderer.invoke(IPC.getDownloads) as Promise<DownloadEntry[]>,
    history: (query: string, limit: number) =>
      ipcRenderer.invoke(IPC.history, query, limit) as Promise<HistoryVisit[]>,
    onDownloads: (listener) => subscribe(IPC.downloads, (p) => listener(p as DownloadEntry[])),
    onHistory: (listener) => subscribe(IPC.historyChanged, () => listener()),
    fs: <T>(request: FsRequest) => ipcRenderer.invoke(IPC.fs, request) as Promise<FsResult<T>>,
    defaultHandler: (set?: boolean) =>
      ipcRenderer.invoke(IPC.defaultHandler, set) as Promise<{
        isDefault: boolean
        current: string | null
      } | null>,
    music: <T>(request: MusicRequest) =>
      ipcRenderer.invoke(IPC.music, request) as Promise<FsResult<T>>,
    home: <T>(request: HomeRequest) =>
      ipcRenderer.invoke(IPC.home, request) as Promise<FsResult<T>>,
    onHomeChanged: (listener) => subscribe(IPC.homeChanged, () => listener()),
    getExtensions: () => ipcRenderer.invoke(IPC.getExtensions) as Promise<ExtensionsState>,
    onExtensions: (listener) => subscribe(IPC.extensions, (p) => listener(p as ExtensionsState)),
    passwords: (query) =>
      ipcRenderer.invoke(IPC.passwords, query) as Promise<{
        status: PasswordStatus
        items: PasswordItem[]
      }>,
    sync: (run) => ipcRenderer.invoke(IPC.sync, run) as Promise<SyncStatus | null>,
    onSync: (listener) => subscribe(IPC.syncStatus, (p) => listener(p as SyncStatus)),
    startup: (on) =>
      ipcRenderer.invoke(IPC.startup, on) as Promise<{ available: boolean; on: boolean } | null>,
    onMusic: (listener) => subscribe(IPC.musicChanged, (p) => listener(p as MusicLibrary)),
    onFsChanged: (listener) => subscribe(IPC.fsChanged, (p) => listener(p as string)),
    onState: (listener) => subscribe(IPC.state, (p) => listener(p as WindowSnapshot)),
    onSettings: (listener) => subscribe(IPC.settings, (p) => listener(p as Settings)),
    onTheme: (listener) => subscribe(IPC.theme, (p) => listener(p as ThemeTokens | null)),
    onBookmarks: (listener) => subscribe(IPC.bookmarks, (p) => listener(p as BookmarkFolder)),
    onUi: (listener) => subscribe(IPC.ui, (p) => listener(p as UiEvent)),
  }
}

export function exposeApi(layer: ApiLayer): void {
  contextBridge.exposeInMainWorld('ewe', createApi(layer))
}
