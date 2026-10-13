import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  WebContentsView,
  app,
  nativeImage,
  session as electronSession,
  type BrowserWindow,
  type Session,
  type WebContents,
} from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import {
  MEASURE_POPUP,
  POPUP_MAX,
  badgeColor,
  localizedName,
  popupBounds,
  readJson,
  type ActionDetails,
} from './extension-helpers'
import {
  downloadExtension,
  installChromeWebStore,
  uninstallExtension,
  updateExtensions,
} from 'electron-chrome-web-store'
import {
  EXTENSION_PARTITION,
  storeExtensionId,
  type ExtensionInfo,
  type ExtensionInstallRequest,
  type ExtensionsState,
  type Rect,
} from '@ewe/shared'

interface BrowserActionApi {
  actionMap: Map<string, ActionDetails & { tabs: Record<string, ActionDetails> }>
  observers: Set<{ send?: (channel: string) => void; isDestroyed(): boolean }>
  getPopupUrl(extensionId: string, tabId: number): string | undefined
  activateClick(details: {
    extensionId: string
    tabId: number
    anchorRect: Rect
    alignment: string
  }): void
}

export interface ExtensionHostDeps {
  session: Session
  preload: string
  createTab(url: string, active: boolean, window: BrowserWindow | null): WebContents | null
  selectTab(contents: WebContents): void
  removeTab(contents: WebContents): void
  createWindow(url: string | null): BrowserWindow
  windowOf(contents: WebContents): BrowserWindow | null
  focusedWindow(): BrowserWindow | null
  confirmInstall(request: ExtensionInstallRequest, window: BrowserWindow | null): Promise<boolean>
  onChange(): void
}

function manifestOptionsUrl(extension: Electron.Extension): string | null {
  const manifest = extension.manifest as Record<string, unknown>
  const ui = manifest.options_ui as { page?: unknown } | undefined
  const page = typeof ui?.page === 'string' ? ui.page : manifest.options_page
  return typeof page === 'string' ? new URL(page, extension.url).href : null
}

export function describeExtension(
  extension: Electron.Extension,
  action: (ActionDetails & { tabs: Record<string, ActionDetails> }) | undefined,
  tabId: number | null,
): ExtensionInfo {
  const manifest = extension.manifest as Record<string, unknown>
  const tab = tabId === null ? undefined : action?.tabs[String(tabId)]
  const description = typeof manifest.description === 'string' ? manifest.description : ''
  const homepage =
    typeof manifest.homepage_url === 'string'
      ? manifest.homepage_url
      : `https://chromewebstore.google.com/detail/${extension.id}`
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    description: description.startsWith('__MSG_') ? '' : description,
    optionsUrl: manifestOptionsUrl(extension),
    homepageUrl: homepage,
    action:
      action === undefined
        ? null
        : {
            title: tab?.title ?? action.title ?? extension.name,
            badgeText: tab?.text ?? action.text ?? '',
            badgeColor: badgeColor(tab?.color ?? action.color),
            iconModified: tab?.iconModified ?? action.iconModified ?? 0,
            hasPopup: (tab?.popup ?? action.popup ?? '') !== '',
          },
  }
}

async function readInstalled(
  dir: string,
): Promise<{ name: string; icon: string | null; permissions: string[] }> {
  const manifest = (await readJson(join(dir, 'manifest.json'))) ?? {}
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  const icons = (manifest.icons ?? {}) as Record<string, unknown>
  const best = Object.entries(icons)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort((a, b) => Number(b[0]) - Number(a[0]))[0]
  let icon: string | null = null
  if (best !== undefined) {
    const image = nativeImage.createFromPath(join(dir, best[1]))
    if (!image.isEmpty()) icon = image.resize({ width: 64 }).toDataURL()
  }
  return {
    name: (await localizedName(dir, manifest)) || 'This extension',
    icon,
    permissions: [...strings(manifest.permissions), ...strings(manifest.host_permissions)].slice(
      0,
      24,
    ),
  }
}

class PopupHost {
  private view: WebContentsView | null = null
  private window: BrowserWindow | null = null
  private anchor: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private size = { width: 320, height: 240 }
  private shown = false
  extensionId: string | null = null

  constructor(private readonly session: Session) {}

