import type { BookmarkFolder } from './bookmarks'
import type { FsRequest, FsResult } from './files'
import type { MusicLibrary, MusicRequest } from './music'
import {
  SIDEBAR_SECTIONS,
  type Account,
  type PasswordItem,
  type ExtensionInstallRequest,
  type ExtensionsState,
  type SyncStatus,
  type PasswordStatus,
  type DownloadEntry,
  type HistorySuggestion,
  type HistoryVisit,
  type SidebarSection,
  type Rect,
  type Settings,
  type TabId,
  type ThemeTokens,
  type WindowSnapshot,
  type WorkspaceColor,
} from './models'
import { isWorkspaceColor } from './workspaces'

export type OverlayPart = 'none' | 'rail' | 'palette' | 'menu' | 'toast'
export type InternalPage = 'newtab' | 'home' | 'settings' | 'files' | 'music'
export type MenuTarget =
  { kind: 'tab'; id: TabId } | { kind: 'workspace'; id: string } | { kind: 'extension'; id: string }
export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'open' | 'show' | 'remove'
export type ToastIcon = 'star' | 'download' | 'check' | 'alert'

export type ShellCommand =
  | { type: 'tab.create'; url?: string; activate?: boolean }
  | { type: 'tab.close'; id: TabId }
  | { type: 'tab.activate'; id: TabId }
  | { type: 'tab.move'; id: TabId; index: number }
  | { type: 'tab.navigate'; id?: TabId; input: string; newTab?: boolean }
  | { type: 'tab.reopen' }
  | { type: 'tab.mute'; id: TabId; muted: boolean }
  | { type: 'tab.pin'; id: TabId; pinned: boolean }
  | { type: 'tab.duplicate'; id: TabId }
  | { type: 'tab.moveToWorkspace'; id: TabId; workspaceId?: string }
  | { type: 'tab.closeOthers'; id: TabId }
  | { type: 'tab.closeRight'; id: TabId }
  | { type: 'tab.copyUrl'; id: TabId }
  | { type: 'nav.back' }
  | { type: 'nav.forward' }
  | { type: 'nav.reload'; id?: TabId }
  | { type: 'nav.stop' }
  | { type: 'layout.report'; page: Rect | null }
  | { type: 'overlay.request'; part: OverlayPart; newTab?: boolean }
  | { type: 'menu.open'; menu: MenuTarget; x: number; y: number }
  | { type: 'workspace.create'; name?: string; color?: WorkspaceColor }
  | { type: 'workspace.activate'; id: string }
  | { type: 'workspace.update'; id: string; name?: string; color?: WorkspaceColor }
  | { type: 'workspace.remove'; id: string }
  | { type: 'workspace.mergeInto'; from: string; to: string }
  | { type: 'workspace.rename'; id: string }
  | { type: 'overlay.pin'; pinned: boolean }
  | { type: 'settings.update'; patch: Partial<Settings> }
  | { type: 'open.internal'; page: InternalPage }
  | { type: 'shortcuts.recording'; on: boolean }
  | { type: 'bookmark.toggle'; tabId?: TabId }
  | { type: 'bookmark.add'; url: string; title: string; folderId?: string }
  | { type: 'bookmark.remove'; id: string }
  | {
      type: 'bookmark.update'
      id: string
      title?: string
      url?: string
      folderId?: string
      index?: number
    }
  | { type: 'bookmark.folder.create'; title: string; parentId?: string }
  | { type: 'bookmarks.importChrome' }
  | { type: 'sidebar.toggle'; section?: SidebarSection }
  | { type: 'sidebar.close' }
  | { type: 'sidebar.resize'; width: number; commit?: boolean }
  | { type: 'download'; id: string; action: DownloadAction }
  | { type: 'downloads.clear' }
  | { type: 'history.remove'; url: string }
  | { type: 'passwords.open' }
  | { type: 'passwords.fill'; id: string; what: 'login' | 'username' | 'password' }
  | { type: 'passwords.copy'; id: string; what: 'username' | 'password' }
  | { type: 'panel.add'; url: string; title?: string }
  | { type: 'extension.activate'; id: string; x: number; y: number; width: number; height: number }
  | { type: 'extension.options'; id: string }
  | { type: 'extension.remove'; id: string }
  | { type: 'extension.confirm'; requestId: string; allow: boolean }
  | { type: 'extensions.update' }
  | { type: 'extension.install'; source: string }
  | { type: 'panel.remove'; id: string }
  | { type: 'window.new' }
  | { type: 'window.close' }
  | { type: 'window.minimize' }
  | { type: 'window.toggleMaximize' }
  | { type: 'devtools.toggle' }

