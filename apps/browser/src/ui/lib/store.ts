import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'
import {
  DEFAULT_SETTINGS,
  bookmarkedUrls,
  type Account,
  type BookmarkFolder,
  type Settings,
  type TabState,
  type ThemeTokens,
  type WindowSnapshot,
  type Workspace,
} from '@ewe/shared'
import { api } from './api'

export interface BrowserStore {
  state: Accessor<WindowSnapshot | null>
  settings: Accessor<Settings>
  theme: Accessor<ThemeTokens | null>
  account: Accessor<Account | null>
  bookmarks: Accessor<BookmarkFolder | null>
  bookmarked: Accessor<Set<string>>
  tabs: Accessor<TabState[]>
  visibleTabs: Accessor<TabState[]>
  activeTab: Accessor<TabState | undefined>
  workspaces: Accessor<Workspace[]>
  activeWorkspace: Accessor<Workspace | undefined>
}

const EMPTY: TabState[] = []
const EMPTY_WORKSPACES: Workspace[] = []
const NO_URLS = new Set<string>()

export function createBrowserStore(): BrowserStore {
  const [state, setState] = createSignal<WindowSnapshot | null>(null)
  const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS)
  const [theme, setTheme] = createSignal<ThemeTokens | null>(null)
  const [account, setAccount] = createSignal<Account | null>(null)
  const [bookmarks, setBookmarks] = createSignal<BookmarkFolder | null>(null)
  void api.getAccount().then(setAccount)

  let pushedState = false
  let pushedSettings = false
  let pushedTheme = false
  let pushedBookmarks = false
  const offState = api.onState((s) => {
    pushedState = true
    setState(s)
  })
  const offSettings = api.onSettings((s) => {
    pushedSettings = true
    setSettings(s)
  })
  const offTheme = api.onTheme((t) => {
    pushedTheme = true
    setTheme(t)
  })
  const offBookmarks = api.onBookmarks((b) => {
    pushedBookmarks = true
    setBookmarks(b)
  })
  void api.getState().then((s) => {
    if (!pushedState && s !== null) setState(s)
  })
  void api.getSettings().then((s) => {
    if (!pushedSettings && s !== null) setSettings(s)
  })
  void api.getTheme().then((t) => {
    if (!pushedTheme) setTheme(t)
  })
  void api.getBookmarks().then((b) => {
    if (!pushedBookmarks && b !== null) setBookmarks(b)
  })
  onCleanup(() => {
    offState()
    offSettings()
    offTheme()
    offBookmarks()
  })

  const bookmarked = createMemo(() => {
    const root = bookmarks()
    return root === null ? NO_URLS : bookmarkedUrls(root)
  })

  const tabs = () => state()?.tabs ?? EMPTY
  const workspaces = () => state()?.workspaces ?? EMPTY_WORKSPACES
  const activeWorkspace = () => {
    const s = state()
    return s?.workspaces.find((w) => w.id === s.activeWorkspaceId)
  }
  const visibleTabs = () => {
    const s = state()
    if (s === null) return EMPTY
    return s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
  }
  const activeTab = () => {
    const s = state()
    return s?.tabs.find((t) => t.id === s.activeTabId)
  }
  return {
    state,
    settings,
    theme,
    account,
    bookmarks,
    bookmarked,
    tabs,
    visibleTabs,
    activeTab,
    workspaces,
    activeWorkspace,
  }
}

let appliedVars: string[] = []

export function applyTheme(
  settings: Accessor<Settings>,
  theme: Accessor<ThemeTokens | null>,
): void {
  const root = document.documentElement
  const mode = settings().theme
  const ewe = theme()
  const followEwe = mode === 'system' && ewe?.source === 'ewe'
  if (mode === 'system') {
    if (ewe !== null) root.dataset.theme = ewe.variant
    else root.removeAttribute('data-theme')
  } else {
    root.dataset.theme = mode
  }
  for (const name of appliedVars) root.style.removeProperty(name)
  appliedVars = []
  if (ewe !== null) {
    const vars = followEwe ? { ...ewe.base, ...ewe.vars } : ewe.base
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value)
      appliedVars.push(name)
    }
  }
}
