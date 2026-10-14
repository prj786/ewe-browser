import { join } from 'node:path'
import {
  BrowserWindow,
  clipboard,
  nativeTheme,
  type Session,
  type WebContents,
  type WebContentsView,
} from 'electron'
import {
  IPC,
  HOME_URL,
  LAYER_ARG,
  NEW_TAB_URL,
  RAIL_PEEK_SHADOW,
  RAIL_WIDTH,
  SETTINGS_URL,
  FILES_PAGE_URL,
  MUSIC_PAGE_URL,
  TOAST_MS,
  filesUrl,
  viewerUrl,
  isBookmarkableUrl,
  isOpenableUrl,
  isPageCommandAllowed,
  isRestorableUrl,
  type ApiLayer,
  type BookmarkFolder,
  type InternalPage,
  type MenuTarget,
  type OverlayPart,
  type DownloadEntry,
  type ExtensionInstallRequest,
  type ExtensionsState,
  type Rect,
  type SessionWindow,
  type Settings,
  type ShellCommand,
  type SidebarSection,
  type ToastIcon,
  type Size,
  type ThemeTokens,
  type UiEvent,
  type WindowSnapshot,
} from '@ewe/shared'
import type { DownloadManager } from './downloads'
import {
  hoverZone,
  pageBounds,
  sameRect,
  sidebarBounds,
  sidebarWidthFor,
  type Point,
} from './layout'
import type { ExtensionHost } from './extensions'
import { OverlayController } from './overlay'
import { PanelHost, panelBounds, panelId } from './panels'
import { copyPassword, fillPassword, focusScript } from './passwords'

const PASSWORD_WORLD = 1009
import { SidebarController } from './sidebar'
import type { BookmarksStore } from './storage/bookmarks-store'
import type { HistoryStore } from './storage/history-store'
import { matchShortcut, type ShortcutAction } from './shortcuts'
import { TabManager } from './tab-manager'
import type { SettingsStore } from './storage/settings-store'

export interface WindowDeps {
  session: Session
  settings: SettingsStore
  preload: string
  rendererUrl: (entry: RendererEntry) => string
  onContentsCreated(contents: WebContents): void
  getTheme(): ThemeTokens | null
  history: HistoryStore
  bookmarks: BookmarksStore
  downloads: DownloadManager
  extensions?: ExtensionHost | undefined
  importChromeBookmarks(): Promise<string>
  isMusicTrack(path: string): boolean
  onSessionChange(): void
  onClosing(controller: WindowController): void
  onClosed(controller: WindowController): void
  openWindow(initial?: SessionWindow): WindowController
  quit(): void
}

export type RendererEntry = 'ui/shell' | 'ui/overlay' | 'ui/sidebar'

const INTERNAL_URLS: Record<InternalPage, string> = {
  newtab: NEW_TAB_URL,
  home: HOME_URL,
  settings: SETTINGS_URL,
  files: FILES_PAGE_URL,
  music: MUSIC_PAGE_URL,
}

const DEFAULT_PAGE_RADIUS = 10
const EDGE_LEAVE_ZONE = 24
const PEEK_HIDE_DELAY_MS = 250

const WINDOW_BACKGROUND = { dark: '#0b0a08', light: '#f4f2ee' }

let eweBackground: string | null = null

export function setEweBackground(color: string | null): void {
  eweBackground = color
}