  open(
    window: BrowserWindow,
    extensionId: string,
    url: string,
    anchor: Rect,
    radius: number,
  ): void {
    const toggle = this.extensionId === extensionId && this.window === window
    this.close()
    if (toggle) return
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        enablePreferredSizeMode: true,
      },
    })
    view.setBackgroundColor('#ffffff')
    view.setBorderRadius(radius)
    view.setBounds({ x: -POPUP_MAX.width - 100, y: 0, ...POPUP_MAX })
    this.view = view
    this.shown = false
    this.window = window
    this.anchor = anchor
    this.extensionId = extensionId
    window.contentView.addChildView(view)
    const contents = view.webContents
    contents.on('preferred-size-changed', (_event, size) => {
      this.size = size
      this.shown = true
      this.place()
      contents.focus()
    })
    contents.on('blur', () => {
      if (!contents.isDevToolsOpened()) setTimeout(() => this.closeIf(view), 50)
    })
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.close()
      }
    })
    contents.on('destroyed', () => this.closeIf(view))
    contents.setWindowOpenHandler(() => ({ action: 'allow' }))
    void contents.loadURL(url).then(
      () => {
        const measure = (): void => {
          if (this.view !== view || contents.isDestroyed()) return
          void contents
            .executeJavaScript(MEASURE_POPUP)
            .then((size: { width: number; height: number }) => {
              if (this.view !== view) return
              this.size = size
              const first = !this.shown
              this.shown = true
              this.place()
              if (first) contents.focus()
            })
            .catch(() => undefined)
        }
        measure()
        setTimeout(measure, 300)
        setTimeout(measure, 1200)
      },
      () => this.closeIf(view),
    )
  }

  private place(): void {
    if (this.view === null || this.window === null || this.window.isDestroyed() || !this.shown)
      return
    const [width = 0, height = 0] = this.window.getContentSize()
    this.view.setBounds(popupBounds(this.anchor, this.size, { width, height }))
  }

  raise(): void {
    if (this.view !== null && this.window !== null && !this.window.isDestroyed())
      this.window.contentView.addChildView(this.view)
  }

  owns(contents: WebContents): boolean {
    return this.view?.webContents.id === contents.id
  }

  private closeIf(view: WebContentsView): void {
    if (this.view === view) this.close()
  }

  close(): void {
    const view = this.view
    const window = this.window
    this.view = null
    this.window = null
    this.extensionId = null
    if (view === null) return
    if (window !== null && !window.isDestroyed()) window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
}

export class ExtensionHost {
  readonly extensions: ElectronChromeExtensions
  readonly popup: PopupHost
  readonly extensionsPath: string
  private readonly deps: ExtensionHostDeps
  private readonly pending = new Map<string, (allow: boolean) => void>()
  private activeTab: WebContents | null = null
  private ready: Promise<void>

