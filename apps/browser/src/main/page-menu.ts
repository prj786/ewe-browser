import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { clipboard, webFrameMain, type ContextMenuParams, type WebContents } from 'electron'
import {
  IPC,
  SEARCH_ENGINES,
  isBookmarkableUrl,
  pageMenuAllows,
  searchUrl,
  type MenuTarget,
  type PageAction,
  type PageMenu,
  type Point,
  type SafeFieldKind,
  type Settings,
  type ToastIcon,
} from '@ewe/shared'
import type { OverlayController } from './overlay'
import { buildPageMenu, needsSafeProbe, savePageName } from './page-menu-model'
import { uniquePath } from './storage/downloads-store'
import type { Tab, TabManager } from './tab-manager'

export const SAFE_MENU_GUARD_MS = 500
export const PROBE_WAIT_MS = 150
const PROBE_FRESH_MS = 1_000

export interface FrameRef {
  processId: number
  routingId: number
  origin: string
}

export interface PageMenuHost {
  tabs: TabManager
  overlay: OverlayController
  settings(): Settings
  isBookmarked(url: string): boolean
  toggleBookmark(tab: Tab): void
  openMenu(target: MenuTarget, at: Point): void
  hideOverlay(): void
  openWindow(url: string): void
  downloadsDir(): string
  toast(message: string, icon: ToastIcon): void
  safeReady(): boolean
  armGenerate(contents: WebContents, frame: { processId: number; routingId: number }): void
}

interface OpenMenu {
  menu: PageMenu
  contents: WebContents
  pageUrl: string
  frame: FrameRef | null
  x: number
  y: number
  link: string
  src: string
  selection: string
  misspelled: string
  suggestions: string[]
  at: number
}

export function frameKey(ref: { processId: number; routingId: number }): string {
  return `${String(ref.processId)}:${String(ref.routingId)}`
}

const MEDIA_OPS: Record<string, [PageAction, PageAction]> = {
  'media.play': ['media.play', 'media.pause'],
  'media.mute': ['media.unmute', 'media.mute'],
  'media.loop': ['media.unloop', 'media.loop'],
  'media.controls': ['media.nocontrols', 'media.controls'],
}

export class PageMenus {
  private readonly host: PageMenuHost
  private current: OpenMenu | null = null
  private readonly probes = new Map<string, { kind: SafeFieldKind | null; at: number }>()
  private readonly waiters = new Map<string, (kind: SafeFieldKind | null) => void>()
  private readonly watched = new WeakSet<WebContents>()
  private opening = 0

  constructor(host: PageMenuHost) {
    this.host = host
    host.overlay.watch((part) => {
      if (part !== 'menu') this.current = null
    })
  }

  has(menuId: string): boolean {
    return this.current?.menu.menuId === menuId
  }

  forget(): void {
    this.current = null
  }

  private drop(contents: WebContents, frame?: { processId: number; routingId: number }): void {
    const s = this.current
    if (s?.contents !== contents) return
    if (frame !== undefined && (s.frame === null || frameKey(s.frame) !== frameKey(frame))) return
    this.current = null
    if (this.host.overlay.part === 'menu') this.host.hideOverlay()
  }

  private watch(contents: WebContents): void {
    if (this.watched.has(contents)) return
    this.watched.add(contents)
    contents.on('did-start-navigation', (details) => {
      if (details.isSameDocument) return
      const frame = details.frame
      if (details.isMainFrame || frame === null) this.drop(contents)
      else this.drop(contents, frame)
    })
    contents.on('render-process-gone', () => this.drop(contents))
    contents.once('destroyed', () => this.drop(contents))
  }

  probe(ref: { processId: number; routingId: number }, kind: SafeFieldKind | null): void {
    const key = frameKey(ref)
    const waiter = this.waiters.get(key)
    if (waiter !== undefined) {
      this.waiters.delete(key)
      waiter(kind)
      return
    }
    const now = Date.now()
    for (const [k, p] of this.probes) if (now - p.at > PROBE_FRESH_MS) this.probes.delete(k)
    this.probes.set(key, { kind, at: now })
  }