export function windowBackground(): string {
  if (eweBackground !== null) return eweBackground
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

export class WindowController {
  readonly win: BrowserWindow
  readonly tabs: TabManager
  readonly overlay: OverlayController
  readonly sidebar: SidebarController
  readonly panels: PanelHost
  private lastSection: SidebarSection = 'bookmarks'
  private liveSidebarWidth: number | null = null
  private htmlFullscreen = false
  private reportedPage: Rect | null = null
  private lastMouse: Point | null = null
  private overlayPinned = false
  private broadcastQueued = false
  private destroyed = false
  private toastTimer: NodeJS.Timeout | null = null
  private readonly deps: WindowDeps

  constructor(deps: WindowDeps, initial?: SessionWindow) {
    this.deps = deps
    const bounds = initial?.bounds ?? null
    this.win = new BrowserWindow({
      width: bounds?.width ?? 1280,
      height: bounds?.height ?? 820,
      ...(bounds === null ? {} : { x: bounds.x, y: bounds.y }),
      minWidth: 480,
      minHeight: 320,
      frame: false,
      titleBarStyle: 'hidden',
      show: false,
      backgroundColor: windowBackground(),
      title: 'ewe browser',
      webPreferences: {
        preload: deps.preload,
        additionalArguments: [`${LAYER_ARG}shell`],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    deps.onContentsCreated(this.win.webContents)
    this.lockShellContents(this.win.webContents)

    this.overlay = new OverlayController({
      window: this.win,
      preload: deps.preload,
      url: deps.rendererUrl('ui/overlay'),
      onContentsCreated: (contents) => {
        deps.onContentsCreated(contents)
        this.lockShellContents(contents)
      },
    })
    this.win.contentView.addChildView(this.overlay.view)

    this.sidebar = new SidebarController({
      window: this.win,
      preload: deps.preload,
      url: deps.rendererUrl('ui/sidebar'),
      background: windowBackground,
      onContentsCreated: (contents) => {
        deps.onContentsCreated(contents)
        this.lockShellContents(contents)
      },
    })

    this.panels = new PanelHost({
      window: this.win,
      session: deps.session,
      preload: deps.preload,
      onContentsCreated: (contents) => deps.onContentsCreated(contents),
      openTab: (url) => this.tabs.create(url),
    })

    this.tabs = new TabManager({
      window: this.win,
      session: deps.session,
      preload: deps.preload,
      getSettings: () => deps.settings.get(),
      onChange: () => this.scheduleBroadcast(),
      onShortcut: (action) => this.runShortcut(action),
      onMouse: (point) => this.onPageMouse(point),
      onMouseLeave: (point) => this.onPageMouseLeave(point),
      onVisit: (url, title) => deps.history.record(url, title),
      onTitle: (url, title) => deps.history.title(url, title),
      attachView: (view) => this.attachTabView(view),
      detachView: (view) => {
        if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
      },
      onContentsCreated: (contents) => deps.onContentsCreated(contents),
      onTabCreated: (contents) => deps.extensions?.addTab(contents, this.win),
      onTabActivated: (contents) => {
        if (this.win.isFocused() || this.deps.extensions?.state().tabId === null)
          deps.extensions?.selectTab(contents)
      },
    })

    this.win.on('resize', () => this.layout())
    this.win.on('maximize', () => this.layout())
    this.win.on('unmaximize', () => this.layout())
    this.win.on('enter-full-screen', () => this.layout())
    this.win.on('leave-full-screen', () => this.layout())
    this.win.on('enter-html-full-screen', () => {
      this.htmlFullscreen = true
      this.layout()
    })
    this.win.on('leave-html-full-screen', () => {
      this.htmlFullscreen = false
      this.layout()
    })
    this.win.on('focus', () => {
      const contents = this.tabs.active?.webContents
      if (contents !== undefined) deps.extensions?.selectTab(contents)
      this.scheduleBroadcast()
    })
    this.win.on('blur', () => this.scheduleBroadcast())
    this.win.on('move', () => deps.onSessionChange())
    this.win.on('close', () => deps.onClosing(this))
    this.win.on('closed', () => {
      this.destroyed = true
      if (this.toastTimer !== null) clearTimeout(this.toastTimer)
      try {
        this.overlay.destroy()
        this.sidebar.destroy()
        this.panels.destroy()
        this.tabs.destroy()
      } finally {
        deps.onClosed(this)
      }
    })
    this.win.once('ready-to-show', () => this.win.show())

    void this.win.loadURL(deps.rendererUrl('ui/shell'))

    const tabs = initial?.tabs ?? []
    if (initial?.workspaces !== undefined && initial.workspaces.length > 0)
      this.tabs.setWorkspaces(initial.workspaces, initial.activeWorkspace ?? 0)
    const workspaces = this.tabs.workspaceList()
    if (tabs.length === 0) this.tabs.create(NEW_TAB_URL)
    else {
      const created = tabs.map((tab) => {
        const workspace = workspaces[tab.workspace ?? 0] ?? workspaces[0]
        return this.tabs.create(tab.url, {
          activate: false,
          lazy: true,
          title: tab.title,
          pinned: tab.pinned === true,
          ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
        })
      })
      for (const workspace of workspaces) {
        if (this.tabs.tabsIn(workspace.id).length === 0)
          this.tabs.create(NEW_TAB_URL, { activate: false, workspaceId: workspace.id })
      }
      const active = created[Math.min(initial?.activeIndex ?? 0, created.length - 1)]
      if (active !== undefined) this.tabs.activate(active.id)
    }
    if (initial?.sidebar !== undefined && initial.sidebar !== null)
      this.openSidebar(initial.sidebar)
    this.layout()
  }

  get id(): number {
    return this.win.id
  }

  contentSize(): Size {
    const b = this.win.getContentBounds()
    return { width: b.width, height: b.height }
  }

  ownsContents(contents: WebContents): ApiLayer | null {
    if (this.destroyed || this.win.isDestroyed()) return null
    if (contents.id === this.win.webContents.id) return 'shell'
    if (!this.overlay.webContents.isDestroyed() && contents.id === this.overlay.webContents.id)
      return 'overlay'
    if (this.sidebar.webContents?.id === contents.id) return 'sidebar'
    if (this.tabs.byWebContents(contents) !== undefined) return 'page'
    return null
  }

  sidebarWidth(): number {
    if (!this.sidebar.open || this.htmlFullscreen) return 0
    const requested = this.liveSidebarWidth ?? this.deps.settings.get().sidebarWidth
    return sidebarWidthFor(requested, this.contentSize().width)
  }

  layout(): void {
    if (this.destroyed) return
    const size = this.contentSize()
    const inset = this.sidebarWidth()
    const page = pageBounds(this.reportedPage, size, inset)
    this.tabs.setBounds(page)
    this.tabs.setRadius(this.win.isFullScreen() ? 0 : this.pageRadius())
    this.sidebar.relayout(inset === 0 ? null : sidebarBounds(inset, size))
    const section = this.sidebar.section
    const panel =
      inset === 0 || section?.startsWith('panel:') !== true
        ? undefined
        : this.deps.settings.get().panels.find((p) => `panel:${p.id}` === section)
    if (panel === undefined) this.panels.hide()
    else this.panels.show(panel, panelBounds(sidebarBounds(inset, size)))
    this.overlay.relayout(size, page)
    this.scheduleBroadcast()
    this.deps.onSessionChange()
  }

  pageRadius(): number {
    const value = Number.parseFloat(this.deps.getTheme()?.base['--rounded'] ?? '')
    return Number.isFinite(value) && value >= 0 && value <= 32 ? value : DEFAULT_PAGE_RADIUS
  }

  openSidebar(section: SidebarSection): void {
    this.lastSection = section
    this.sidebar.show(section, sidebarBounds(1, this.contentSize()))
    this.panels.raise()
    this.overlay.raise()
    this.deps.extensions?.popup.raise()
    this.layout()
  }

  closeSidebar(): void {
    if (!this.sidebar.open) return
    this.sidebar.hide()
    this.liveSidebarWidth = null
    this.layout()
    this.tabs.active?.webContents.focus()
  }

  toggleSidebar(section?: SidebarSection): void {
    if (this.sidebar.open && (section === undefined || section === this.sidebar.section)) {
      this.closeSidebar()
      return
    }
    this.openSidebar(section ?? this.lastSection)
    this.sidebar.focus()
  }

  snapshot(): WindowSnapshot {
    return {
      windowId: this.win.id,
      tabs: this.tabs.states(),
      activeTabId: this.tabs.activeTabId,
      workspaces: [...this.tabs.workspaceList()],
      activeWorkspaceId: this.tabs.activeWorkspace,
      focused: this.win.isFocused(),
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      sidebar:
        this.sidebar.section === null
          ? null
          : { section: this.sidebar.section, width: this.sidebarWidth() },
    }
  }

  toSession(): SessionWindow {
    const b = this.win.getNormalBounds()
    return {
      ...this.tabs.toSession({ x: b.x, y: b.y, width: b.width, height: b.height }),
      sidebar: this.sidebar.section,
    }
  }

  sendUi(event: UiEvent): void {
    this.win.webContents.send(IPC.ui, event)
  }

  applyWindowColors(): void {
    if (this.destroyed) return
    this.win.setBackgroundColor(windowBackground())
    this.sidebar.applyBackground()
  }

  sendSettings(settings: Settings): void {
    for (const wc of this.listeners()) wc.send(IPC.settings, settings)
    if (settings.rail === 'expanded' && this.overlay.part === 'rail') this.overlay.hide()
    this.panels.prune(new Set(settings.panels.map((p) => p.id)))
    const section = this.sidebar.section
    if (
      section?.startsWith('panel:') === true &&
      !settings.panels.some((p) => `panel:${p.id}` === section)
    )
      this.closeSidebar()
  }

  sendBookmarks(root: BookmarkFolder): void {
    for (const wc of this.listeners()) wc.send(IPC.bookmarks, root)
  }

  sendExtensions(state: ExtensionsState): void {
    for (const wc of this.listeners()) wc.send(IPC.extensions, state)
  }

  confirmExtension(request: ExtensionInstallRequest): Promise<boolean> {
    const extensions = this.deps.extensions
    if (extensions === undefined) return Promise.resolve(false)
    this.win.focus()
    this.overlayPinned = false
    this.overlay.show('palette', this.contentSize(), { type: 'extension.install', request })
    return extensions.waitFor(request.requestId).then((allow) => {
      if (this.overlay.part === 'palette') this.showOverlay('none')
      return allow
    })
  }

  sendDownloads(entries: DownloadEntry[]): void {
    for (const wc of this.listeners()) wc.send(IPC.downloads, entries)
  }

  sendHistoryChanged(): void {
    this.sidebar.webContents?.send(IPC.historyChanged)
  }

  dispatch(command: ShellCommand, layer: ApiLayer, sender: WebContents, frameUrl: string): void {
    if (layer === 'page') {
      const tab = this.tabs.byWebContents(sender)
      if (!frameUrl.startsWith('app://') || !isPageCommandAllowed(command)) return
      if (
        (command.type === 'settings.update' ||
          command.type === 'shortcuts.recording' ||
          command.type === 'bookmarks.importChrome' ||
          command.type === 'panel.add' ||
          command.type === 'panel.remove' ||
          command.type === 'extension.options' ||
          command.type === 'extension.remove' ||
          command.type === 'extensions.update' ||
          command.type === 'extension.install') &&
        !frameUrl.startsWith(SETTINGS_URL)
      )
        return
      if (command.type === 'music.play' && !frameUrl.startsWith(HOME_URL)) return
      if ((command.type === 'tab.navigate' || command.type === 'nav.reload') && tab !== undefined)
        command = { ...command, id: tab.id }
    }
    switch (command.type) {
      case 'tab.create': {
        const url = command.url ?? NEW_TAB_URL
        const allowed = layer === 'page' ? isOpenableUrl(url) : isRestorableUrl(url)
        if (!allowed) return
        this.tabs.create(url, { activate: command.activate ?? true })
        if (layer === 'overlay') this.overlay.hide()
        if (layer === 'sidebar' && command.activate !== false) this.tabs.active?.webContents.focus()
        break
      }
      case 'tab.close':
        this.tabs.close(command.id)
        if (this.tabs.list().length === 0) this.win.close()
        break
      case 'tab.activate':
        this.tabs.activate(command.id)
        if (layer === 'overlay' && this.overlay.part === 'palette') this.overlay.hide()
        break
      case 'tab.move':
        this.tabs.move(command.id, command.index)
        break
      case 'tab.navigate':
        if (command.newTab === true) this.tabs.open(command.input)
        else this.tabs.navigate(command.id ?? null, command.input)
        if (layer === 'overlay') this.overlay.hide()
        this.tabs.active?.webContents.focus()
        break
      case 'tab.reopen':
        this.tabs.reopen()
        break
      case 'tab.mute':
        this.tabs.setMuted(command.id, command.muted)
        break
      case 'tab.pin':
        this.tabs.setPinned(command.id, command.pinned)
        break
      case 'tab.duplicate':
        this.tabs.duplicate(command.id)
        break
      case 'tab.moveToWorkspace':
        this.tabs.moveToWorkspace(command.id, command.workspaceId)
        break
      case 'tab.closeOthers':
        this.tabs.closeOthers(command.id)
        break
      case 'tab.closeRight':
        this.tabs.closeRight(command.id)
        break
      case 'tab.copyUrl': {
        const tab = this.tabs.get(command.id)
        if (tab !== undefined) void clipboard.writeText(this.tabs.urlOf(tab)).catch(() => undefined)
        break
      }
      case 'nav.back':
        this.tabs.active?.webContents.navigationHistory.goBack()
        break
      case 'nav.forward':
        this.tabs.active?.webContents.navigationHistory.goForward()
        break
      case 'nav.reload':
        this.tabs.reload(command.id ?? null)
        break
      case 'nav.stop':
        this.tabs.active?.webContents.stop()
        break
      case 'layout.report':
        if (layer !== 'shell') return
        if (sameRect(this.reportedPage, command.page)) return
        this.reportedPage = command.page
        this.layout()
        break
      case 'overlay.request':
        if (command.part === 'menu' || command.part === 'toast') return
        if (command.part === 'palette') this.openPalette(command.newTab ?? false)
        else this.showOverlay(command.part)
        break
      case 'menu.open':
        if (layer === 'sidebar') return
        this.openMenu(
          command.menu,
          layer === 'overlay'
            ? {
                x: command.x + this.overlay.view.getBounds().x,
                y: command.y + this.overlay.view.getBounds().y,
              }
            : { x: command.x, y: command.y },
        )
        break
      case 'workspace.create':
        this.tabs.createWorkspace(command.name, command.color)
        break
      case 'workspace.activate':
        this.tabs.activateWorkspace(command.id)
        break
      case 'workspace.update':
        this.tabs.updateWorkspace(command.id, {
          ...(command.name === undefined ? {} : { name: command.name }),
          ...(command.color === undefined ? {} : { color: command.color }),
        })
        break
      case 'workspace.remove':
        this.tabs.removeWorkspace(command.id)
        break
      case 'workspace.mergeInto':
        this.tabs.mergeWorkspace(command.from, command.to)
        break
      case 'workspace.rename':
        if (!this.tabs.workspaceList().some((w) => w.id === command.id)) return
        this.tabs.activateWorkspace(command.id)
        if (this.railVisible()) {
          if (this.overlay.part === 'menu') this.overlay.hide()
          this.win.webContents.focus()
          this.sendUi({ type: 'workspace.rename', id: command.id })
        } else {
          this.overlayPinned = true
          this.overlay.show('rail', this.contentSize(), {
            type: 'workspace.rename',
            id: command.id,
          })
          this.overlay.webContents.focus()
        }
        break
      case 'overlay.pin':
        this.overlayPinned = command.pinned
        if (command.pinned && layer === 'overlay' && this.overlay.part !== 'none')
          this.overlay.webContents.focus()
        break
      case 'settings.update':
        this.deps.settings.update(command.patch)
        break
      case 'shortcuts.recording':
        if (layer === 'page') this.tabs.setRecording(sender, command.on)
        break
      case 'bookmark.toggle':
        this.toggleBookmark(
          command.tabId === undefined ? this.tabs.active : this.tabs.get(command.tabId),
        )
        break
      case 'bookmark.add':
        this.deps.bookmarks.add(command.url, command.title, command.folderId)
        break
      case 'bookmark.remove':
        this.deps.bookmarks.remove(command.id)
        break
      case 'bookmark.update':
        this.deps.bookmarks.update(command.id, {
          title: command.title,
          url: command.url,
          folderId: command.folderId,
          index: command.index,
        })
        break
      case 'sidebar.toggle':
        this.toggleSidebar(command.section)
        break
      case 'sidebar.close':
        this.closeSidebar()
        break
      case 'sidebar.resize':
        if (!this.sidebar.open) return
        this.liveSidebarWidth = sidebarWidthFor(command.width, this.contentSize().width)
        if (command.commit === true) {
          this.deps.settings.update({ sidebarWidth: this.liveSidebarWidth })
          this.liveSidebarWidth = null
        }
        this.layout()
        break
      case 'download':
        this.deps.downloads.run(command.id, command.action)
        break
      case 'downloads.clear':
        this.deps.downloads.clear()
        break
      case 'history.remove':
        this.deps.history.remove(command.url)
        break
      case 'passwords.open':
        this.openPasswords()
        break
      case 'extension.activate': {
        const origin = layer === 'overlay' ? this.overlay.view.getBounds() : { x: 0, y: 0 }
        if (layer === 'overlay') this.showOverlay('none')
        this.deps.extensions?.activate(
          this.win,
          command.id,
          {
            x: command.x + origin.x,
            y: command.y + origin.y,
            width: command.width,
            height: command.height,
          },
          this.pageRadius(),
        )
        break
      }
      case 'extension.options': {
        const url = this.deps.extensions?.optionsUrl(command.id) ?? null
        if (url !== null) this.tabs.create(url)
        if (layer === 'overlay') this.showOverlay('none')
        break
      }
      case 'extension.remove':
        void this.deps.extensions
          ?.remove(command.id)
          .then(() => this.toast('Extension removed', 'check'))
        break
      case 'extension.install': {
        const extensions = this.deps.extensions
        if (extensions === undefined) break
        void extensions.installFromStore(command.source, this.win).then((result) => {
          if (result !== null) this.toast(result.message, result.ok ? 'check' : 'alert')
        })
        break
      }
      case 'extension.confirm':
        this.deps.extensions?.settle(command.requestId, command.allow)
        break
      case 'extensions.update':
        void this.deps.extensions
          ?.update()
          .then(() => this.toast('Extensions are up to date', 'check'))
        break
      case 'passwords.fill': {
        const { id, what } = command
        this.showOverlay('none')
        this.win.focus()
        const contents = this.tabs.active?.webContents
        contents?.focus()
        const focused =
          contents === undefined || contents.getURL().startsWith('app:')
            ? Promise.resolve(true)
            : contents
                .executeJavaScriptInIsolatedWorld(PASSWORD_WORLD, [{ code: focusScript(what) }])
                .then((ok: unknown) => ok !== false)
                .catch(() => true)
        void focused.then((ok) => {
          if (!ok) {
            this.toast('Click the login field, then try again', 'alert')
            return
          }
          setTimeout(() => {
            void fillPassword(id, what).then((error) => {
              if (error !== null) this.toast(error, 'alert')
            })
          }, 120)
        })
        break
      }
      case 'passwords.copy': {
        const { id, what } = command
        this.showOverlay('none')
        void copyPassword(id, what).then((error) =>
          this.toast(
            error ?? `${what === 'password' ? 'Password' : 'Username'} copied`,
            error === null ? 'check' : 'alert',
          ),
        )
        break
      }
      case 'panel.add': {
        const panels = this.deps.settings.get().panels
        if (panels.length >= 12) return
        const id = panelId(command.url, new Set(panels.map((p) => p.id)))
        let title = command.title?.trim() ?? ''
        if (title === '') {
          try {
            title = new URL(command.url).hostname.replace(/^www\./, '')
          } catch {
            title = command.url
          }
        }
        this.deps.settings.update({ panels: [...panels, { id, url: command.url, title }] })
        this.openSidebar(`panel:${id}`)
        break
      }
      case 'panel.remove':
        this.deps.settings.update({
          panels: this.deps.settings.get().panels.filter((p) => p.id !== command.id),
        })
        break

      case 'bookmark.folder.create':
        this.deps.bookmarks.createFolder(command.title, command.parentId)
        break
      case 'bookmarks.importChrome':
        void this.deps.importChromeBookmarks().then((message) => {
          if (!sender.isDestroyed()) sender.send(IPC.ui, { type: 'toast', message })
        })
        break
      case 'open.internal': {
        const existing =
          command.page === 'music'
            ? this.tabs.list().find((t) => t.state.kind === 'music')
            : undefined
        if (existing === undefined) this.tabs.create(INTERNAL_URLS[command.page])
        else this.tabs.activate(existing.id)
        if (layer === 'overlay') this.overlay.hide()
        break
      }
      case 'music.play':
        this.playMusic(command.path)
        break
      case 'window.new':
        this.deps.openWindow()
        break
      case 'window.close':
        this.win.close()
        break
      case 'window.minimize':
        this.win.minimize()
        break
      case 'window.toggleMaximize':
        if (this.win.isMaximized()) this.win.unmaximize()
        else this.win.maximize()
        break
      case 'devtools.toggle':
        this.tabs.active?.webContents.toggleDevTools()
        break
    }
  }

  showOverlay(part: OverlayPart, extra?: UiEvent): void {
    if (part === 'none') {
      this.overlayPinned = false
      this.overlay.hide()
      this.tabs.active?.webContents.focus()
      return
    }
    this.overlay.show(part, this.contentSize(), extra)
  }

  openMenu(menu: MenuTarget, at: Point): void {
    const exists =
      menu.kind === 'tab'
        ? this.tabs.get(menu.id) !== undefined
        : menu.kind === 'extension'
          ? this.deps.extensions?.state().list.some((e) => e.id === menu.id) === true
          : this.tabs.workspaceList().some((w) => w.id === menu.id)
    if (!exists) return
    this.overlay.show('menu', this.contentSize(), { type: 'menu.open', menu, x: at.x, y: at.y })
  }

  playMusic(path: string): void {
    if (!this.deps.isMusicTrack(path)) {
      this.tabs.create(viewerUrl(path))
      return
    }
    const url = `${MUSIC_PAGE_URL}?${new URLSearchParams({ play: path }).toString()}`
    const existing = this.tabs.list().find((t) => t.state.kind === 'music')
    if (existing === undefined) {
      this.tabs.create(url)
      return
    }
    const ready = !existing.pending && !existing.webContents.isLoading()
    if (!ready) this.tabs.navigate(existing.id, url)
    this.tabs.activate(existing.id)
    if (ready) existing.webContents.send(IPC.ui, { type: 'music.play', path } satisfies UiEvent)
  }

  openFiles(path: string, select?: string): void {
    this.tabs.create(filesUrl(path, select))
    if (this.win.isMinimized()) this.win.restore()
    this.win.focus()
  }

  discardDownloadTab(contents: WebContents): void {
    const tab = this.tabs.byWebContents(contents)
    if (tab === undefined || this.tabs.list().length < 2) return
    if (contents.navigationHistory.canGoBack()) return
    const url = contents.getURL()
    if (url !== '' && url !== 'about:blank') return
    setTimeout(() => {
      if (this.tabs.get(tab.id) === undefined || contents.isDestroyed()) return
      if (contents.getURL() !== '' && contents.getURL() !== 'about:blank') return
      this.dispatch({ type: 'tab.close', id: tab.id }, 'shell', this.win.webContents, '')
    }, 0)
  }

  toggleBookmark(tab = this.tabs.active): void {
    if (tab === undefined) return
    const url = this.tabs.urlOf(tab)
    if (!isBookmarkableUrl(url)) return
    const added = this.deps.bookmarks.toggle(url, tab.state.title)
    if (added !== undefined) this.toast(added ? 'Bookmark added' : 'Bookmark removed')
  }

  toast(message: string, icon: ToastIcon = 'star'): void {
    const part = this.overlay.part
    if (part !== 'none' && part !== 'toast') return
    this.overlay.show('toast', this.contentSize(), { type: 'toast', message, icon })
    if (this.toastTimer !== null) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      if (this.overlay.part === 'toast') this.overlay.hide()
    }, TOAST_MS)
  }

  activeHost(): string {
    const tab = this.tabs.active
    if (tab === undefined) return ''
    try {
      return new URL(this.tabs.urlOf(tab)).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }

  openPasswords(): void {
    this.overlayPinned = false
    this.overlay.show('palette', this.contentSize(), {
      type: 'passwords.open',
      host: this.activeHost(),
    })
  }

  railVisible(): boolean {
    return this.deps.settings.get().rail === 'expanded' && !this.win.isFullScreen()
  }

  focusAddress(): void {
    if (this.railVisible()) {
      this.win.webContents.focus()
      this.sendUi({ type: 'focus-address' })
      return
    }
    const active = this.tabs.active
    const url =
      active === undefined || active.state.kind === 'newtab' ? '' : this.tabs.urlOf(active)
    this.overlayPinned = false
    this.overlay.show('palette', this.contentSize(), { type: 'palette.open', query: url })
  }

  toggleRail(): void {
    const rail = this.deps.settings.get().rail
    this.deps.settings.update({ rail: rail === 'expanded' ? 'collapsed' : 'expanded' })
  }

  openPalette(newTab = false): void {
    this.overlayPinned = false
    this.overlay.show('palette', this.contentSize(), { type: 'palette.open', newTab })
  }

  sendTheme(theme: ThemeTokens | null): void {
    for (const wc of this.listeners()) wc.send(IPC.theme, theme)
  }

  runShortcut(action: ShortcutAction): void {
    const active = this.tabs.active
    switch (action.action) {
      case 'tab.new':
        this.openPalette(true)
        break
      case 'tab.close':
        if (active !== undefined)
          this.dispatch({ type: 'tab.close', id: active.id }, 'shell', this.win.webContents, '')
        break
      case 'tab.reopen':
        this.tabs.reopen()
        break
      case 'tab.next':
        this.tabs.cycle(1)
        break
      case 'tab.prev':
        this.tabs.cycle(-1)
        break
      case 'tab.select':
        this.tabs.select(action.index)
        break
      case 'tab.last':
        this.tabs.select(-1)
        break
      case 'workspace.select':
        this.tabs.selectWorkspace(action.index)
        break
      case 'workspace.last':
        this.tabs.selectWorkspace(-1)
        break
      case 'home':
        this.dispatch({ type: 'open.internal', page: 'home' }, 'shell', this.win.webContents, '')
        break
      case 'workspace.next':
        this.tabs.cycleWorkspace(1)
        break
      case 'workspace.prev':
        this.tabs.cycleWorkspace(-1)
        break
      case 'address':
        this.focusAddress()
        break
      case 'palette':
        this.openPalette()
        break
      case 'bookmark':
        this.toggleBookmark()
        break
      case 'rail.toggle':
        this.toggleRail()
        break
      case 'passwords':
        this.openPasswords()
        break
      case 'files':
        this.dispatch({ type: 'open.internal', page: 'files' }, 'shell', this.win.webContents, '')
        break
      case 'sidebar.bookmarks':
        this.toggleSidebar('bookmarks')
        break
      case 'sidebar.downloads':
        this.toggleSidebar('downloads')
        break
      case 'sidebar.history':
        this.toggleSidebar('history')
        break
      case 'reload':
        this.tabs.reload()
        break
      case 'reload.hard':
        active?.webContents.reloadIgnoringCache()
        break
      case 'back':
        active?.webContents.navigationHistory.goBack()
        break
      case 'forward':
        active?.webContents.navigationHistory.goForward()
        break
      case 'window.new':
        this.deps.openWindow()
        break
      case 'window.close':
        this.win.close()
        break
      case 'devtools':
        active?.webContents.toggleDevTools()
        break
      case 'zoom.in':
        if (active !== undefined)
          active.webContents.setZoomLevel(active.webContents.getZoomLevel() + 0.5)
        break
      case 'zoom.out':
        if (active !== undefined)
          active.webContents.setZoomLevel(active.webContents.getZoomLevel() - 0.5)
        break
      case 'zoom.reset':
        active?.webContents.setZoomLevel(0)
        break
      case 'fullscreen':
        this.win.setFullScreen(!this.win.isFullScreen())
        break
      case 'quit':
        this.deps.quit()
        break
    }
  }

  private onPageMouse(point: Point): void {
    this.lastMouse = point
    const part = this.overlay.part
    if (part === 'palette' || part === 'menu') return
    if (part === 'rail') {
      if (this.overlayPinned || Date.now() - this.overlay.shownAt < PEEK_HIDE_DELAY_MS) return
      if (point.x > RAIL_WIDTH + RAIL_PEEK_SHADOW) this.overlay.hide()
      return
    }
    this.revealEdge(hoverZone(point, this.contentSize()))
  }

  private onPageMouseLeave(point: Point | null): void {
    const last = point ?? this.lastMouse
    this.lastMouse = null
    const part = this.overlay.part
    if ((part !== 'none' && part !== 'toast') || last === null) return
    this.revealEdge(hoverZone(last, this.contentSize(), EDGE_LEAVE_ZONE))
  }

  private revealEdge(zone: 'rail' | null): void {
    if (zone === null || this.htmlFullscreen) return
    if (this.railVisible()) return
    if (!this.win.isFullScreen() && this.deps.settings.get().rail === 'collapsed') return
    this.overlay.show('rail', this.contentSize())
  }

  private attachTabView(view: WebContentsView): void {
    const content = this.win.contentView
    content.addChildView(view)
    this.sidebar.raise()
    this.panels.raise()
    this.overlay.raise()
    this.deps.extensions?.popup.raise()
  }

  private listeners(): WebContents[] {
    const out = [this.win.webContents, this.overlay.webContents]
    const sidebar = this.sidebar.webContents
    if (sidebar !== null) out.push(sidebar)
    for (const tab of this.tabs.list()) {
      if (tab.state.url.startsWith('app://')) out.push(tab.webContents)
    }
    return out.filter((wc) => !wc.isDestroyed())
  }

  private scheduleBroadcast(): void {
    if (this.broadcastQueued || this.destroyed) return
    this.broadcastQueued = true
    setTimeout(() => {
      this.broadcastQueued = false
      if (this.destroyed) return
      const snapshot = this.snapshot()
      for (const wc of this.listeners()) wc.send(IPC.state, snapshot)
      this.deps.onSessionChange()
    }, 16)
  }

  private isShellUrl(url: string): boolean {
    const shellUrl = this.deps.rendererUrl('ui/shell')
    try {
      const target = new URL(url)
      const shell = new URL(shellUrl)
      if (shell.protocol === 'file:') {
        const root = shell.pathname.replace(/\/ui\/shell\/index\.html$/, '/')
        return target.protocol === 'file:' && target.pathname.startsWith(root)
      }
      return target.origin === shell.origin
    } catch {
      return false
    }
  }

  private lockShellContents(contents: WebContents): void {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!this.isShellUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!this.isShellUrl(url)) event.preventDefault()
    })
    contents.on('before-input-event', (event, input) => {
      const action = matchShortcut(input)
      if (action === null) return
      if (action.action === 'devtools' && input.alt) {
        contents.toggleDevTools()
        event.preventDefault()
        return
      }
      event.preventDefault()
      this.runShortcut(action)
    })
  }
}

