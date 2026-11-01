import { randomUUID } from 'node:crypto'
import {
  WebContentsView,
  type BrowserWindow,
  type ContextMenuParams,
  type Session,
  type WebContents,
} from 'electron'
import {
  LAYER_ARG,
  HOME_URL,
  NEW_TAB_URL,
  SAD_TAB_URL,
  defaultWorkspaceName,
  hostOf,
  nextWorkspaceColor,
  resolveInput,
  tabKindOf,
  type Rect,
  type RemoteBinding,
  type SessionTab,
  type SessionWindow,
  type Settings,
  type TabId,
  type TabState,
  type Workspace,
  type WorkspaceColor,
} from '@ewe/shared'
import { ownsFind } from './find'
import { inlineFavicon } from './remote/favicon'
import { shownUrl } from './page-menu-model'
import { isPageFirst, matchShortcut, type ShortcutAction } from './shortcuts'
import type { Point } from './layout'

export interface TabManagerHost {
  window: BrowserWindow
  sessionFor(workspace: Workspace | undefined): Session
  beforeLoad?(workspace: Workspace, url: string): Promise<string | null> | null
  loadFailed?(
    tab: Tab,
    workspace: Workspace,
    code: number,
    url: string,
    description: string,
  ): boolean
  onWorkspaceActivated?(workspace: Workspace): void
  preload: string
  getSettings(): Settings
  onChange(): void
  onShortcut(action: ShortcutAction): void
  onMouse(point: Point): void
  onMouseLeave(point: Point | null): void
  onVisit(url: string, title: string): void
  onTitle(url: string, title: string): void
  attachView(view: WebContentsView): void
  detachView(view: WebContentsView): void
  onContentsCreated(contents: WebContents): void
  onTabCreated(contents: WebContents): void
  onTabActivated(contents: WebContents): void
  onContextMenu(tab: Tab, params: ContextMenuParams): void
  onPageFirstKey(tab: Tab, action: ShortcutAction, code: string): void
  failedLoad?(contents: WebContents, url: string, description: string): string | undefined
}

export class Tab {
  readonly id: TabId = randomUUID()
  readonly view: WebContentsView
  state: TabState
  lastGoodUrl = ''
  pending = false
  loadTicket = 0
  retry: { url: string; at: number } | null = null

  constructor(view: WebContentsView, url: string, workspaceId: string) {
    this.view = view
    this.state = {
      id: this.id,
      workspaceId,
      url,
      title: '',
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      audible: false,
      muted: false,
      crashed: false,
      pinned: false,
      kind: tabKindOf(url),
    }
  }

  get webContents(): WebContents {
    return this.view.webContents
  }
}

export interface CreateTabOptions {
  activate?: boolean
  index?: number
  lazy?: boolean
  title?: string
  workspaceId?: string
  pinned?: boolean
}

interface ClosedTab extends SessionTab {
  workspaceId: string
  remote: RemoteBinding | undefined
}

interface TabGroup {
  start: number
  pinnedEnd: number
  end: number
}

function isMouseEvent(input: Electron.InputEvent): input is Electron.MouseInputEvent {
  return 'x' in input && 'y' in input
}

function newWorkspace(name: string, color: WorkspaceColor, remote?: RemoteBinding): Workspace {
  return remote === undefined
    ? { id: randomUUID(), name, color }
    : { id: randomUUID(), name, color, remote: { ...remote } }
}

function sameEgress(a: Workspace | undefined, b: Workspace | undefined): boolean {
  return a?.remote?.id === b?.remote?.id
}

export class TabManager {
  private readonly tabs: Tab[] = []
  private activeId: TabId | null = null
  private readonly closed: ClosedTab[] = []
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private radius = 0
  private readonly host: TabManagerHost
  private workspaces: Workspace[]
  private readonly recording = new Set<number>()
  private activeWorkspaceId: string
  private readonly lastActive = new Map<string, TabId>()

