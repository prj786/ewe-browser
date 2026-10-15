import { RecentsService } from '../home/recents'
import { MusicLibraryStore } from '../media/library'
import { BookmarksStore } from '../storage/bookmarks-store'
import { DownloadsStore } from '../storage/downloads-store'
import { HistoryStore } from '../storage/history-store'
import { RecentStore } from '../storage/recent-store'
import { SessionStore } from '../storage/session-store'
import { bookmarkWrite, readTool, type CliTab, type Sources } from './data'
import type { CliReply } from './socket'
import type { Args } from './tools'

const NEEDS: Record<string, string[]> = {
  status: ['session'],
  tabs: ['session'],
  history: ['history'],
  bookmarks: ['bookmarks'],
  downloads: ['downloads'],
  recent: ['recent', 'history', 'downloads', 'music'],
  music: ['music'],
  find: ['session', 'history', 'bookmarks', 'downloads', 'recent', 'music'],
}

export async function diskSources(userData: string, tool: string): Promise<Sources> {
  const need = new Set(NEEDS[tool] ?? [])
  const history = new HistoryStore(userData)
  const bookmarks = new BookmarksStore(userData)
  const downloads = new DownloadsStore(userData)
  const recent = new RecentStore(userData)
  const music = new MusicLibraryStore(userData)
  const session = new SessionStore(userData)
  const [windows] = await Promise.all([
    need.has('session') ? session.load() : Promise.resolve([]),
    need.has('history') ? history.loadSnapshot() : undefined,
    need.has('bookmarks') ? bookmarks.load() : undefined,
    need.has('downloads') ? downloads.load() : undefined,
    need.has('recent') ? recent.load() : undefined,
    need.has('music') ? music.load() : undefined,
  ])
  const recents = new RecentsService({
    records: () => recent.list(),
    hidden: () => recent.hidden(),
    history: (limit) => history.list('', limit),
    downloads: () => downloads.list(),
    track: (path) => music.track(path),
  })
  const tabs: CliTab[] = windows.flatMap((w, index) =>
    w.tabs.map((t, i) => ({
      id: null,
      title: t.title,
      url: t.url,
      kind: 'saved',
      active: i === w.activeIndex,
      pinned: t.pinned === true,
      audible: false,
      muted: false,
      loading: false,
      workspace: w.workspaces?.[t.workspace ?? 0]?.name ?? '',
      window: index + 1,
    })),
  )
  return {
    running: false,
    windows: () =>
      windows.map((w, index) => ({
        id: index + 1,
        focused: false,
        activeTab: null,
        tabs: w.tabs.length,
      })),
    tabs: () => tabs,
    workspaces: () =>
      windows.flatMap((w, index) =>
        (w.workspaces ?? []).map((ws, i) => ({
          window: index + 1,
          id: ws.id,
          name: ws.name,
          color: ws.color,
          active: i === (w.activeWorkspace ?? 0),
          tabs: w.tabs.filter((t) => (t.workspace ?? 0) === i).length,
        })),
      ),
    history: (query, limit) => history.list(query, limit),
    bookmarks: () => bookmarks.root(),
    downloads: () => downloads.list(),
    recents: (filter, limit) => recents.collect(filter, limit),
    tracks: () => music.snapshot().tracks,
  }
}

export async function offlineRead(
  tool: string,
  args: Args,
  ctx: { userData: string; socket: string; version: string },
): Promise<CliReply> {
  const sources = await diskSources(ctx.userData, tool)
  if (tool === 'status') {
    const tabs = sources.tabs()
    return {
      ok: true,
      running: false,
      version: ctx.version,
      pid: null,
      profile: ctx.userData,
      socket: ctx.socket,
      windows: 0,
      tabs: 0,
      activeTab: null,
      session: { windows: sources.windows().length, tabs: tabs.length },
    }
  }
  return readTool(tool, args, sources)
}

export async function offlineBookmark(
  tool: string,
  args: Args,
  userData: string,
): Promise<CliReply> {
  const store = new BookmarksStore(userData)
  await store.load()
  const reply = bookmarkWrite(tool, args, store, () => undefined, false)
  await store.flush()
  return reply
}
