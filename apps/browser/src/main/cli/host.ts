import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  HOME_URL,
  filesUrl,
  resolveInput,
  searchTracks,
  searchUrl,
  type RecentFilter,
} from '@ewe/shared'
import type { RecentsService } from '../home/recents'
import type { MusicLibraryStore } from '../media/library'
import type { BookmarksStore } from '../storage/bookmarks-store'
import type { DownloadsStore } from '../storage/downloads-store'
import type { HistoryStore } from '../storage/history-store'
import type { SettingsStore } from '../storage/settings-store'
import type { Tab } from '../tab-manager'
import type { WindowController, WindowManager } from '../window-manager'
import { bookmarkWrite, readTool, trackOut, type CliTab, type Sources } from './data'
import { failure, type CliReply } from './socket'
import type { Args } from './tools'

export interface CliHostDeps {
  windows: WindowManager
  history: HistoryStore
  bookmarks: BookmarksStore
  downloads: DownloadsStore
  recents: RecentsService
  music: MusicLibraryStore
  settings: SettingsStore
  reopen(): Promise<void>
  version: string
  userData: string
  socket: string
}

const PAGE_WORLD = 1010
const PAGE_TIMEOUT_MS = 3000

const close = (id: string) => ['ewe-browser', 'tab', 'close', id]

function pageScript(withText: boolean, max: number): string {
  return `(() => {
    const selection = String(window.getSelection() ?? '').slice(0, ${max})
    const body = ${withText ? "document.body ? document.body.innerText : ''" : 'null'}
    return {
      selection,
      text: body === null ? null : body.slice(0, ${max}),
      truncated: body !== null && body.length > ${max},
      lang: document.documentElement.lang || null,
    }
  })()`
}

