import { basename, dirname, join, resolve } from 'node:path'
import {
  app,
  components,
  nativeTheme,
  session,
  webContents,
  type Session,
  type WebContents,
} from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import { HOME_URL, IPC, MUSIC_PAGE_URL, NEW_TAB_URL, type SessionWindow } from '@ewe/shared'
import { chromeBookmarkPaths, readChromeBookmarks } from './chrome-bookmarks'
import { DownloadManager } from './downloads'
import { DefaultHandler } from './files/default-handler'
import { ExtensionHost } from './extensions'
import { FileService } from './files/service'
import { MusicLibraryStore } from './media/library'
import { openArgs } from './open-args'
import { readEweAccount } from './ewe-account'
import { readEweTheme, watchEweTheme } from './ewe-theme'
import { applyIdentity, applyIdentityToContents } from './identity'
import { registerIpc } from './ipc'
import { installAppProtocol, registerAppScheme } from './protocol'
import { BookmarksStore } from './storage/bookmarks-store'
import { DownloadsStore } from './storage/downloads-store'
import { HistoryStore } from './storage/history-store'
import { SessionStore } from './storage/session-store'
import { setShortcuts } from './shortcuts'
import { SettingsStore } from './storage/settings-store'
import { Startup } from './startup'
import { SyncService } from './sync/service'
import { WindowManager, preloadPath, setEweBackground, type RendererEntry } from './window-manager'

const WEB_PERMISSIONS = new Set([
  'fullscreen',
  'pointerLock',
  'keyboardLock',
  'clipboard-sanitized-write',
])
const INTERNAL_PERMISSIONS = new Set([...WEB_PERMISSIONS, 'window-management'])

function permissionAllowed(permission: string, requestingUrl: string | undefined): boolean {
  const internal = requestingUrl?.startsWith('app://') ?? false
  return internal ? INTERNAL_PERMISSIONS.has(permission) : WEB_PERMISSIONS.has(permission)
}

function installPermissionHandlers(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permissionAllowed(permission, details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    permissionAllowed(permission, details.requestingUrl),
  )
}

async function importChromeBookmarks(bookmarks: BookmarksStore): Promise<string> {
  const result = await readChromeBookmarks(chromeBookmarkPaths())
  if (!result.ok) {
    return result.error === 'not-found'
      ? `No Chrome bookmarks found (looked in ${result.paths.join(', ')})`
      : 'The Chrome bookmarks file could not be read'
  }
  if (result.count === 0) return 'Chrome has no http(s) bookmarks to import'
  bookmarks.replaceFolder(result.folder)
  return `Imported ${result.count} bookmark${result.count === 1 ? '' : 's'} into "${result.folder.title}"`
}

function rendererUrl(entry: RendererEntry): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (is.dev && dev !== undefined) return `${dev}/${entry}/index.html`
  return `file://${join(__dirname, '../renderer', entry, 'index.html')}`
}

