import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { IPC, LAYER_ARG, type Rect, type SidebarSection, type UiEvent } from '@ewe/shared'

export interface SidebarHost {
  window: BrowserWindow
  preload: string
  url: string
  background(): string
  onContentsCreated(contents: WebContents): void
}

export class SidebarController {
  private view: WebContentsView | null = null
  section: SidebarSection | null = null
  private readonly host: SidebarHost

  constructor(host: SidebarHost) {
    this.host = host
  }

  get open(): boolean {
    return this.section !== null
  }

  get webContents(): WebContents | null {
    const wc = this.view?.webContents
    return wc === undefined || wc.isDestroyed() ? null : wc
  }

  private ensure(): WebContentsView {
    if (this.view !== null) return this.view
    const view = new WebContentsView({
      webPreferences: {
        preload: this.host.preload,
        additionalArguments: [`${LAYER_ARG}sidebar`],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    view.setBackgroundColor(this.host.background())
    view.setVisible(false)
    this.host.onContentsCreated(view.webContents)
    void view.webContents.loadURL(this.host.url).catch(() => undefined)
    this.host.window.contentView.addChildView(view)
    this.view = view
    return view
  }

  show(section: SidebarSection, bounds: Rect): void {
    const view = this.ensure()
    this.section = section
    view.setBounds(bounds)
    view.setVisible(true)
  }

  hide(): void {
    this.section = null
    this.view?.setVisible(false)
  }

  relayout(bounds: Rect | null): void {
    if (this.view === null) return
    if (bounds === null || this.section === null) {
      this.view.setVisible(false)
      return
    }
    this.view.setBounds(bounds)
    this.view.setVisible(true)
  }

  raise(): void {
    if (this.view !== null) this.host.window.contentView.addChildView(this.view)
  }

  focus(): void {
    const wc = this.webContents
    if (wc === null) return
    const run = () => {
      if (wc.isDestroyed() || this.section === null) return
      wc.focus()
      this.sendUi({ type: 'sidebar.focus' })
    }
    if (wc.isLoading()) wc.once('did-finish-load', run)
    else run()
  }

  applyBackground(): void {
    this.view?.setBackgroundColor(this.host.background())
  }

  sendUi(event: UiEvent): void {
    this.webContents?.send(IPC.ui, event)
  }

  destroy(): void {
    const view = this.view
    if (view === null) return
    this.view = null
    if (!this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
}