export type UiEvent =
  | { type: 'focus-address' }
  | { type: 'overlay.show'; part: OverlayPart }
  | { type: 'overlay.hide' }
  | { type: 'palette.open'; query?: string; newTab?: boolean }
  | { type: 'menu.open'; menu: MenuTarget; x: number; y: number }
  | { type: 'toast'; message: string; icon?: ToastIcon }
  | { type: 'sidebar.focus' }
  | { type: 'passwords.open'; host: string }
  | { type: 'extension.install'; request: ExtensionInstallRequest }
  | { type: 'workspace.rename'; id: string }

export type ApiLayer = 'shell' | 'overlay' | 'sidebar' | 'page'

export interface BrowserApi {
  layer: ApiLayer
  send(command: ShellCommand): Promise<void>
  getState(): Promise<WindowSnapshot | null>
  getSettings(): Promise<Settings | null>
  getTheme(): Promise<ThemeTokens | null>
  getAccount(): Promise<Account | null>
  getBookmarks(): Promise<BookmarkFolder | null>
  suggest(query: string): Promise<HistorySuggestion[]>
  getDownloads(): Promise<DownloadEntry[]>
  history(query: string, limit: number): Promise<HistoryVisit[]>
  onDownloads(listener: (downloads: DownloadEntry[]) => void): () => void
  onHistory(listener: () => void): () => void
  fs<T = unknown>(request: FsRequest): Promise<FsResult<T>>
  defaultHandler(set?: boolean): Promise<{ isDefault: boolean; current: string | null } | null>
  onFsChanged(listener: (path: string) => void): () => void
  music<T = MusicLibrary>(request: MusicRequest): Promise<FsResult<T>>
  onMusic(listener: (library: MusicLibrary) => void): () => void
  getExtensions(): Promise<ExtensionsState>
  onExtensions(listener: (state: ExtensionsState) => void): () => void
  passwords(query: string): Promise<{ status: PasswordStatus; items: PasswordItem[] }>
  sync(run?: boolean): Promise<SyncStatus | null>
  onSync(listener: (status: SyncStatus) => void): () => void
  startup(on?: boolean): Promise<{ available: boolean; on: boolean } | null>
  onState(listener: (snapshot: WindowSnapshot) => void): () => void
  onSettings(listener: (settings: Settings) => void): () => void
  onTheme(listener: (theme: ThemeTokens | null) => void): () => void
  onBookmarks(listener: (root: BookmarkFolder) => void): () => void
  onUi(listener: (event: UiEvent) => void): () => void
}

export const IPC = {
  command: 'ewe:command',
  getState: 'ewe:get-state',
  getSettings: 'ewe:get-settings',
  getTheme: 'ewe:get-theme',
  getAccount: 'ewe:get-account',
  getBookmarks: 'ewe:get-bookmarks',
  suggest: 'ewe:suggest',
  getDownloads: 'ewe:get-downloads',
  history: 'ewe:history',
  downloads: 'ewe:downloads',
  historyChanged: 'ewe:history-changed',
  fs: 'ewe:fs',
  defaultHandler: 'ewe:default-handler',
  fsChanged: 'ewe:fs-changed',
  music: 'ewe:music',
  passwords: 'ewe:passwords',
  getExtensions: 'ewe:get-extensions',
  sync: 'ewe:sync',
  syncStatus: 'ewe:sync-status',
  extensions: 'ewe:extensions',
  startup: 'ewe:startup',
  musicChanged: 'ewe:music-changed',
  state: 'ewe:state',
  settings: 'ewe:settings',
  theme: 'ewe:theme',
  bookmarks: 'ewe:bookmarks',
  ui: 'ewe:ui',
} as const

const PAGE_COMMANDS = new Set<ShellCommand['type']>([
  'workspace.activate',
  'tab.create',
  'tab.activate',
  'tab.navigate',
  'tab.close',
  'nav.reload',
  'settings.update',
  'open.internal',
  'shortcuts.recording',
  'bookmarks.importChrome',
  'panel.add',
  'panel.remove',
  'extension.options',
  'extension.remove',
  'extensions.update',
  'extension.install',
])

export function isPageCommandAllowed(command: ShellCommand): boolean {
  return PAGE_COMMANDS.has(command.type)
}

function isRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  )
}

const MAX_TEXT = 16_384
const OVERLAY_PARTS = new Set<string>(['none', 'rail', 'palette', 'menu', 'toast'])

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isMenuTarget(value: unknown): value is MenuTarget {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (m.kind === 'tab' || m.kind === 'workspace' || m.kind === 'extension') && isString(m.id)
}

const DOWNLOAD_ACTIONS = new Set<string>([
  'pause',
  'resume',
  'cancel',
  'retry',
  'open',
  'show',
  'remove',
])

export function isSidebarSection(value: unknown): value is SidebarSection {
  if (typeof value !== 'string') return false
  if ((SIDEBAR_SECTIONS as readonly string[]).includes(value)) return true
  return /^panel:[a-z0-9-]{1,64}$/.test(value)
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value)
}

