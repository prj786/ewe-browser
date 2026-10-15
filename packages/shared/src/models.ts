import type { ShortcutMap } from './shortcuts'

export type TabId = string
export type WindowId = number

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export type TabKind = 'page' | 'newtab' | 'home' | 'files' | 'music' | 'internal'

export type WorkspaceColor =
  'ewellow' | 'amber' | 'coral' | 'rose' | 'violet' | 'sky' | 'mint' | 'slate'

export interface Workspace {
  id: string
  name: string
  color: WorkspaceColor
}

export interface TabState {
  id: TabId
  workspaceId: string
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  audible: boolean
  muted: boolean
  crashed: boolean
  pinned: boolean
  kind: TabKind
}

export type SidebarSection = 'bookmarks' | 'downloads' | 'history' | `panel:${string}`

export const SIDEBAR_SECTIONS = ['bookmarks', 'downloads', 'history'] as const

export interface SidebarState {
  section: SidebarSection
  width: number
}

export interface WindowSnapshot {
  windowId: WindowId
  tabs: TabState[]
  activeTabId: TabId | null
  workspaces: Workspace[]
  activeWorkspaceId: string
  focused: boolean
  maximized: boolean
  fullscreen: boolean
  sidebar: SidebarState | null
}

export type RailMode = 'expanded' | 'collapsed'
export type SearchEngineId = 'google' | 'duckduckgo' | 'bing' | 'kagi' | 'brave'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  rail: RailMode
  searchEngine: SearchEngineId
  theme: Theme
  restoreSession: boolean
  sidebarWidth: number
  background: boolean
  sync: boolean
  panels: WebPanel[]
  shortcuts: ShortcutMap
}

export interface WebPanel {
  id: string
  url: string
  title: string
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  optionsUrl: string | null
  homepageUrl: string
  action: {
    title: string
    badgeText: string
    badgeColor: string | null
    iconModified: number
    hasPopup: boolean
  } | null
}

export interface ExtensionsState {
  partition: string
  tabId: number | null
  list: ExtensionInfo[]
}

export interface ExtensionInstallRequest {
  requestId: string
  id: string
  name: string
  icon: string | null
  permissions: string[]
}

export const EXTENSION_PARTITION = 'persist:default'

export function storeExtensionId(input: string): string | null {
  const text = input.trim()
  if (/^[a-p]{32}$/.test(text)) return text
  try {
    const url = new URL(text)
    if (url.hostname !== 'chromewebstore.google.com' && url.hostname !== 'chrome.google.com')
      return null
    const id = url.pathname.split('/').find((part) => /^[a-p]{32}$/.test(part))
    return id ?? null
  } catch {
    return null
  }
}

export function extensionIconUrl(state: ExtensionsState, info: ExtensionInfo, size = 32): string {
  const params = new URLSearchParams({ partition: state.partition })
  if (state.tabId !== null) params.set('tabId', String(state.tabId))
  if (info.action !== null && info.action.iconModified > 0)
    params.set('t', String(info.action.iconModified))
  return `crx://extension-icon/${info.id}/${size}/2?${params.toString()}`
}

export interface SyncStatus {
  enabled: boolean
  state: 'off' | 'idle' | 'syncing' | 'error'
  lastSync: number | null
  error: string | null
  account: string | null
}

export interface PasswordItem {
  id: string
  title: string
  username: string
  host: string
  score: number
}

export interface PasswordStatus {
  ok: boolean
  provider: string
  ready: boolean
  error: string | null
  hint: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  rail: 'expanded',
  searchEngine: 'google',
  theme: 'system',
  restoreSession: true,
  sidebarWidth: 360,
  background: false,
  sync: false,
  panels: [],
  shortcuts: {},
}

export interface SessionTab {
  url: string
  title: string
  workspace?: number
  pinned?: boolean
}

export interface SessionWindow {
  bounds: Rect | null
  tabs: SessionTab[]
  activeIndex: number
  workspaces?: Workspace[]
  activeWorkspace?: number
  sidebar?: SidebarSection | null
}

export interface HistorySuggestion {
  url: string
  title: string
  host: string
  score: number
}

export interface HistoryVisit {
  url: string
  title: string
  host: string
  count: number
  last: number
}

export type DownloadStatus = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadEntry {
  id: string
  url: string
  filename: string
  path: string
  mime: string
  received: number
  total: number
  speed: number
  status: DownloadStatus
  started: number
  ended: number | null
}

export interface Account {
  name: string
  email: string | null
  server: string | null
}

export interface SessionFile {
  version: 1
  windows: SessionWindow[]
}

export const APP_SCHEME = 'app'
export const LAYER_ARG = '--ewe-layer='
export const NEW_TAB_URL = 'app://newtab/'
export const HOME_URL = 'app://home/'
export const SETTINGS_URL = 'app://settings/'
export const FILES_PAGE_URL = 'app://files/'
export const SAD_TAB_URL = 'app://sad/'

export const RAIL_WIDTH = 264
export const RAIL_PEEK_SHADOW = 24
export const PAGE_GAP = 8
export const TOAST_MARGIN = 16
export const TOAST_WIDTH = 360
export const TOAST_HEIGHT = 56
export const SIDEBAR_HEADER = 44
export const TOAST_MS = 1800
export const SIDEBAR_MIN = 280
export const SIDEBAR_MAX = 640
export const EDGE_ZONE = 12
export const EDGE_LEAVE_ZONE = 24
export const RAIL_HIDE_GRACE_MS = 500

export type ThemeVariant = 'dark' | 'light'

export interface ThemeTokens {
  source: 'ewe' | 'builtin'
  variant: ThemeVariant
  name: string
  vars: Record<string, string>
  base: Record<string, string>
}

export function tabKindOf(url: string): TabKind {
  if (url.startsWith(NEW_TAB_URL) || url === '' || url === 'about:blank') return 'newtab'
  if (url.startsWith(HOME_URL)) return 'home'
  if (url.startsWith(FILES_PAGE_URL)) return 'files'
  if (url.startsWith('app://music/')) return 'music'
  if (url.startsWith(`${APP_SCHEME}://`)) return 'internal'
  return 'page'
}
