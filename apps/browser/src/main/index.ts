import { basename, dirname, join, resolve } from 'node:path'
import {
  Menu,
  app,
  components,
  nativeTheme,
  session,
  webContents,
  type Session,
  type WebContents,
} from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import { FILES_PAGE_URL, HOME_URL, IPC, MUSIC_PAGE_URL, type SessionWindow } from '@ewe/shared'
import { chromeBookmarkPaths, readChromeBookmarks } from './chrome-bookmarks'
import { createCliHost } from './cli/host'
import { listenCli, type CliServer } from './cli/server'
import { socketPath } from './cli/socket'
import { DownloadManager } from './downloads'
import { DefaultHandler } from './files/default-handler'
import { ExtensionHost } from './extensions'
import { FileService } from './files/service'
import { HistoryService, registerHistoryIpc } from './history-service'
import { RecentsService } from './home/recents'
import { HomeService } from './home/service'
import { MusicLibraryStore } from './media/library'
import { openArgs } from './open-args'
import { readEweAccount } from './ewe-account'
import { readEweTheme, watchEweTheme } from './ewe-theme'
import { RemoteService, type RequestGate } from './remote/service'
import { applyIdentity, applyIdentityToContents } from './identity'
import { registerIpc } from './ipc'
import { SafeService } from './safe/service'
import { PermissionStore } from './privacy/permissions'
import { registerPrivacyIpc } from './privacy/ipc'
import { PrivacyService } from './privacy/service'
import {
  NO_DNS_PREFETCH,
  THIRD_PARTY_COOKIE_FEATURE,
  blinkSettingSwitch,
  featureSwitch,
  privacyAtStartup,
} from './privacy/startup'
import { SiteSearchStore } from './site-search/opensearch'
import { SiteSearchService } from './site-search/service'
import { installAppProtocol, registerAppScheme } from './protocol'
import { BookmarksStore } from './storage/bookmarks-store'
import { DownloadsStore } from './storage/downloads-store'
import { HistoryStore } from './storage/history-store'
import { RecentStore } from './storage/recent-store'
import { SessionStore } from './storage/session-store'
import { setShortcuts } from './shortcuts'
import { SettingsStore } from './storage/settings-store'
import { Startup } from './startup'
import { EweLink } from './sync/ewe-link'
import { SyncService } from './sync/service'
import {
  WindowManager,
  preloadPath,
  setEweBackground,
  type RendererEntry,
  type WindowController,
} from './window-manager'

const BLOCKED_TOAST_DELAY_MS = 1500
const BLOCKED_TOAST_TRIES = 20