  constructor(deps: ExtensionHostDeps) {
    this.deps = deps
    this.extensionsPath = process.env.EWE_EXTENSIONS ?? join(app.getPath('userData'), 'Extensions')
    this.popup = new PopupHost(deps.session)
    this.extensions = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: deps.session,
      createTab: (details) => {
        const window = details.windowId === undefined ? deps.focusedWindow() : null
        const contents = deps.createTab(details.url ?? '', details.active !== false, window)
        const owner = contents === null ? null : deps.windowOf(contents)
        if (contents === null || owner === null) return Promise.reject(new Error('No window'))
        return Promise.resolve([contents, owner])
      },
      selectTab: (contents) => deps.selectTab(contents),
      removeTab: (contents) => deps.removeTab(contents),
      createWindow: (details) => {
        const url = Array.isArray(details.url) ? (details.url[0] ?? null) : (details.url ?? null)
        return Promise.resolve(deps.createWindow(url))
      },
      removeWindow: (window) => {
        if (!window.isDestroyed()) window.close()
      },
    })
    const alias = join(dirname(deps.preload), 'extension.js')
    deps.session.registerPreloadScript({
      id: 'ewe-browser-alias',
      type: 'service-worker',
      filePath: alias,
    })
    deps.session.registerPreloadScript({
      id: 'ewe-browser-alias-frame',
      type: 'frame',
      filePath: alias,
    })
    ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession)
    ElectronChromeExtensions.handleCRXProtocol(deps.session)
    this.browserAction().observers.add({
      send: () => deps.onChange(),
      isDestroyed: () => false,
    })
    const sessionExtensions = deps.session.extensions
    sessionExtensions.on('extension-loaded', () => deps.onChange())
    sessionExtensions.on('extension-unloaded', () => deps.onChange())
    this.ready = installChromeWebStore({
      session: deps.session,
      extensionsPath: this.extensionsPath,
      autoUpdate: true,
      beforeInstall: async (details) => {
        const allow = await this.confirm(details)
        return { action: allow ? 'allow' : 'deny' }
      },
    }).catch((error: unknown) => {
      console.error('[ewe] chrome web store', error)
    })
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  private browserAction(): BrowserActionApi {
    return (this.extensions as unknown as { api: { browserAction: BrowserActionApi } }).api
      .browserAction
  }

  private async confirm(details: {
    id: string
    localizedName: string
    manifest: chrome.runtime.Manifest
    icon: Electron.NativeImage
    browserWindow?: BrowserWindow | undefined
  }): Promise<boolean> {
    const manifest = details.manifest as unknown as Record<string, unknown>
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    const request: ExtensionInstallRequest = {
      requestId: randomUUID(),
      id: details.id,
      name: details.localizedName,
      icon: details.icon.isEmpty() ? null : details.icon.resize({ width: 64 }).toDataURL(),
      permissions: [...strings(manifest.permissions), ...strings(manifest.host_permissions)].slice(
        0,
        24,
      ),
    }
    return this.deps.confirmInstall(request, details.browserWindow ?? this.deps.focusedWindow())
  }

  addTab(contents: WebContents, window: BrowserWindow): void {
    this.extensions.addTab(contents, window)
  }

  selectTab(contents: WebContents): void {
    this.activeTab = contents
    if (!contents.isDestroyed()) this.extensions.selectTab(contents)
    this.deps.onChange()
  }

  state(): ExtensionsState {
    const tab = this.activeTab !== null && !this.activeTab.isDestroyed() ? this.activeTab : null
    const tabId = tab?.id ?? null
    const actions = this.browserAction().actionMap
    const list = this.deps.session.extensions
      .getAllExtensions()
      .map((extension) => describeExtension(extension, actions.get(extension.id), tabId))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { partition: EXTENSION_PARTITION, tabId, list }
  }

  activate(window: BrowserWindow, id: string, anchor: Rect, radius: number): void {
    const tab = this.activeTab
    if (tab === null || tab.isDestroyed()) return
    const api = this.browserAction()
    const url = api.getPopupUrl(id, tab.id)
    if (url !== undefined) this.popup.open(window, id, url, anchor, radius)
    else api.activateClick({ extensionId: id, tabId: tab.id, anchorRect: anchor, alignment: '' })
  }

  optionsUrl(id: string): string | null {
    const extension = this.deps.session.extensions.getExtension(id)
    return extension === null ? null : manifestOptionsUrl(extension)
  }

  async remove(id: string): Promise<void> {
    if (this.popup.extensionId === id) this.popup.close()
    await uninstallExtension(id, {
      session: this.deps.session,
      extensionsPath: this.extensionsPath,
    }).catch(() => {
      this.deps.session.extensions.removeExtension(id)
    })
    this.deps.onChange()
  }

  async installFromStore(
    source: string,
    window: BrowserWindow,
  ): Promise<{ ok: boolean; message: string } | null> {
    const id = storeExtensionId(source)
    if (id === null) return { ok: false, message: 'That is not a Chrome Web Store link' }
    const existing = this.deps.session.extensions.getExtension(id)
    if (existing !== null) return { ok: true, message: `${existing.name} is already added` }
    let path: string
    try {
      path = await downloadExtension(id, this.extensionsPath)
    } catch {
      return { ok: false, message: 'Could not download the extension' }
    }
    const details = await readInstalled(path)
    const request: ExtensionInstallRequest = {
      requestId: randomUUID(),
      id,
      name: details.name,
      icon: details.icon,
      permissions: details.permissions,
    }
    const allow = await this.deps.confirmInstall(request, window)
    if (!allow) {
      await rm(join(this.extensionsPath, id), { recursive: true, force: true })
      return null
    }
    try {
      const extension = await this.deps.session.extensions.loadExtension(path)
      this.deps.onChange()
      return { ok: true, message: `${extension.name} added` }
    } catch (error: unknown) {
      console.error('[ewe] extension install', error)
      await rm(join(this.extensionsPath, id), { recursive: true, force: true })
      return { ok: false, message: 'Could not add the extension' }
    }
  }

  update(): Promise<void> {
    return updateExtensions(this.deps.session).then(() => this.deps.onChange())
  }

  settle(requestId: string, allow: boolean): void {
    const resolve = this.pending.get(requestId)
    this.pending.delete(requestId)
    resolve?.(allow)
  }

  waitFor(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve)
      setTimeout(() => {
        if (this.pending.delete(requestId)) resolve(false)
      }, 120_000)
    })
  }
}