  constructor(host: TabManagerHost) {
    this.host = host
    const first = newWorkspace('Home', 'ewellow')
    this.workspaces = [first]
    this.activeWorkspaceId = first.id
  }

  list(): readonly Tab[] {
    return this.tabs
  }

  get active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId)
  }

  get activeTabId(): TabId | null {
    return this.activeId
  }

  get(id: TabId): Tab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  byWebContents(contents: WebContents): Tab | undefined {
    return this.tabs.find((t) => t.webContents.id === contents.id)
  }

  indexOf(id: TabId): number {
    return this.tabs.findIndex((t) => t.id === id)
  }

  workspaceList(): readonly Workspace[] {
    return this.workspaces
  }

  workspace(id: string): Workspace | undefined {
    return this.workspaces.find((w) => w.id === id)
  }

  workspaceOf(tab: Tab): Workspace | undefined {
    return this.workspace(tab.state.workspaceId)
  }

  localWorkspace(): string {
    const active = this.workspace(this.activeWorkspaceId)
    if (active !== undefined && active.remote === undefined) return active.id
    const local = this.workspaces.find((w) => w.remote === undefined)
    return local?.id ?? this.createWorkspace(undefined, undefined, false).id
  }

  get activeWorkspace(): string {
    return this.activeWorkspaceId
  }

  tabsIn(workspaceId: string): Tab[] {
    return this.tabs.filter((t) => t.state.workspaceId === workspaceId)
  }

  setWorkspaces(workspaces: Workspace[], activeIndex: number): void {
    if (workspaces.length === 0) return
    this.workspaces = workspaces.map((w) => ({ ...w }))
    const active = this.workspaces[Math.max(0, Math.min(activeIndex, this.workspaces.length - 1))]
    this.activeWorkspaceId = active?.id ?? this.activeWorkspaceId
  }

  createWorkspace(
    name?: string,
    color?: WorkspaceColor,
    activate = true,
    remote?: RemoteBinding,
  ): Workspace {
    const trimmed = name?.trim() ?? ''
    const workspace = newWorkspace(
      trimmed === '' ? defaultWorkspaceName(this.workspaces) : trimmed.slice(0, 40),
      color ?? nextWorkspaceColor(this.workspaces.map((w) => w.color)),
      remote,
    )
    this.workspaces.push(workspace)
    if (activate) this.activateWorkspace(workspace.id)
    else this.host.onChange()
    return workspace
  }

  activateWorkspace(id: string): void {
    const workspace = this.workspaces.find((w) => w.id === id)
    if (workspace === undefined) return
    this.activeWorkspaceId = id
    this.host.onWorkspaceActivated?.(workspace)
    const remembered = this.lastActive.get(id)
    const tab = (remembered === undefined ? undefined : this.get(remembered)) ?? this.tabsIn(id)[0]
    if (tab?.state.workspaceId === id) this.activate(tab.id)
    else this.create(HOME_URL, { workspaceId: id })
    this.host.onChange()
  }

  selectWorkspace(index: number): void {
    const target = this.workspaces[index < 0 ? this.workspaces.length + index : index]
    if (target !== undefined && target.id !== this.activeWorkspaceId)
      this.activateWorkspace(target.id)
  }

  setRecording(contents: WebContents, on: boolean): void {
    if (on) this.recording.add(contents.id)
    else this.recording.delete(contents.id)
  }

  cycleWorkspace(delta: number): void {
    const index = this.workspaces.findIndex((w) => w.id === this.activeWorkspaceId)
    const next = this.workspaces[(index + delta + this.workspaces.length) % this.workspaces.length]
    if (next !== undefined && next.id !== this.activeWorkspaceId) this.activateWorkspace(next.id)
  }

  updateWorkspace(id: string, patch: { name?: string; color?: WorkspaceColor }): void {
    const workspace = this.workspaces.find((w) => w.id === id)
    if (workspace === undefined) return
    const name = patch.name?.trim()
    if (name !== undefined && name !== '') workspace.name = name.slice(0, 40)
    if (patch.color !== undefined) workspace.color = patch.color
    this.host.onChange()
  }

  removeWorkspace(id: string): void {
    const index = this.workspaces.findIndex((w) => w.id === id)
    if (index === -1 || this.workspaces.length <= 1) return
    this.workspaces.splice(index, 1)
    if (this.activeWorkspaceId === id) {
      const neighbour = this.workspaces[Math.min(index, this.workspaces.length - 1)]
      if (neighbour !== undefined) this.activateWorkspace(neighbour.id)
    }
    for (const tab of this.tabsIn(id)) this.close(tab.id)
    this.lastActive.delete(id)
    this.host.onChange()
  }

  mergeWorkspace(from: string, to: string): void {
    if (from === to) return
    const source = this.workspace(from)
    const target = this.workspace(to)
    if (source === undefined || target === undefined) return
    const moving = this.tabsIn(from)
    if (moving.length === 0) return
    if (!sameEgress(source, target)) {
      for (const tab of moving) this.transplant(tab, to)
      this.lastActive.delete(from)
      this.host.onChange()
      return
    }
    for (const tab of moving) {
      this.tabs.splice(this.indexOf(tab.id), 1)
      tab.state = { ...tab.state, workspaceId: to }
      this.insert(tab)
    }
    this.lastActive.delete(from)
    if (this.activeId !== null && moving.some((t) => t.id === this.activeId)) {
      this.activate(this.activeId)
    }
    this.host.onChange()
  }

  create(url = NEW_TAB_URL, options: CreateTabOptions = {}): Tab {
    const workspaceId = options.workspaceId ?? this.activeWorkspaceId
    const view = new WebContentsView({
      webPreferences: {
        session: this.host.sessionFor(this.workspace(workspaceId)),
        preload: this.host.preload,
        additionalArguments: [`${LAYER_ARG}page`],
        nodeIntegrationInSubFrames: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
        backgroundThrottling: true,
      },
    })
    const tab = new Tab(view, url, workspaceId)
    if (options.title !== undefined) tab.state = { ...tab.state, title: options.title }
    if (options.pinned === true) tab.state = { ...tab.state, pinned: true }
    this.wire(tab)
    this.insert(tab, options.index)
    this.host.attachView(view)
    view.setVisible(false)
    const activate = options.activate ?? true
    if (options.lazy === true && !activate) tab.pending = true
    else this.load(tab, url)
    if (activate) this.activate(tab.id)
    this.host.onChange()
    return tab
  }

  load(tab: Tab, url: string): void {
    const ticket = ++tab.loadTicket
    const workspace = this.workspaceOf(tab)
    const wait = workspace === undefined ? null : (this.host.beforeLoad?.(workspace, url) ?? null)
    if (wait === null) {
      void tab.webContents.loadURL(url).catch(() => undefined)
      return
    }
    this.update(tab, { url, kind: tabKindOf(url), loading: true })
    void wait.then((target) => {
      if (tab.webContents.isDestroyed() || tab.loadTicket !== ticket) return
      void tab.webContents.loadURL(target ?? url).catch(() => undefined)
    })
  }

  private transplant(tab: Tab, workspaceId: string): Tab {
    const active = this.activeId === tab.id
    const moved = this.create(this.urlOf(tab), {
      workspaceId,
      activate: active,
      lazy: !active,
      title: tab.state.title,
      pinned: tab.state.pinned,
    })
    this.close(tab.id, false)
    return moved
  }

  private groupOf(workspaceId: string): TabGroup {
    let start = -1
    let pinnedEnd = -1
    let end = this.tabs.length
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]
      if (tab?.state.workspaceId !== workspaceId) {
        if (start !== -1) {
          end = i
          break
        }
        continue
      }
      if (start === -1) start = i
      if (tab.state.pinned) pinnedEnd = i + 1
    }
    if (start === -1) return { start: end, pinnedEnd: end, end }
    return { start, pinnedEnd: pinnedEnd === -1 ? start : pinnedEnd, end }
  }

  private insert(tab: Tab, index?: number): void {
    const group = this.groupOf(tab.state.workspaceId)
    const at = tab.state.pinned
      ? Math.max(group.start, Math.min(index ?? group.pinnedEnd, group.pinnedEnd))
      : Math.max(group.pinnedEnd, Math.min(index ?? group.end, this.tabs.length))
    this.tabs.splice(at, 0, tab)
  }

  setPinned(id: TabId, pinned: boolean): void {
    const tab = this.get(id)
    if (tab === undefined || tab.state.pinned === pinned) return
    this.tabs.splice(this.indexOf(id), 1)
    tab.state = { ...tab.state, pinned }
    this.insert(tab, pinned ? undefined : this.groupOf(tab.state.workspaceId).pinnedEnd)
    this.host.onChange()
  }

  activate(id: TabId): void {
    const next = this.get(id)
    if (next === undefined) return
    const prev = this.active
    this.activeId = id
    this.activeWorkspaceId = next.state.workspaceId
    this.lastActive.set(next.state.workspaceId, id)
    if (prev !== undefined && prev.id !== id) {
      prev.view.setVisible(false)
      prev.view.setBorderRadius(0)
    }
    next.view.setBorderRadius(this.radius)
    next.view.setBounds(this.bounds)
    next.view.setVisible(true)
    if (next.pending) {
      next.pending = false
      this.load(next, next.state.url)
    }
    next.webContents.focus()
    this.host.onTabActivated(next.webContents)
    this.host.onChange()
  }

  close(id: TabId, remember = true): void {
    const tab = this.get(id)
    if (tab === undefined) return
    this.remove(tab, remember)
    if (!tab.webContents.isDestroyed()) tab.webContents.close()
  }

  private remove(tab: Tab, remember = true): void {
    const index = this.indexOf(tab.id)
    if (index === -1) return
    const workspaceId = tab.state.workspaceId
    const siblings = this.tabsIn(workspaceId)
    const position = siblings.indexOf(tab)
    this.tabs.splice(index, 1)
    if (remember && tab.state.kind === 'page')
      this.closed.push({
        url: tab.state.url,
        title: tab.state.title,
        pinned: tab.state.pinned,
        workspaceId,
        remote: this.workspace(workspaceId)?.remote,
      })
    if (this.closed.length > 25) this.closed.shift()
    this.host.detachView(tab.view)
    if (this.lastActive.get(workspaceId) === tab.id) this.lastActive.delete(workspaceId)
    if (this.activeId === tab.id) {
      this.activeId = null
      const remaining = this.tabsIn(workspaceId)
      const neighbour = remaining[Math.min(position, remaining.length - 1)]
      if (neighbour !== undefined) this.activate(neighbour.id)
      else if (this.tabs.length > 0 && this.workspaces.some((w) => w.id === workspaceId))
        this.create(NEW_TAB_URL, { workspaceId })
    }
    this.host.onChange()
  }

  closeOthers(id: TabId): void {
    const tab = this.get(id)
    if (tab === undefined) return
    if (this.activeId !== id) this.activate(id)
    for (const other of this.tabsIn(tab.state.workspaceId)) {
      if (other.id !== id && !other.state.pinned) this.close(other.id)
    }
  }

  closeRight(id: TabId): void {
    const tab = this.get(id)
    if (tab === undefined) return
    const siblings = this.tabsIn(tab.state.workspaceId)
    const right = siblings.slice(siblings.indexOf(tab) + 1).filter((t) => !t.state.pinned)
    if (right.some((t) => t.id === this.activeId)) this.activate(id)
    for (const other of right) this.close(other.id)
  }

  duplicate(id: TabId): Tab | undefined {
    const tab = this.get(id)
    if (tab === undefined) return undefined
    return this.create(this.urlOf(tab), {
      activate: true,
      index: this.indexOf(id) + 1,
      title: tab.state.title,
      workspaceId: tab.state.workspaceId,
    })
  }

  moveToWorkspace(id: TabId, workspaceId?: string): void {
    const tab = this.get(id)
    if (tab === undefined) return
    const target =
      workspaceId === undefined
        ? this.createWorkspace(undefined, undefined, false, this.workspaceOf(tab)?.remote)
        : this.workspaces.find((w) => w.id === workspaceId)
    if (target === undefined || target.id === tab.state.workspaceId) return
    if (!sameEgress(this.workspaceOf(tab), target)) {
      this.transplant(tab, target.id)
      this.host.onChange()
      return
    }
    const source = tab.state.workspaceId
    this.tabs.splice(this.indexOf(id), 1)
    tab.state = { ...tab.state, workspaceId: target.id }
    this.insert(tab)
    if (this.lastActive.get(source) === id) this.lastActive.delete(source)
    if (this.activeId === id) this.activate(id)
    this.host.onChange()
  }

  urlOf(tab: Tab): string {
    return tab.state.url.startsWith(SAD_TAB_URL) && tab.lastGoodUrl !== ''
      ? tab.lastGoodUrl
      : tab.state.url
  }

  reload(id: TabId | null = null): void {
    const tab = id === null ? this.active : this.get(id)
    if (tab === undefined || tab.webContents.isDestroyed()) return
    if (tab.pending) {
      tab.pending = false
      this.load(tab, tab.state.url)
      return
    }
    tab.webContents.reload()
  }

  setMuted(id: TabId, muted: boolean): void {
    const tab = this.get(id)
    if (tab === undefined || tab.webContents.isDestroyed()) return
    tab.webContents.setAudioMuted(muted)
    this.update(tab, { muted })
  }

  move(id: TabId, index: number): void {
    const tab = this.get(id)
    if (tab === undefined) return
    const siblings = this.tabsIn(tab.state.workspaceId)
    const from = siblings.indexOf(tab)
    const pinnedCount = siblings.filter((t) => t.state.pinned).length
    const to = tab.state.pinned
      ? Math.max(0, Math.min(index, pinnedCount - 1))
      : Math.max(pinnedCount, Math.min(index, siblings.length - 1))
    if (from === to) return
    this.tabs.splice(this.indexOf(tab.id), 1)
    const rest = siblings.filter((t) => t !== tab)
    const anchor = rest[to]
    const at =
      anchor === undefined
        ? this.indexOf(rest[rest.length - 1]?.id ?? '') + 1
        : this.indexOf(anchor.id)
    this.tabs.splice(at < 0 ? this.tabs.length : at, 0, tab)
    this.host.onChange()
  }

  navigate(id: TabId | null, input: string): void {
    const tab = id === null ? this.active : this.get(id)
    if (tab === undefined) return
    const resolved = resolveInput(input, this.host.getSettings().searchEngine)
    if (resolved.url === '' || tab.webContents.isDestroyed()) return
    tab.pending = false
    tab.retry = null
    this.load(tab, resolved.url)
  }

  open(input: string): Tab | undefined {
    const resolved = resolveInput(input, this.host.getSettings().searchEngine)
    if (resolved.url === '') return undefined
    return this.create(resolved.url, { activate: true })
  }

  reopen(): Tab | undefined {
    const last = this.closed.pop()
    if (last === undefined) return undefined
    return this.create(last.url, {
      activate: true,
      pinned: last.pinned === true,
      workspaceId: this.reopenTarget(last),
    })
  }

  private reopenTarget(last: ClosedTab): string {
    if (this.workspace(last.workspaceId) !== undefined) return last.workspaceId
    const egress = last.remote?.id
    const active = this.workspace(this.activeWorkspaceId)
    if (active !== undefined && active.remote?.id === egress) return active.id
    const same = this.workspaces.find((w) => w.remote?.id === egress)
    if (same !== undefined) return same.id
    return this.createWorkspace(last.remote?.name, undefined, false, last.remote).id
  }

  cycle(delta: number): void {
    const siblings = this.tabsIn(this.activeWorkspaceId)
    if (siblings.length === 0 || this.activeId === null) return
    const index = siblings.findIndex((t) => t.id === this.activeId)
    const next = siblings[(index + delta + siblings.length) % siblings.length]
    if (next !== undefined) this.activate(next.id)
  }

  select(index: number): void {
    const siblings = this.tabsIn(this.activeWorkspaceId)
    const tab = siblings[index < 0 ? siblings.length + index : index]
    if (tab !== undefined) this.activate(tab.id)
  }

  setBounds(rect: Rect): void {
    this.bounds = rect
    this.active?.view.setBounds(rect)
  }

  setRadius(radius: number): void {
    if (radius === this.radius) return
    this.radius = radius
    this.active?.view.setBorderRadius(radius)
  }

  getBounds(): Rect {
    return this.bounds
  }

  states(): TabState[] {
    return this.tabs.map((t) => ({ ...t.state }))
  }

  toSession(bounds: Rect | null): SessionWindow {
    const workspaceIndex = new Map(this.workspaces.map((w, i) => [w.id, i]))
    const tabs = this.tabs.map((t) => ({
      url: t.state.url,
      title: t.state.title,
      workspace: workspaceIndex.get(t.state.workspaceId) ?? 0,
      pinned: t.state.pinned,
    }))
    const activeIndex = this.activeId === null ? 0 : Math.max(0, this.indexOf(this.activeId))
    return {
      bounds,
      tabs,
      activeIndex,
      workspaces: this.workspaces.map((w) => ({ ...w })),
      activeWorkspace: workspaceIndex.get(this.activeWorkspaceId) ?? 0,
    }
  }

  destroy(): void {
    const tabs = [...this.tabs]
    this.tabs.length = 0
    this.activeId = null
    for (const tab of tabs) {
      this.host.detachView(tab.view)
      if (!tab.webContents.isDestroyed()) tab.webContents.close()
    }
  }

  private update(tab: Tab, patch: Partial<TabState>): void {
    if (this.indexOf(tab.id) === -1) return
    tab.state = { ...tab.state, ...patch }
    this.host.onChange()
  }

  private syncNavigation(tab: Tab): void {
    const wc = tab.webContents
    if (wc.isDestroyed()) return
    const history = wc.navigationHistory
    this.update(tab, {
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    })
  }

  private wire(tab: Tab): void {
    const wc = tab.webContents
    this.host.onContentsCreated(wc)
    this.host.onTabCreated(wc)

    wc.once('destroyed', () => this.remove(tab))
    wc.on('will-navigate', (event, url) => {
      if (url.startsWith(SAD_TAB_URL) && !tab.state.url.startsWith('app://')) event.preventDefault()
    })
    wc.on('did-start-loading', () => this.update(tab, { loading: true }))
    wc.on('did-stop-loading', () => {
      this.update(tab, { loading: false })
      this.syncNavigation(tab)
    })
    wc.on('did-navigate', (_event, navigated) => {
      const url = shownUrl(wc.getURL(), navigated)
      this.recording.delete(wc.id)
      const sad = url.startsWith(SAD_TAB_URL)
      if (!sad) tab.lastGoodUrl = url
      if (/^https?:/i.test(url)) tab.retry = null
      this.update(tab, {
        url,
        kind: tabKindOf(url),
        crashed: false,
        favicon: null,
        title: tab.state.title === '' ? hostOf(url) : tab.state.title,
      })
      this.syncNavigation(tab)
      if (this.workspaceOf(tab)?.remote === undefined) this.host.onVisit(url, '')
    })
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      this.update(tab, { url, kind: tabKindOf(url) })
      this.syncNavigation(tab)
    })
    wc.on('page-title-updated', (_event, title) => {
      this.update(tab, { title })
      if (this.workspaceOf(tab)?.remote === undefined) this.host.onTitle(tab.state.url, title)
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      const favicon = favicons.at(-1) ?? null
      if (favicon === null || this.workspaceOf(tab)?.remote === undefined) {
        this.update(tab, { favicon })
        return
      }
      const page = tab.state.url
      void inlineFavicon(wc.session, favicon).then((inlined) => {
        if (!wc.isDestroyed() && tab.state.url === page) this.update(tab, { favicon: inlined })
      })
    })
    wc.on('audio-state-changed', (event) => this.update(tab, { audible: event.audible }))
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || code === 0) return
      const workspace = this.workspaceOf(tab)
      if (
        workspace !== undefined &&
        this.host.loadFailed?.(tab, workspace, code, url, description) === true
      )
        return
      const target =
        this.host.failedLoad?.(wc, url, description) ??
        `${SAD_TAB_URL}?url=${encodeURIComponent(url)}&error=${encodeURIComponent(description)}`
      void wc.loadURL(target).catch(() => undefined)
    })
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      const target = `${SAD_TAB_URL}?url=${encodeURIComponent(tab.lastGoodUrl)}&error=${encodeURIComponent(details.reason)}`
      this.update(tab, { crashed: true, loading: false })
      void wc.loadURL(target).catch(() => undefined)
    })
    wc.on('before-input-event', (event, input) => {
      if (this.recording.has(wc.id)) return
      const action = matchShortcut(input)
      if (action === null) return
      if (action.action === 'find' && ownsFind(tab.state.url)) return
      if (/^https?:/i.test(tab.state.url) && isPageFirst(action, input)) {
        this.host.onPageFirstKey(tab, action, input.code)
        return
      }
      event.preventDefault()
      this.host.onShortcut(action)
    })
    wc.on('context-menu', (_event, params) => this.host.onContextMenu(tab, params))
    wc.on('input-event', (_event, input) => {
      if (input.type === 'mouseLeave') {
        this.host.onMouseLeave(
          isMouseEvent(input) ? { x: input.x + this.bounds.x, y: input.y + this.bounds.y } : null,
        )
        return
      }
      if (input.type !== 'mouseMove' || !isMouseEvent(input)) return
      this.host.onMouse({ x: input.x + this.bounds.x, y: input.y + this.bounds.y })
    })
    wc.on('focus', () => this.host.onChange())
    wc.setWindowOpenHandler((details) => {
      const popup =
        details.disposition === 'new-window' && /\b(width|height)\s*=/.test(details.features)
      if (popup) {
        return {
          action: 'allow',
          outlivesOpener: false,
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              session: wc.session,
              preload: this.host.preload,
              additionalArguments: [`${LAYER_ARG}page`],
              nodeIntegrationInSubFrames: true,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          },
        }
      }
      const activate = details.disposition !== 'background-tab'
      const index = this.activeId === null ? undefined : this.indexOf(this.activeId) + 1
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const guest = (options as { webContents?: WebContents }).webContents
          const view = new WebContentsView({
            ...(guest === undefined ? {} : { webContents: guest }),
            webPreferences: {
              ...options.webPreferences,
              session: wc.session,
              preload: this.host.preload,
              additionalArguments: [`${LAYER_ARG}page`],
              nodeIntegrationInSubFrames: true,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          })
          const opened = new Tab(view, details.url, openerWorkspace(this, tab))
          this.wire(opened)
          this.insert(opened, index)
          this.host.attachView(view)
          view.setVisible(false)
          if (guest === undefined) this.load(opened, details.url)
          if (activate) this.activate(opened.id)
          this.host.onChange()
          return opened.webContents
        },
      }
    })
    wc.on('did-create-window', (child) => {
      this.host.onContentsCreated(child.webContents)
    })
  }
}

function openerWorkspace(manager: TabManager, opener: Tab): string {
  return manager.get(opener.id)?.state.workspaceId ?? manager.activeWorkspace
}