async function main(): Promise<void> {
  await app.whenReady()
  const widevine = components.whenReady().catch((error: unknown) => {
    console.error('[ewe] widevine', error)
    return []
  })
  await Promise.race([widevine, new Promise((resolve) => setTimeout(resolve, 2500))])

  const persistent = session.fromPartition('persist:default')
  applyIdentity(persistent)
  applyIdentity(session.defaultSession)
  installPermissionHandlers(persistent)
  installPermissionHandlers(session.defaultSession)

  const files = new FileService({ trashDir: process.env.EWE_TRASH_DIR })
  installAppProtocol(
    persistent,
    join(__dirname, '../renderer'),
    is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    () => files.token,
  )

  const userData = app.getPath('userData')
  const settings = new SettingsStore(userData)
  const sessions = new SessionStore(userData)
  const history = new HistoryStore(userData)
  const bookmarks = new BookmarksStore(userData)
  const downloadsStore = new DownloadsStore(userData)
  await settings.load()
  setShortcuts(settings.get().shortcuts)
  await history.load()
  await bookmarks.load()
  await downloadsStore.load()
  const music = new MusicLibraryStore(userData)
  await music.load()
  music.on('change', (library) => {
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed() && wc.getURL().startsWith(MUSIC_PAGE_URL))
        wc.send(IPC.musicChanged, library)
    }
  })
  let eweTheme = readEweTheme()
  const syncNativeTheme = (): void => {
    const mode = settings.get().theme
    nativeTheme.themeSource = mode === 'system' ? (eweTheme?.variant ?? 'system') : mode
    setEweBackground(mode === 'system' ? (eweTheme?.vars['--surface-base'] ?? null) : null)
  }
  syncNativeTheme()
  const restored = settings.get().restoreSession ? await sessions.load() : []

  const onContentsCreated = (contents: WebContents): void => {
    applyIdentityToContents(contents)
    contents.on('will-attach-webview', (event) => event.preventDefault())
  }

  let saveTimer: NodeJS.Timeout | null = null
  const windowFor = (contents: WebContents | null) =>
    (contents === null ? undefined : windows.fromContents(contents)?.controller) ??
    windows.focused()
  const downloads = new DownloadManager(
    persistent,
    downloadsStore,
    () => process.env.EWE_DOWNLOADS ?? app.getPath('downloads'),
    {
      onStart: (entry, source) =>
        windowFor(source)?.toast(`Downloading ${entry.filename}`, 'download'),
      onDone: (entry) =>
        windows
          .focused()
          ?.toast(
            entry.status === 'completed'
              ? `Downloaded ${entry.filename}`
              : `${entry.filename} failed`,
            entry.status === 'completed' ? 'check' : 'alert',
          ),
      onError: (message) => windows.focused()?.toast(message, 'alert'),
      onShow: (path) => windows.focused()?.openFiles(dirname(path), basename(path)),
    },
  )
  let extensionTimer: NodeJS.Timeout | null = null
  const extensions: ExtensionHost = new ExtensionHost({
    session: persistent,
    preload: preloadPath(),
    createTab: (url, active, window): Electron.WebContents | null => {
      const target = windows.controllerOf(window) ?? windows.focused() ?? windows.all()[0]
      if (target === undefined) return null
      return target.tabs.create(url === '' ? NEW_TAB_URL : url, { activate: active }).webContents
    },
    selectTab: (contents) => {
      const owner = windows.fromContents(contents)
      const tab = owner?.controller.tabs.byWebContents(contents)
      if (owner !== null && tab !== undefined) owner.controller.tabs.activate(tab.id)
    },
    removeTab: (contents) => {
      const owner = windows.fromContents(contents)
      const tab = owner?.controller.tabs.byWebContents(contents)
      if (owner !== null && tab !== undefined) owner.controller.tabs.close(tab.id)
    },
    createWindow: (url) =>
      windows.open(
        url === null ? undefined : { bounds: null, tabs: [{ url, title: url }], activeIndex: 0 },
      ).win,
    windowOf: (contents) => windows.fromContents(contents)?.controller.win ?? null,
    focusedWindow: () => windows.focused()?.win ?? null,
    confirmInstall: (request, window) =>
      (windows.controllerOf(window) ?? windows.focused())?.confirmExtension(request) ??
      Promise.resolve(false),
    onChange: () => {
      if (extensionTimer !== null) return
      extensionTimer = setTimeout(() => {
        extensionTimer = null
        windows.broadcastExtensions(extensions.state())
      }, 50)
    },
  })
  const sync = new SyncService({ userData, settings, bookmarks, history })
  sync.on('status', (status) => {
    for (const contents of webContents.getAllWebContents())
      if (!contents.isDestroyed() && contents.getURL().startsWith('app://settings'))
        contents.send(IPC.syncStatus, status)
  })
  const appCommand = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()]
  const startup = new Startup(appCommand)
  const launchedInBackground = process.argv.includes('--background')
  const windows: WindowManager = new WindowManager({
    extensions,
    session: persistent,
    settings,
    preload: preloadPath(),
    rendererUrl,
    onContentsCreated,
    getTheme: () => eweTheme,
    history,
    bookmarks,
    downloads,
    importChromeBookmarks: () => importChromeBookmarks(bookmarks),
    onSessionChange: () => {
      if (saveTimer !== null) return
      saveTimer = setTimeout(() => {
        saveTimer = null
        if (windows.all().length > 0) sessions.save(windows.toSession())
      }, 1000)
    },
    onClosing: () => {
      sessions.save(windows.toSession())
    },
    quit: () => app.quit(),
  })

  settings.on('change', (next) => {
    setShortcuts(next.shortcuts)
    syncNativeTheme()
    windows.broadcastSettings(next)
    windows.applyWindowColors()
    for (const c of windows.all()) c.layout()
  })
  bookmarks.on('change', (root) => windows.broadcastBookmarks(root))
  downloadsStore.on('change', (entries) => windows.broadcastDownloads(entries))
  let historyTimer: NodeJS.Timeout | null = null
  history.on('change', () => {
    if (historyTimer !== null) return
    historyTimer = setTimeout(() => {
      historyTimer = null
      windows.broadcastHistoryChanged()
    }, 500)
  })
  nativeTheme.on('updated', () => windows.applyWindowColors())
  const unwatchTheme = watchEweTheme((next) => {
    eweTheme = next
    syncNativeTheme()
    windows.broadcastTheme(next)
    windows.applyWindowColors()
    for (const c of windows.all()) c.layout()
  })
  app.on('will-quit', () => {
    unwatchTheme()
    files.dispose()
    sync.dispose()
  })
  registerIpc(windows, settings, {
    getTheme: () => eweTheme,
    getAccount: readEweAccount,
    history,
    bookmarks,
    downloads: downloadsStore,
    files,
    music,
    defaultHandler: new DefaultHandler(userData, appCommand),
    sync,
    extensions,
    startup,
  })

  const openSession = (saved: SessionWindow[]): void => {
    if (saved.length === 0)
      windows.open({
        bounds: null,
        tabs: [{ url: HOME_URL, title: 'Home' }],
        activeIndex: 0,
      })
    else for (const win of saved) windows.open(win)
  }
  const reopen = async (): Promise<void> => {
    await sessions.flush()
    openSession(settings.get().restoreSession ? await sessions.load() : [])
  }
  if (!launchedInBackground) openSession(restored)
  sync.start()

  const openTargets = (targets: ReturnType<typeof openArgs>): boolean => {
    if (targets.length === 0) return false
    const target = windows.focused() ?? windows.open()
    for (const t of targets) {
      if (t.kind === 'dir') target.openFiles(t.path)
      else target.tabs.create(t.url)
    }
    target.win.focus()
    return true
  }
  const self = app.isPackaged
    ? []
    : [app.getAppPath(), resolve(process.cwd(), process.argv[1] ?? '.')]
  openTargets(openArgs(process.argv, process.cwd(), self))
  app.on('second-instance', (_event, argv, cwd) => {
    const targets = openArgs(argv, cwd, self)
    if (windows.all().length === 0) {
      void reopen().then(() => openTargets(targets))
      return
    }
    if (openTargets(targets)) return
    const focused = windows.focused()
    if (focused === undefined) windows.open()
    else focused.win.focus()
  })
  app.on('activate', () => {
    if (windows.all().length === 0) windows.open()
  })
  app.on('before-quit', () => {
    if (windows.all().length > 0) sessions.save(windows.toSession())
    void sessions.flush()
    void settings.flush()
    void history.flush()
    void bookmarks.flush()
    void downloadsStore.flush()
    music.flush()
  })
  app.on('window-all-closed', () => {
    if (settings.get().background || launchedInBackground) return
    app.quit()
  })
}

function bootstrap(): void {
  app.setName('ewe-browser')
  const userDataOverride = process.env.EWE_USER_DATA
  if (userDataOverride !== undefined) app.setPath('userData', userDataOverride)

  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
    return
  }

  app.enableSandbox()
  registerAppScheme()
  app.commandLine.appendSwitch('disable-features', 'FedCm')
  electronApp.setAppUserModelId('io.github.prj786.ewe-browser')

  process.on('unhandledRejection', (reason) => {
    console.error('[ewe] unhandled rejection', reason)
  })

  main().catch((error: unknown) => {
    console.error('[ewe] startup failed', error)
    app.exit(1)
  })
}

bootstrap()
