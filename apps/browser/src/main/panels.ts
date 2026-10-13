import { WebContentsView, type BrowserWindow, type Session, type WebContents } from 'electron'
import { LAYER_ARG, SIDEBAR_HEADER, type Rect, type WebPanel } from '@ewe/shared'

export const PANEL_INSET = 6

export interface PanelHostDeps {
  window: BrowserWindow
  session: Session
  preload: string
  onContentsCreated(contents: WebContents): void
  openTab(url: string): void
}

export function panelBounds(sidebar: Rect): Rect {
  return {
    x: sidebar.x + PANEL_INSET,
    y: sidebar.y + SIDEBAR_HEADER,
    width: Math.max(0, sidebar.width - PANEL_INSET),
    height: Math.max(0, sidebar.height - SIDEBAR_HEADER),
  }
}

export function panelId(url: string, taken: ReadonlySet<string>): string {
  let base: string
  try {
    base = new URL(url).hostname
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
  } catch {
    base = 'web'
  }
  base = base.replace(/^-+|-+$/g, '').slice(0, 48) || 'web'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export class PanelHost {
  private readonly views = new Map<string, { view: WebContentsView; url: string }>()
  private visible: string | null = null
  private readonly deps: PanelHostDeps

  constructor(deps: PanelHostDeps) {
    this.deps = deps
  }

  private ensure(panel: WebPanel): WebContentsView {
    const existing = this.views.get(panel.id)
    if (existing !== undefined) return existing.view
    const view = new WebContentsView({
      webPreferences: {
        session: this.deps.session,
        preload: this.deps.preload,
        additionalArguments: [`${LAYER_ARG}page`],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    view.setBorderRadius(0)
    this.deps.onContentsCreated(view.webContents)
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) this.deps.openTab(url)
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault()
    })
    view.setVisible(false)
    this.deps.window.contentView.addChildView(view)
    void view.webContents.loadURL(panel.url).catch(() => undefined)
    this.views.set(panel.id, { view, url: panel.url })
    return view
  }

  show(panel: WebPanel, bounds: Rect): void {
    if (this.visible !== null && this.visible !== panel.id)
      this.views.get(this.visible)?.view.setVisible(false)
    const view = this.ensure(panel)
    view.setBounds(bounds)
    view.setVisible(true)
    this.visible = panel.id
  }

  hide(): void {
    if (this.visible === null) return
    this.views.get(this.visible)?.view.setVisible(false)
    this.visible = null
  }

  raise(): void {
    for (const { view } of this.views.values()) this.deps.window.contentView.addChildView(view)
  }

  owns(contents: WebContents): boolean {
    for (const { view } of this.views.values()) if (view.webContents.id === contents.id) return true
    return false
  }

  prune(keep: ReadonlySet<string>): void {
    for (const [id, { view }] of this.views) {
      if (keep.has(id)) continue
      if (this.visible === id) this.visible = null
      this.close(view)
      this.views.delete(id)
    }
  }

  private close(view: WebContentsView): void {
    if (!this.deps.window.isDestroyed()) this.deps.window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  destroy(): void {
    for (const { view } of this.views.values()) this.close(view)
    this.views.clear()
  }
}