export class WindowManager {
  private readonly windows = new Map<number, WindowController>()
  private readonly deps: Omit<WindowDeps, 'onClosed' | 'openWindow'>

  constructor(deps: Omit<WindowDeps, 'onClosed' | 'openWindow'>) {
    this.deps = deps
  }

  open(initial?: SessionWindow): WindowController {
    const controller = new WindowController(
      {
        ...this.deps,
        onClosed: (c) => this.windows.delete(c.id),
        openWindow: (init) => this.open(init),
      },
      initial,
    )
    this.windows.set(controller.id, controller)
    return controller
  }

  all(): WindowController[] {
    return [...this.windows.values()]
  }

  fromContents(contents: WebContents): { controller: WindowController; layer: ApiLayer } | null {
    if (contents.isDestroyed()) return null
    for (const controller of this.windows.values()) {
      const layer = controller.ownsContents(contents)
      if (layer !== null) return { controller, layer }
    }
    return null
  }

  toSession(): SessionWindow[] {
    return this.all()
      .filter((c) => !c.win.isDestroyed())
      .map((c) => c.toSession())
  }

  focused(): WindowController | undefined {
    const focused = BrowserWindow.getFocusedWindow()
    return focused === null ? this.all()[0] : this.windows.get(focused.id)
  }

  broadcastSettings(settings: Settings): void {
    for (const c of this.windows.values()) c.sendSettings(settings)
  }

  broadcastTheme(theme: ThemeTokens | null): void {
    for (const c of this.windows.values()) c.sendTheme(theme)
  }

  broadcastBookmarks(root: BookmarkFolder): void {
    for (const c of this.windows.values()) c.sendBookmarks(root)
  }

  broadcastExtensions(state: ExtensionsState): void {
    for (const c of this.windows.values()) c.sendExtensions(state)
  }

  controllerOf(window: BrowserWindow | null): WindowController | undefined {
    if (window === null) return undefined
    return this.all().find((c) => c.win.id === window.id)
  }

  broadcastDownloads(entries: DownloadEntry[]): void {
    for (const c of this.windows.values()) c.sendDownloads(entries)
  }

  broadcastHistoryChanged(): void {
    for (const c of this.windows.values()) c.sendHistoryChanged()
  }

  applyWindowColors(): void {
    for (const c of this.windows.values()) c.applyWindowColors()
  }
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}
