import type { BookmarkFolder } from './bookmarks'
import type { EweSyncRequest, FsRequest, FsResult } from './files'
import type { HistoryRequest, RemoteMachine } from './history'
import type { HomeRequest } from './home'
import type { FindResult, PageMenu, SwipeDirection } from './input'
import type { MusicLibrary, MusicRequest } from './music'
import {
  SIDEBAR_SECTIONS,
  type Account,
  type ExtensionInstallRequest,
  type ExtensionsState,
  type SyncStatus,
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
import {
  isSafePromptAction,
  isSafeSheetAction,
  type SafeMenu,
  type SafePrompt,
  type SafePromptAction,
  type SafeSheet,
  type SafeSheetAction,
  type SafeSuggestKey,
} from './safe'
import { isWorkspaceColor } from './workspaces'
import {
  isPermissionDecision,
  isPermissionKind,
  isPermissionValue,
  isWebOrigin,
  type PermissionDecision,
  type PermissionKind,
  type PermissionPrompt,
  type PermissionsRequest,
  type PermissionValue,
  type SiteInfo,
} from './privacy'

export type OverlayPart =
  | 'none'
  | 'rail'
  | 'palette'
  | 'menu'
  | 'toast'
  | 'prompt'
  | 'suggest'
  | 'sheet'
  | 'find'
  | 'swipe'
  | 'permission'
  | 'siteinfo'
export type InternalPage = 'newtab' | 'home' | 'settings' | 'files' | 'music' | 'history'
export type MenuTarget =
  | { kind: 'tab'; id: TabId }
  | { kind: 'workspace'; id: string }
  | { kind: 'extension'; id: string }
  | { kind: 'page'; id: string }
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
  | { type: 'music.play'; path: string }
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
  | { type: 'safe.choose'; requestId: string; id: string }
  | { type: 'safe.generate'; requestId: string }
  | { type: 'safe.unlock'; requestId: string }
  | { type: 'safe.openApp' }
  | { type: 'safe.prompt'; promptId: string; action: SafePromptAction }
  | { type: 'safe.fit'; requestId: string; height: number }
  | { type: 'safe.selected'; requestId: string; selected: boolean }
  | { type: 'safe.close'; requestId: string }
  | { type: 'safe.passkey'; requestId: string; credentialId: string }
  | { type: 'safe.sheet'; sheetId: string; action: SafeSheetAction; credentialId?: string }
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
  | { type: 'find.query'; text: string }
  | { type: 'find.step'; forward: boolean }
  | { type: 'find.close' }
  | { type: 'page.menu.run'; menuId: string; action: string }
  | { type: 'permission.decide'; promptId: string; decision: PermissionDecision }
  | { type: 'permission.fit'; promptId: string; height: number }
  | { type: 'permission.set'; origin: string; kind: PermissionKind; value: PermissionValue }
  | { type: 'permission.forget'; origin: string }
  | { type: 'siteinfo.open'; x: number; y: number }
  | { type: 'site.clearData'; origin: string }
  | { type: 'https.allow'; url: string }

export type UiEvent =
  | { type: 'focus-address' }
  | { type: 'overlay.show'; part: OverlayPart }
  | { type: 'overlay.hide' }
  | { type: 'palette.open'; query?: string; newTab?: boolean }
  | { type: 'menu.open'; menu: MenuTarget; x: number; y: number }
  | { type: 'toast'; message: string; icon?: ToastIcon }
  | { type: 'sidebar.focus' }
  | { type: 'safe.suggest'; menu: SafeMenu }
  | { type: 'safe.suggest.key'; requestId: string; key: SafeSuggestKey }
  | { type: 'safe.suggest.filter'; requestId: string; text: string }
  | { type: 'safe.suggest.moved'; requestId: string }
  | { type: 'safe.sheet'; sheet: SafeSheet }
  | { type: 'safe.prompt'; prompt: SafePrompt }
  | { type: 'extension.install'; request: ExtensionInstallRequest }
  | { type: 'workspace.rename'; id: string }
  | { type: 'music.play'; path: string }
  | { type: 'find.open'; query: string }
  | { type: 'find.result'; result: FindResult | null }
  | { type: 'swipe'; dir: SwipeDirection; progress: number; done?: boolean }
  | { type: 'page.menu'; menu: PageMenu }
  | { type: 'permission.prompt'; prompt: PermissionPrompt }
  | { type: 'siteinfo.open'; info: SiteInfo; x: number; y: number }
  | { type: 'siteinfo.update'; info: SiteInfo }

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
  historyPage<T = unknown>(request: HistoryRequest): Promise<FsResult<T>>
  remoteTabs(): Promise<RemoteMachine[]>
  onDownloads(listener: (downloads: DownloadEntry[]) => void): () => void
  onHistory(listener: () => void): () => void
  fs<T = unknown>(request: FsRequest): Promise<FsResult<T>>
  defaultHandler(set?: boolean): Promise<{ isDefault: boolean; current: string | null } | null>
  onFsChanged(listener: (path: string) => void): () => void
  onPlacesChanged(listener: () => void): () => void
  eweSync(request: EweSyncRequest): Promise<boolean>
  music<T = MusicLibrary>(request: MusicRequest): Promise<FsResult<T>>
  home<T = unknown>(request: HomeRequest): Promise<FsResult<T>>
  onHomeChanged(listener: () => void): () => void
  onMusic(listener: (library: MusicLibrary) => void): () => void
  getExtensions(): Promise<ExtensionsState>
  onExtensions(listener: (state: ExtensionsState) => void): () => void
  sync(run?: boolean): Promise<SyncStatus | null>
  onSync(listener: (status: SyncStatus) => void): () => void
  startup(on?: boolean): Promise<{ available: boolean; on: boolean } | null>
  onState(listener: (snapshot: WindowSnapshot) => void): () => void
  onSettings(listener: (settings: Settings) => void): () => void
  onTheme(listener: (theme: ThemeTokens | null) => void): () => void
  onBookmarks(listener: (root: BookmarkFolder) => void): () => void
  onUi(listener: (event: UiEvent) => void): () => void
  permissions<T = unknown>(request: PermissionsRequest): Promise<T | null>
  onPermissions(listener: () => void): () => void
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
  historyPage: 'ewe:history-page',
  remoteTabs: 'ewe:remote-tabs',
  fs: 'ewe:fs',
  defaultHandler: 'ewe:default-handler',
  fsChanged: 'ewe:fs-changed',
  placesChanged: 'ewe:places-changed',
  eweSync: 'ewe:ewe-sync',
  music: 'ewe:music',
  home: 'ewe:home',
  homeChanged: 'ewe:home-changed',
  safePage: 'ewe:safe-page',
  safeFill: 'ewe:safe-fill',
  safeSuggest: 'ewe:safe-suggest',
  safePasskey: 'ewe:safe-passkey',
  safeWalletFill: 'ewe:safe-wallet-fill',
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
  pageInput: 'ewe:page-input',
  pageAction: 'ewe:page-action',
  permissions: 'ewe:permissions',
  permissionsChanged: 'ewe:permissions-changed',
  privacyFrame: 'ewe:privacy-frame',
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
  'music.play',
  'shortcuts.recording',
  'bookmarks.importChrome',
  'panel.add',
  'panel.remove',
  'extension.options',
  'extension.remove',
  'extensions.update',
  'extension.install',
  'permission.set',
  'permission.forget',
  'https.allow',
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
  return (
    (m.kind === 'tab' || m.kind === 'workspace' || m.kind === 'extension' || m.kind === 'page') &&
    isString(m.id)
  )
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
        c.page === 'music' ||
        c.page === 'history'
      )
    case 'music.play':
      return isString(c.path) && c.path.startsWith('/')
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
    case 'safe.choose':
      return isString(c.requestId) && isString(c.id)
    case 'safe.generate':
    case 'safe.unlock':
      return isString(c.requestId)
    case 'safe.prompt':
      return isString(c.promptId) && isSafePromptAction(c.action)
    case 'safe.openApp':
      return true
    case 'safe.fit':
      return isString(c.requestId) && typeof c.height === 'number' && Number.isFinite(c.height)
    case 'safe.selected':
      return isString(c.requestId) && typeof c.selected === 'boolean'
    case 'safe.close':
      return isString(c.requestId)
    case 'safe.passkey':
      return isString(c.requestId) && isString(c.credentialId)
    case 'safe.sheet':
      return isString(c.sheetId) && isSafeSheetAction(c.action) && isOptionalString(c.credentialId)
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
    case 'permission.decide':
      return isString(c.promptId) && isPermissionDecision(c.decision)
    case 'permission.fit':
      return isString(c.promptId) && isFiniteNumber(c.height)
    case 'permission.set':
      return isWebOrigin(c.origin) && isPermissionKind(c.kind) && isPermissionValue(c.value)
    case 'permission.forget':
    case 'site.clearData':
      return isWebOrigin(c.origin)
    case 'siteinfo.open':
      return isFiniteNumber(c.x) && isFiniteNumber(c.y)
    case 'https.allow':
      return isString(c.url) && /^http:\/\//i.test(c.url) && c.url.length <= 4096
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
    case 'find.close':
      return true
    case 'find.query':
      return typeof c.text === 'string' && c.text.length <= 1000
    case 'find.step':
      return typeof c.forward === 'boolean'
    case 'page.menu.run':
      return isString(c.menuId) && typeof c.action === 'string' && c.action.length <= 64
    default:
      return false
  }
}