export function createCliHost(deps: CliHostDeps): (tool: string, args: Args) => Promise<CliReply> {
  const { windows } = deps
  const tabOut = (c: WindowController, tab: Tab): CliTab => {
    const s = tab.state
    return {
      id: tab.id,
      title: s.title,
      url: c.tabs.urlOf(tab),
      kind: s.kind,
      active: c.tabs.activeTabId === tab.id,
      pinned: s.pinned,
      audible: s.audible,
      muted: s.muted,
      loading: s.loading,
      workspace: c.tabs.workspaceList().find((w) => w.id === s.workspaceId)?.name ?? '',
      window: c.id,
    }
  }
  const sources: Sources = {
    running: true,
    windows: () =>
      windows.all().map((c) => ({
        id: c.id,
        focused: c.win.isFocused(),
        activeTab: c.tabs.activeTabId,
        tabs: c.tabs.list().length,
      })),
    tabs: () => windows.all().flatMap((c) => c.tabs.list().map((t) => tabOut(c, t))),
    workspaces: () =>
      windows.all().flatMap((c) =>
        c.tabs.workspaceList().map((w) => ({
          window: c.id,
          id: w.id,
          name: w.name,
          color: w.color,
          active: w.id === c.tabs.activeWorkspace,
          tabs: c.tabs.tabsIn(w.id).length,
        })),
      ),
    history: (query, limit) => deps.history.list(query, limit),
    bookmarks: () => deps.bookmarks.root(),
    downloads: () => deps.downloads.list(),
    recents: (filter: RecentFilter, limit) => deps.recents.collect(filter, limit),
    tracks: () => deps.music.snapshot().tracks,
  }

  const current = (): WindowController | undefined => windows.focused() ?? windows.all()[0]
  const target = async (newWindow = false): Promise<WindowController> => {
    if (newWindow) return windows.open()
    let c = current()
    if (c === undefined) {
      await deps.reopen()
      c = current()
    }
    return c ?? windows.open()
  }
  const show = (c: WindowController) => {
    if (c.win.isMinimized()) c.win.restore()
    c.win.show()
    c.win.focus()
  }
  const findTab = (id: string): { c: WindowController; tab: Tab } | CliReply => {
    const hits = windows
      .all()
      .flatMap((c) => c.tabs.list().map((tab) => ({ c, tab })))
      .filter(({ tab }) => tab.id === id || (id.length >= 4 && tab.id.startsWith(id)))
    const exact = hits.find(({ tab }) => tab.id === id)
    if (exact !== undefined) return exact
    if (hits.length === 1 && hits[0] !== undefined) return hits[0]
    if (hits.length > 1) return failure('ambiguous-id', `${id} matches ${hits.length} tabs`)
    return failure('no-tab', `no open tab has the id ${id}`, 'ewe-browser tabs')
  }
  const titleFor = (url: string) =>
    windows
      .all()
      .flatMap((c) => c.tabs.list())
      .find((t) => t.state.url === url)?.state.title

  return async (tool, args) => {
    const str = (key: string) => (typeof args[key] === 'string' ? args[key] : '')
    const yes = (key: string) => args[key] === true
    switch (tool) {
      case 'status': {
        const all = windows.all()
        const c = current()
        const active = c?.tabs.active
        return {
          ok: true,
          running: true,
          version: deps.version,
          pid: process.pid,
          profile: deps.userData,
          socket: deps.socket,
          windows: all.length,
          tabs: all.reduce((n, w) => n + w.tabs.list().length, 0),
          focused: all.some((w) => w.win.isFocused()),
          activeTab:
            c === undefined || active === undefined
              ? null
              : { id: active.id, title: active.state.title, url: c.tabs.urlOf(active) },
        }
      }
      case 'tabs':
      case 'history':
      case 'bookmarks':
      case 'downloads':
      case 'recent':
      case 'music':
      case 'find':
        return readTool(tool, args, sources)
      case 'page': {
        const c = current()
        const tab = c?.tabs.active
        if (c === undefined || tab === undefined) return failure('no-tab', 'no tab is open')
        const url = c.tabs.urlOf(tab)
        const head = {
          ok: true as const,
          untrusted: true,
          tab: { id: tab.id, title: tab.state.title, url },
        }
        if (!/^https?:/i.test(url) || tab.webContents.isDestroyed())
          return { ...head, selection: '', text: null, truncated: false, lang: null }
        const max = typeof args.max === 'number' ? args.max : 20000
        const read = tab.webContents.executeJavaScriptInIsolatedWorld(PAGE_WORLD, [
          { code: pageScript(yes('text'), max) },
        ]) as Promise<Record<string, unknown>>
        const timeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), PAGE_TIMEOUT_MS),
        )
        const result = await Promise.race([read.catch(() => null), timeout])
        if (result === null) return failure('page-busy', 'the page did not answer in time')
        return { ...head, ...result }
      }
      case 'open': {
        const c = await target(yes('newWindow'))
        const background = yes('background')
        const opened: { id: string; url: string; target: string }[] = []
        const failed: { target: string; error: string }[] = []
        const targets = Array.isArray(args.targets) ? args.targets : []
        for (const t of targets) {
          let url: string
          if (isAbsolute(t)) {
            const info = await stat(t).catch(() => null)
            if (info === null) {
              failed.push({ target: t, error: 'not-found' })
              continue
            }
            url = info.isDirectory() ? filesUrl(t) : pathToFileURL(t).href
          } else {
            url = resolveInput(t, deps.settings.get().searchEngine).url
            if (url === '') {
              failed.push({ target: t, error: 'not-openable' })
              continue
            }
          }
          const tab = c.tabs.create(url, { activate: !background })
          opened.push({ id: tab.id, url, target: t })
        }
        if (opened.length === 0)
          return { ...failure('nothing-opened', 'none of the targets could be opened'), failed }
        if (!background) show(c)
        return {
          ok: true,
          window: c.id,
          tabs: opened,
          failed,
          undo: opened.map((o) => close(o.id)),
        }
      }
      case 'search': {
        const c = await target(yes('newWindow'))
        const engine = deps.settings.get().searchEngine
        const url = searchUrl(str('query').trim(), engine)
        const tab = c.tabs.create(url, { activate: true })
        show(c)
        return { ok: true, engine, url, tab: { id: tab.id }, window: c.id, undo: [close(tab.id)] }
      }
      case 'play': {
        const query = str('query').trim()
        if (isAbsolute(query)) {
          const info = await stat(query).catch(() => null)
          if (!info?.isFile()) return failure('not-found', `${query} is not a file`)
          const c = await target()
          const known = deps.music.track(query)
          c.playMusic(query)
          return {
            ok: true,
            via: known === undefined ? 'viewer' : 'library',
            track: known === undefined ? { title: basename(query), path: query } : trackOut(known),
          }
        }
        const hits = searchTracks([...deps.music.snapshot().tracks], query)
        const best = hits[0]
        if (best !== undefined) {
          const c = await target()
          c.playMusic(best.path)
          return {
            ok: true,
            via: 'library',
            track: trackOut(best),
            alternatives: hits.slice(1, 5).map(trackOut),
          }
        }
        if (yes('local'))
          return failure(
            'no-match',
            `nothing in the music library matches "${query}"`,
            'leave out --local to search YouTube Music',
          )
        const c = await target()
        const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`
        const tab = c.tabs.create(url, { activate: true })
        show(c)
        return { ok: true, via: 'web', url, tab: { id: tab.id }, undo: [close(tab.id)] }
      }
      case 'reveal': {
        const path = str('path')
        const info = await stat(path).catch(() => null)
        if (info === null) return failure('not-found', `${path} does not exist`)
        const c = await target()
        const parent = dirname(path)
        if (parent === path) c.openFiles(path)
        else c.openFiles(parent, basename(path))
        const tab = c.tabs.active
        return {
          ok: true,
          path,
          tab: tab === undefined ? null : { id: tab.id },
          undo: tab === undefined ? [] : [close(tab.id)],
        }
      }
      case 'home': {
        const c = await target()
        const tab = c.tabs.create(HOME_URL, { activate: true })
        show(c)
        return { ok: true, tab: { id: tab.id }, window: c.id, undo: [close(tab.id)] }
      }
      case 'focus': {
        const c = await target()
        show(c)
        return { ok: true, window: c.id }
      }
      case 'tab_reopen': {
        const c = current()
        if (c === undefined) return failure('not-running', 'no browser window is open')
        const tab = c.tabs.reopen()
        if (tab === undefined)
          return failure('nothing-to-reopen', 'no tab was closed in this window')
        show(c)
        return { ok: true, tab: { id: tab.id, url: tab.state.url }, undo: [close(tab.id)] }
      }
      case 'tab_activate':
      case 'tab_close':
      case 'tab_reload':
      case 'tab_mute':
      case 'tab_unmute':
      case 'tab_pin':
      case 'tab_unpin': {
        const found = findTab(str('id'))
        if ('ok' in found) return found
        const { c, tab } = found
        const id = tab.id
        const before = { title: tab.state.title, url: c.tabs.urlOf(tab) }
        switch (tool) {
          case 'tab_activate': {
            const previous = c.tabs.activeTabId
            c.tabs.activate(id)
            show(c)
            return {
              ok: true,
              tab: { id, ...before },
              undo:
                previous === null || previous === id
                  ? []
                  : [['ewe-browser', 'tab', 'activate', previous]],
            }
          }
          case 'tab_close': {
            const lastTab = c.tabs.list().length === 1
            const reopenable = tab.state.kind === 'page' && !lastTab
            c.tabs.close(id)
            if (c.tabs.list().length === 0) c.win.close()
            return {
              ok: true,
              tab: { id, ...before },
              undo: [
                reopenable ? ['ewe-browser', 'tab', 'reopen'] : ['ewe-browser', 'open', before.url],
              ],
            }
          }
          case 'tab_reload':
            c.tabs.reload(id)
            return { ok: true, tab: { id, ...before } }
          case 'tab_mute':
          case 'tab_unmute': {
            const muted = tool === 'tab_mute'
            c.tabs.setMuted(id, muted)
            return {
              ok: true,
              tab: { id, ...before, muted },
              undo: [['ewe-browser', 'tab', muted ? 'unmute' : 'mute', id]],
            }
          }
          default: {
            const pinned = tool === 'tab_pin'
            c.tabs.setPinned(id, pinned)
            return {
              ok: true,
              tab: { id, ...before, pinned },
              undo: [['ewe-browser', 'tab', pinned ? 'unpin' : 'pin', id]],
            }
          }
        }
      }
      case 'bookmark_add':
      case 'bookmark_remove':
        return bookmarkWrite(tool, args, deps.bookmarks, titleFor, true)
      default:
        return failure('unknown-verb', `unknown tool: ${tool}`)
    }
  }
}