let thirdPartyBlocked = false

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
  // No application menu. Electron installs a default one on Linux whose
  // accelerators stay live in a frameless window: Window → Minimize took
  // Ctrl+M (our mute) whenever the key went to a web page first, Close took
  // Ctrl+W. Every browser shortcut is ours (shortcuts.ts); editing keys in
  // inputs are Chromium's own on Linux and need no menu.
  Menu.setApplicationMenu(null)
  const widevine = components.whenReady().catch((error: unknown) => {
    console.error('[ewe] widevine', error)
    return []
  })
  await Promise.race([widevine, new Promise((resolve) => setTimeout(resolve, 2500))])

  const persistent = session.fromPartition('persist:default')
  let privacy: PrivacyService | null = null
  const privacyHeaders = () => privacy?.extraHeaders() ?? {}
  applyIdentity(session.defaultSession, privacyHeaders)

  const userData = app.getPath('userData')
  const recentStore = new RecentStore(userData)
  await recentStore.load()
  const files = new FileService({
    trashDir: process.env.EWE_TRASH_DIR,
    onOpened: (path) => recentStore.record(path, 'opened'),
  })

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
  const permissions = new PermissionStore(userData)
  await permissions.load()
  const privacyService = new PrivacyService({
    settings,
    permissions,
    thirdPartyBlocked,
    ask: (contents, origin, kinds, callback) => {
      const owner = windows.fromContents(contents)
      const ui = owner?.layer === 'page' ? owner.controller.privacyUi : null
      return ui?.ask(contents, origin, kinds, callback) ?? false
    },
  })
  privacy = privacyService
  privacyService.install(session.defaultSession)
  privacyService.applyDns()
  const siteSearchStore = new SiteSearchStore(userData)
  await siteSearchStore.load()
  const siteSearch = new SiteSearchService({
    store: siteSearchStore,
    history: () => history.all(),
    bookmarks: () => bookmarks.root(),
    engine: () => settings.get().searchEngine,
  })

  let remote: RemoteService | null = null
  app.on('web-contents-created', (_event, contents) => {
    if ((remote?.remoteOf(contents.session) ?? null) !== null)
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  })

  const onContentsCreated = (contents: WebContents): void => {
    applyIdentityToContents(contents)
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('did-navigate', () => privacyService.https.forget(contents.id))
    contents.once('destroyed', () => privacyService.https.forget(contents.id))
    siteSearch.watch(contents)
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
  const setupWebSession = (ses: Session, gate?: RequestGate, via?: string): void => {
    applyIdentity(ses, privacyHeaders)
    installAppProtocol(
      ses,
      join(__dirname, '../renderer'),
      is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
      () => files.token,
    )
    privacyService.install(ses, gate)
    if (via !== undefined) downloads.attach(ses, via)
  }
  setupWebSession(persistent)
  const remoteService = new RemoteService({
    userData,
    fromPartition: (partition) => session.fromPartition(partition),
    setup: (ses, gate) => {
      const id = remoteService.remoteOf(ses)
      setupWebSession(ses, gate, id ?? undefined)
    },
  })
  remote = remoteService
  downloads.retryThrough(async (via) => {
    const result = await remoteService.ensure(via)
    return result.ok ? remoteService.sessionFor(via) : null
  })
  let extensionTimer: NodeJS.Timeout | null = null
  const notifyBlocked = (message: string, tries = BLOCKED_TOAST_TRIES): void => {
    const target = windows.focused()
    if (target !== undefined && Date.now() - target.openedAt > BLOCKED_TOAST_DELAY_MS) {
      target.toast(message, 'alert')
      return
    }
    if (tries > 0) setTimeout(() => notifyBlocked(message, tries - 1), BLOCKED_TOAST_DELAY_MS)
  }
  const extensions: ExtensionHost = new ExtensionHost({
    session: persistent,
    preload: preloadPath(),
    createTab: (url, active, window): Electron.WebContents | null => {
      const target = windows.controllerOf(window) ?? windows.focused() ?? windows.all()[0]
      if (target === undefined) return null
      return target.tabs.create(url === '' ? HOME_URL : url, {
        activate: active,
        workspaceId: target.tabs.localWorkspace(),
      }).webContents
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
    onBlocked: (message) => notifyBlocked(message),
  })
  const eweLink = EweLink.detect()
  const sync = new SyncService({ userData, settings, bookmarks, history, ewe: eweLink })
  sync.on('status', (status) => {
    for (const contents of webContents.getAllWebContents())
      if (!contents.isDestroyed() && contents.getURL().startsWith('app://settings'))
        contents.send(IPC.syncStatus, status)
  })
  const appCommand = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()]
  const startup = new Startup(appCommand)
  const launchedInBackground = process.argv.includes('--background')
  const safe = new SafeService(settings)
  const windows: WindowManager = new WindowManager({
    extensions,
    safe,
    privacy: privacyService,
    permissions,
    siteInput: (input) => siteSearch.rewrite(input),
    session: persistent,
    remote: remoteService,
    settings,
    preload: preloadPath(),
    rendererUrl,
    onContentsCreated,
    getTheme: () => eweTheme,
    history,
    bookmarks,
    downloads,
    importChromeBookmarks: () => importChromeBookmarks(bookmarks),
    isMusicTrack: (path) => music.track(path) !== undefined,
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
  let homeTimer: NodeJS.Timeout | null = null
  const homeChanged = (): void => {
    if (homeTimer !== null) return
    homeTimer = setTimeout(() => {
      homeTimer = null
      for (const wc of webContents.getAllWebContents())
        if (!wc.isDestroyed() && wc.getURL().startsWith(HOME_URL)) wc.send(IPC.homeChanged)
    }, 400)
  }
  recentStore.on('change', homeChanged)
  history.on('change', homeChanged)
  music.on('change', homeChanged)
  let completed = 0
  bookmarks.on('change', (root) => windows.broadcastBookmarks(root))
  downloadsStore.on('change', (entries) => {
    windows.broadcastDownloads(entries)
    const done = entries.filter((e) => e.status === 'completed').length
    if (done !== completed) homeChanged()
    completed = done
  })
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
  const historyService = new HistoryService({
    history,
    settings,
    downloads: downloadsStore,
    sync,
    sessions: () => [persistent, session.defaultSession, ...remoteService.knownSessions()],
    extensionOrigins: () => extensions.state().list.map((e) => `chrome-extension://${e.id}`),
    onHistoryCleared: (from, to) => siteSearchStore.clearRange(from, to),
  })
  sync.setTabsSource(() => windows.toSession())
  history.setClock(() => sync.now())
  registerHistoryIpc(windows, historyService, sync)
  registerPrivacyIpc(windows, privacyService, permissions)
  historyService.start()
  app.on('will-quit', () => {
    unwatchTheme()
    safe.client.stop()
    files.dispose()
    sync.dispose()
    eweLink.dispose()
    historyService.dispose()
    void history.flush().then(() => history.close())
  })
  const recents = new RecentsService({
    records: () => recentStore.list(),
    hidden: () => recentStore.hidden(),
    history: (limit) => history.list('', limit),
    downloads: () => downloadsStore.list(),
    track: (path) => music.track(path),
  })
  registerIpc(windows, settings, {
    safe,
    getTheme: () => eweTheme,
    getAccount: readEweAccount,
    history,
    bookmarks,
    downloads: downloadsStore,
    files,
    music,
    recents: recentStore,
    home: new HomeService({
      store: recentStore,
      token: () => files.token,
      recents,
    }),
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
  eweLink.on('folders', () => {
    for (const wc of webContents.getAllWebContents())
      if (!wc.isDestroyed() && wc.getURL().startsWith(FILES_PAGE_URL)) wc.send(IPC.placesChanged)
    homeChanged()
  })
  eweLink.start()
  sync.start()

  const openTargets = (targets: ReturnType<typeof openArgs>, into?: WindowController): boolean => {
    if (targets.length === 0) return false
    const target = into ?? windows.focused() ?? windows.open()
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
    if (argv.includes('--new-window')) {
      const created = windows.open()
      if (!openTargets(targets, created)) created.win.focus()
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
  let lastFocused: number | null = null
  app.on('browser-window-focus', (_event, win) => (lastFocused = win.id))
  const cliSocket = socketPath(userData)
  let cli: CliServer | null = null
  listenCli(
    cliSocket,
    createCliHost({
      windows,
      history,
      bookmarks,
      downloads: downloadsStore,
      recents,
      music,
      settings,
      siteSearch,
      downloadAction: (id, action) => downloads.run(id, action),
      reopen,
      remote: remoteService,
      lastFocused: () => lastFocused,
      version: app.getVersion(),
      userData,
      socket: cliSocket,
    }),
  )
    .then((server) => (cli = server))
    .catch((error: unknown) => console.error('[ewe] command line socket', error))
  app.on('will-quit', () => cli?.close())
  app.on('before-quit', () => {
    if (windows.all().length > 0) sessions.save(windows.toSession())
    void sessions.flush()
    void settings.flush()
    void history.flush()
    void bookmarks.flush()
    void downloadsStore.flush()
    void recentStore.flush()
    void permissions.flush()
    void siteSearchStore.flush()
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

  thirdPartyBlocked = privacyAtStartup(app.getPath('userData')).blockThirdPartyCookies
  if (thirdPartyBlocked)
    app.commandLine.appendSwitch(
      'enable-features',
      featureSwitch(app.commandLine.getSwitchValue('enable-features'), THIRD_PARTY_COOKIE_FEATURE),
    )

  app.commandLine.appendSwitch(
    'blink-settings',
    blinkSettingSwitch(app.commandLine.getSwitchValue('blink-settings'), NO_DNS_PREFETCH),
  )
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
