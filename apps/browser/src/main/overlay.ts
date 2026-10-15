import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { IPC, LAYER_ARG, type OverlayPart, type Rect, type Size, type UiEvent } from '@ewe/shared'
import { overlayBounds } from './layout'

const HIDE_ANIMATION_MS = 160

export interface OverlayHost {
  window: BrowserWindow
  preload: string
  url: string
  onContentsCreated(contents: WebContents): void
}

export class OverlayController {
  readonly view: WebContentsView
  part: OverlayPart = 'none'
  private readonly host: OverlayHost
  private size: Size = { width: 0, height: 0 }
  private area: Rect | undefined
  shownAt = 0
  private hideTimer: NodeJS.Timeout | null = null
  private shrinkTimer: NodeJS.Timeout | null = null
  private fixed: Rect | null = null
  private readonly watchers = new Set<(part: OverlayPart) => void>()

  constructor(host: OverlayHost) {
    this.host = host
    this.view = new WebContentsView({
      webPreferences: {
        preload: host.preload,
        additionalArguments: [`${LAYER_ARG}overlay`],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        transparent: true,
      },
    })
    this.view.setBackgroundColor('#00000000')
    this.view.setVisible(false)
    host.onContentsCreated(this.view.webContents)
    void this.view.webContents.loadURL(host.url).catch(() => undefined)
  }

  get webContents(): WebContents {
    return this.view.webContents
  }

  raise(): void {
    const content = this.host.window.contentView
    content.addChildView(this.view)
  }

  relayout(size: Size, area: Rect | undefined = this.area): void {
    this.size = size
    this.area = area
    if (this.part === 'none' || this.fixed !== null) return
    this.clearShrink()
    const bounds = overlayBounds(this.part, size, area)
    if (bounds !== null) this.view.setBounds(bounds)
  }

  watch(fn: (part: OverlayPart) => void): () => void {
    this.watchers.add(fn)
    return () => this.watchers.delete(fn)
  }

  private setPart(part: OverlayPart): void {
    if (this.part === part) return
    this.part = part
    for (const fn of this.watchers) fn(part)
  }

  place(part: OverlayPart, rect: Rect | null): void {
    if (this.part !== part || this.fixed === null) return
    if (rect === null) {
      this.view.setVisible(false)
      return
    }
    this.fixed = rect
    this.view.setBounds(rect)
    this.view.setVisible(true)
  }

  private clearShrink(): void {
    if (this.shrinkTimer === null) return
    clearTimeout(this.shrinkTimer)
    this.shrinkTimer = null
  }

  show(part: OverlayPart, size: Size = this.size, extra?: UiEvent, at?: Rect): void {
    if (part === 'none') {
      this.hide()
      return
    }
    this.size = size
    const bounds = at ?? overlayBounds(part, size, this.area)
    if (bounds === null) return
    this.fixed = at ?? null
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.clearShrink()
    const changed = this.part !== part
    const fromMenu = this.part === 'menu'
    this.setPart(part)
    if (changed) this.shownAt = Date.now()
    if (fromMenu && changed) {
      this.shrinkTimer = setTimeout(() => {
        this.shrinkTimer = null
        this.view.setBounds(bounds)
      }, HIDE_ANIMATION_MS)
    } else this.view.setBounds(bounds)
    this.view.setVisible(true)
    if (changed) this.sendUi({ type: 'overlay.show', part })
    if (extra !== undefined) this.sendUi(extra)
    if (part === 'palette' || part === 'menu' || part === 'sheet') this.view.webContents.focus()
  }

  hide(): void {
    if (this.part === 'none') return
    this.fixed = null
    this.setPart('none')
    this.clearShrink()
    this.sendUi({ type: 'overlay.hide' })
    if (this.hideTimer !== null) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.view.setVisible(false)
      this.sendUi({ type: 'overlay.show', part: 'none' })
    }, HIDE_ANIMATION_MS)
  }

  sendUi(event: UiEvent): void {
    if (this.view.webContents.isDestroyed()) return
    this.view.webContents.send(IPC.ui, event)
  }

  destroy(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer)
    this.clearShrink()
    if (!this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}