  private waitProbe(key: string): Promise<SafeFieldKind | null> {
    const known = this.probes.get(key)
    this.probes.delete(key)
    if (known !== undefined && Date.now() - known.at < PROBE_FRESH_MS)
      return Promise.resolve(known.kind)
    this.waiters.get(key)?.(null)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiters.get(key) === done) this.waiters.delete(key)
        resolve(null)
      }, PROBE_WAIT_MS)
      const done = (kind: SafeFieldKind | null) => {
        clearTimeout(timer)
        if (this.waiters.get(key) === done) this.waiters.delete(key)
        resolve(kind)
      }
      this.waiters.set(key, done)
    })
  }

  async open(tab: Tab, params: ContextMenuParams): Promise<void> {
    const contents = tab.webContents
    if (this.host.tabs.active !== tab) return
    const seq = ++this.opening
    this.watch(contents)
    const pageUrl = contents.getURL()
    const frame = params.frame
    const ref: FrameRef | null =
      frame === null || frame.isDestroyed()
        ? null
        : { processId: frame.processId, routingId: frame.routingId, origin: frame.origin }
    const probing = ref !== null && /^https?:/.test(frame?.url ?? '') && needsSafeProbe(params)
    const safe = probing && this.host.safeReady() ? await this.waitProbe(frameKey(ref)) : null
    if (seq !== this.opening || contents.isDestroyed() || this.host.tabs.active !== tab) return
    if (contents.getURL() !== pageUrl) return
    const part = this.host.overlay.part
    if (part === 'palette' || part === 'sheet') return
    const settings = this.host.settings()
    const url = this.host.tabs.urlOf(tab)
    const history = contents.navigationHistory
    const menu = buildPageMenu(params, {
      menuId: randomUUID(),
      engine: settings.searchEngine,
      engineName: SEARCH_ENGINES[settings.searchEngine].name,
      pageUrl: url,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      bookmarkable: isBookmarkableUrl(url),
      bookmarked: this.host.isBookmarked(url),
      safe,
    })
    this.current = {
      menu,
      contents,
      pageUrl,
      frame: ref,
      x: params.x,
      y: params.y,
      link: params.linkURL,
      src: params.srcURL,
      selection: menu.selection,
      misspelled: params.misspelledWord,
      suggestions: menu.edit?.suggestions ?? [],
      at: Date.now(),
    }
    const view = tab.view.getBounds()
    this.host.overlay.sendUi({ type: 'page.menu', menu })
    this.host.openMenu(
      { kind: 'page', id: menu.menuId },
      { x: view.x + params.x, y: view.y + params.y },
    )
  }

  private frameOf(ref: FrameRef | null): Electron.WebFrameMain | null {
    if (ref === null) return null
    const frame = webFrameMain.fromId(ref.processId, ref.routingId)
    if (frame === undefined || frame.isDestroyed() || frame.origin !== ref.origin) return null
    return frame
  }

  private act(ref: FrameRef | null, op: PageAction): void {
    try {
      this.frameOf(ref)?.send(IPC.pageAction, { op })
    } catch {
      return
    }
  }

  run(menuId: string, action: string): void {
    const s = this.current
    if (s?.menu.menuId !== menuId || !pageMenuAllows(s.menu, action)) return
    if (action.startsWith('safe.') && Date.now() - s.at < SAFE_MENU_GUARD_MS) return
    this.current = null
    const tab = this.host.tabs.byWebContents(s.contents)
    if (tab === undefined || s.contents.isDestroyed()) return
    if (s.contents.getURL() !== s.pageUrl) {
      this.host.hideOverlay()
      return
    }
    this.host.hideOverlay()
    const contents = s.contents
    const next = { index: this.host.tabs.indexOf(tab.id) + 1, workspaceId: tab.state.workspaceId }
    const media = s.menu.media
    const flip = MEDIA_OPS[action]
    if (flip !== undefined && media !== null) {
      const on =
        action === 'media.play'
          ? media.paused
          : action === 'media.mute'
            ? media.muted
            : action === 'media.loop'
              ? media.loop
              : media.controls
      this.act(s.frame, on ? flip[0] : flip[1])
      return
    }
    const spell = /^spell\.(\d)$/.exec(action)?.[1]
    if (spell !== undefined) {
      const word = s.suggestions[Number(spell)]
      if (word !== undefined) contents.replaceMisspelling(word)
      return
    }
    switch (action) {
      case 'link.tab':
        this.host.tabs.create(s.link, { ...next, activate: false })
        return
      case 'link.workspace': {
        const workspace = this.host.tabs.createWorkspace(undefined, undefined, false)
        this.host.tabs.create(s.link, { workspaceId: workspace.id })
        return
      }
      case 'link.window':
        this.host.openWindow(s.link)
        return
      case 'link.save':
        contents.downloadURL(s.link)
        return
      case 'link.copy':
        void clipboard.writeText(s.link).catch(() => undefined)
        return
      case 'media.tab':
        this.host.tabs.create(s.src, { ...next, activate: false })
        return
      case 'media.save':
        contents.downloadURL(s.src)
        return
      case 'media.copy':
        contents.copyImageAt(s.x, s.y)
        return
      case 'media.copyUrl':
        void clipboard.writeText(s.src).catch(() => undefined)
        return
      case 'selection.copy':
        contents.copy()
        return
      case 'selection.search':
        this.host.tabs.create(searchUrl(s.selection, this.host.settings().searchEngine), next)
        return
      case 'selection.open':
        if (s.menu.selectionUrl !== null) this.host.tabs.create(s.menu.selectionUrl, next)
        return
      case 'spell.add':
        contents.session.addWordToSpellCheckerDictionary(s.misspelled)
        return
      case 'safe.fill':
        this.act(s.frame, 'safe.fill')
        return
      case 'safe.generate':
        if (s.frame === null) return
        this.host.armGenerate(contents, s.frame)
        this.act(s.frame, 'safe.generate')
        return
      case 'edit.undo':
        contents.undo()
        return
      case 'edit.redo':
        contents.redo()
        return
      case 'edit.cut':
        contents.cut()
        return
      case 'edit.copy':
        contents.copy()
        return
      case 'edit.paste':
        contents.paste()
        return
      case 'edit.pastePlain':
        contents.pasteAndMatchStyle()
        return
      case 'edit.selectAll':
        contents.selectAll()
        return
      case 'page.back':
        contents.navigationHistory.goBack()
        return
      case 'page.forward':
        contents.navigationHistory.goForward()
        return
      case 'page.reload':
        this.host.tabs.reload(tab.id)
        return
      case 'page.bookmark':
        this.host.toggleBookmark(tab)
        return
      case 'page.save':
        this.savePage(tab)
        return
      case 'page.print':
        printPage(contents)
        return
      case 'page.source':
        viewSource(this.host.tabs, tab)
        return
      case 'inspect':
        contents.inspectElement(s.x, s.y)
        return
    }
  }

  savePage(tab: Tab): void {
    const contents = tab.webContents
    const url = this.host.tabs.urlOf(tab)
    if (!/^https?:/i.test(url)) return
    const dir = this.host.downloadsDir()
    const path = uniquePath(
      dir,
      savePageName(tab.state.title, url),
      (p) => existsSync(p) || existsSync(p.replace(/\.html$/, '_files')),
    )
    contents
      .savePage(path, 'HTMLComplete')
      .then(() => this.host.toast(`Saved ${basename(path)}`, 'check'))
      .catch(() => this.host.toast('The page could not be saved', 'alert'))
  }
}

export function printPage(contents: WebContents): void {
  if (contents.isDestroyed()) return
  contents.print({}, () => undefined)
}

export function viewSource(tabs: TabManager, tab: Tab): void {
  const url = tabs.urlOf(tab)
  if (!/^https?:/i.test(url)) return
  tabs.create(`view-source:${url}`, {
    index: tabs.indexOf(tab.id) + 1,
    workspaceId: tab.state.workspaceId,
  })
}