export function isShellCommand(value: unknown): value is ShellCommand {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  switch (c.type) {
    case 'tab.create':
      return (
        (c.url === undefined || isString(c.url)) &&
        (c.activate === undefined || typeof c.activate === 'boolean')
      )
    case 'tab.close':
    case 'tab.activate':
    case 'tab.duplicate':
    case 'tab.closeOthers':
    case 'tab.closeRight':
    case 'tab.copyUrl':
      return isString(c.id)
    case 'tab.moveToWorkspace':
      return isString(c.id) && (c.workspaceId === undefined || isString(c.workspaceId))
    case 'nav.reload':
      return c.id === undefined || isString(c.id)
    case 'menu.open':
      return isMenuTarget(c.menu) && isFiniteNumber(c.x) && isFiniteNumber(c.y)
    case 'tab.move':
      return isString(c.id) && Number.isInteger(c.index)
    case 'tab.navigate':
      return (
        (c.id === undefined || isString(c.id)) &&
        isString(c.input) &&
        (c.newTab === undefined || typeof c.newTab === 'boolean')
      )
    case 'tab.mute':
      return isString(c.id) && typeof c.muted === 'boolean'
    case 'tab.pin':
      return isString(c.id) && typeof c.pinned === 'boolean'
    case 'layout.report':
      return c.page === null || isRect(c.page)
    case 'overlay.request':
      return (
        typeof c.part === 'string' &&
        OVERLAY_PARTS.has(c.part) &&
        (c.newTab === undefined || typeof c.newTab === 'boolean')
      )
    case 'workspace.create':
      return (
        (c.name === undefined || isString(c.name)) &&
        (c.color === undefined || isWorkspaceColor(c.color))
      )
    case 'workspace.activate':
    case 'workspace.remove':
    case 'workspace.rename':
      return isString(c.id)
    case 'workspace.mergeInto':
      return isString(c.from) && isString(c.to)
    case 'workspace.update':
      return (
        isString(c.id) &&
        (c.name === undefined || isString(c.name)) &&
        (c.color === undefined || isWorkspaceColor(c.color))
      )
    case 'overlay.pin':
      return typeof c.pinned === 'boolean'
    case 'settings.update':
      return typeof c.patch === 'object' && c.patch !== null
    case 'open.internal':
      return (
        c.page === 'newtab' ||
        c.page === 'home' ||
        c.page === 'settings' ||
        c.page === 'files' ||
        c.page === 'music'
      )
    case 'shortcuts.recording':
      return typeof c.on === 'boolean'
    case 'bookmark.toggle':
      return isOptionalString(c.tabId)
    case 'bookmark.add':
      return isString(c.url) && isString(c.title) && isOptionalString(c.folderId)
    case 'bookmark.remove':
      return isString(c.id)
    case 'bookmark.update':
      return (
        isString(c.id) &&
        isOptionalString(c.title) &&
        isOptionalString(c.url) &&
        isOptionalString(c.folderId) &&
        (c.index === undefined || (Number.isInteger(c.index) && (c.index as number) >= 0))
      )
    case 'bookmark.folder.create':
      return isString(c.title) && isOptionalString(c.parentId)
    case 'sidebar.toggle':
      return c.section === undefined || isSidebarSection(c.section)
    case 'sidebar.resize':
      return isFiniteNumber(c.width) && (c.commit === undefined || typeof c.commit === 'boolean')
    case 'download':
      return isString(c.id) && typeof c.action === 'string' && DOWNLOAD_ACTIONS.has(c.action)
    case 'history.remove':
      return isString(c.url)
    case 'passwords.fill':
      return (
        isString(c.id) && (c.what === 'login' || c.what === 'username' || c.what === 'password')
      )
    case 'passwords.copy':
      return isString(c.id) && (c.what === 'username' || c.what === 'password')
    case 'panel.add':
      return isString(c.url) && /^https?:\/\//i.test(c.url) && isOptionalString(c.title)
    case 'panel.remove':
    case 'extension.options':
    case 'extension.remove':
      return isString(c.id)
    case 'extension.activate':
      return (
        isString(c.id) &&
        [c.x, c.y, c.width, c.height].every((n) => typeof n === 'number' && Number.isFinite(n))
      )
    case 'extension.install':
      return isString(c.source) && c.source.length <= 2048
    case 'extension.confirm':
      return isString(c.requestId) && typeof c.allow === 'boolean'
    case 'extensions.update':
      return true
    case 'passwords.open':
    case 'sidebar.close':
    case 'downloads.clear':
    case 'bookmarks.importChrome':
    case 'tab.reopen':
    case 'nav.back':
    case 'nav.forward':
    case 'nav.stop':
    case 'window.new':
    case 'window.close':
    case 'window.minimize':
    case 'window.toggleMaximize':
    case 'devtools.toggle':
      return true
    default:
      return false
  }
}
