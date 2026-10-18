import {
  flattenBookmarks,
  hostOf,
  isBookmarkableUrl,
  rankBookmarks,
  searchTracks,
  type BookmarkFolder,
  type BookmarkItem,
  type DownloadEntry,
  type HistoryVisit,
  type RecentFilter,
  type RecentItem,
  type SiteResolution,
  type Track,
} from '@ewe/shared'
import { failure, iso, type CliError, type CliReply } from './socket'
import type { Args } from './tools'

export interface CliTab {
  id: string | null
  title: string
  url: string
  kind: string
  active: boolean
  pinned: boolean
  audible: boolean
  muted: boolean
  loading: boolean
  workspace: string
  window: number
}

export interface CliWorkspace {
  window: number
  id: string | null
  name: string
  color: string
  active: boolean
  tabs: number
}

export interface CliWindow {
  id: number
  focused: boolean
  activeTab: string | null
  tabs: number
}

export interface Sources {
  running: boolean
  windows(): CliWindow[]
  tabs(): CliTab[]
  workspaces(): CliWorkspace[]
  currentWindow?(): number | null
  history(query: string, limit: number): HistoryVisit[]
  bookmarks(): BookmarkFolder
  downloads(): DownloadEntry[]
  recents(filter: RecentFilter, limit: number): Promise<RecentItem[]>
  tracks(): readonly Track[]
}

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)
const matches = (terms: string[], ...fields: (string | null | undefined)[]) => {
  const hay = fields
    .filter((f) => typeof f === 'string')
    .join(' ')
    .toLowerCase()
  return terms.every((t) => hay.includes(t))
}

export function historyOut(v: HistoryVisit) {
  return { url: v.url, title: v.title, host: v.host, visits: v.count, lastVisit: iso(v.last) }
}

export function bookmarkOut(
  item: { id: string; title: string; url: string; added: number },
  path: string[],
) {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    host: hostOf(item.url),
    folder: path.join(' / '),
    added: iso(item.added),
  }
}

export function downloadOut(d: DownloadEntry) {
  return {
    id: d.id,
    filename: d.filename,
    path: d.path,
    url: d.url,
    mime: d.mime,
    status: d.status,
    received: d.received,
    total: d.total,
    started: iso(d.started),
    ended: iso(d.ended),
  }
}

export function recentOut(r: RecentItem) {
  return {
    kind: r.kind,
    title: r.title,
    path: r.path,
    url: r.url,
    host: r.host,
    artist: r.artist,
    album: r.album,
    size: r.size,
    source: r.source,
    time: iso(r.time),
  }
}

export function trackOut(t: Track) {
  return {
    title: t.title,
    artist: t.artist,
    album: t.album,
    track: t.track,
    year: t.year,
    duration: t.duration === null ? null : Math.round(t.duration),
    genre: t.genre,
    path: t.path,
  }
}

const num = (args: Args, key: string, fallback: number) => {
  const value = args[key]
  return typeof value === 'number' ? value : fallback
}
const text = (args: Args, key: string) => {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function readTool(tool: string, args: Args, src: Sources): Promise<CliReply> {
  const running = src.running
  switch (tool) {
    case 'tabs':
      return {
        ok: true,
        running,
        windows: src.windows(),
        tabs: src.tabs(),
        workspaces: src.workspaces(),
      }
    case 'history': {
      const query = text(args, 'query')
      return {
        ok: true,
        running,
        query,
        entries: src.history(query, num(args, 'limit', 50)).map(historyOut),
      }
    }
    case 'bookmarks': {
      const query = text(args, 'query')
      const limit = num(args, 'limit', 100)
      const root = src.bookmarks()
      const list =
        query === ''
          ? flattenBookmarks(root)
              .sort((a, b) => b.item.added - a.item.added)
              .slice(0, limit)
          : rankBookmarks(root, query, limit)
      return { ok: true, running, query, bookmarks: list.map((h) => bookmarkOut(h.item, h.path)) }
    }
    case 'downloads':
      return {
        ok: true,
        running,
        downloads: src
          .downloads()
          .slice(0, num(args, 'limit', 20))
          .map(downloadOut),
      }
    case 'recent': {
      const kind = text(args, 'kind') || 'all'
      const items = await src.recents(kind as RecentFilter, num(args, 'limit', 12))
      return { ok: true, running, kind, items: items.map(recentOut) }
    }
    case 'music': {
      const query = text(args, 'query')
      const limit = num(args, 'limit', 50)
      const all = src.tracks()
      const found = query === '' ? [...all] : searchTracks([...all], query)
      return {
        ok: true,
        running,
        query,
        total: found.length,
        tracks: found.slice(0, limit).map(trackOut),
      }
    }
    case 'workspaces': {
      const all = src.workspaces()
      const window = src.currentWindow?.() ?? all[0]?.window ?? null
      return {
        ok: true,
        running,
        window,
        workspaces: all
          .filter((w) => w.window === window)
          .map((w, i) => ({
            id: w.id,
            name: w.name,
            color: w.color,
            index: i + 1,
            tabs: w.tabs,
            active: w.active,
          })),
      }
    }
    case 'find': {
      const query = text(args, 'query')
      const limit = num(args, 'limit', 8)
      const terms = words(query)
      const recent = await src.recents('all', 50)
      return {
        ok: true,
        running,
        query,
        tabs: src
          .tabs()
          .filter((t) => matches(terms, t.title, t.url))
          .slice(0, limit),
        bookmarks: rankBookmarks(src.bookmarks(), query, limit).map((h) =>
          bookmarkOut(h.item, h.path),
        ),
        history: src.history(query, limit).map(historyOut),
        recent: recent
          .filter((r) => matches(terms, r.title, r.path, r.url, r.artist, r.album))
          .slice(0, limit)
          .map(recentOut),
        music: searchTracks([...src.tracks()], query)
          .slice(0, limit)
          .map(trackOut),
      }
    }
    default:
      return failure('unknown-verb', `unknown tool: ${tool}`)
  }
}

export function matchWorkspace(
  list: readonly { id: string | null; name: string }[],
  key: string,
): number | CliError {
  const wanted = key.trim()
  const lower = wanted.toLowerCase()
  const notFound = failure(
    'not-found',
    `no workspace is called or numbered "${wanted}"`,
    'ewe-browser workspaces',
  )
  if (wanted === '') return notFound
  const byId = list.findIndex((w) => w.id === wanted)
  if (byId >= 0) return byId
  const named = list.flatMap((w, i) => (w.name.toLowerCase() === lower ? [i] : []))
  if (named.length > 1)
    return failure(
      'ambiguous-id',
      `${named.length} workspaces are called "${wanted}"`,
      'use its id',
    )
  if (named[0] !== undefined) return named[0]
  if (/^\d+$/.test(wanted)) {
    const n = Number(wanted)
    return n >= 1 && n <= list.length ? n - 1 : notFound
  }
  if (wanted.length >= 4) {
    const prefixed = list.flatMap((w, i) => (w.id?.startsWith(wanted) === true ? [i] : []))
    if (prefixed.length > 1)
      return failure('ambiguous-id', `${wanted} matches ${prefixed.length} workspaces`)
    if (prefixed[0] !== undefined) return prefixed[0]
  }
  return notFound
}

export function siteReply(found: SiteResolution, running: boolean): CliReply {
  if (!found.ok)
    return failure(
      found.error,
      found.message,
      'give its domain (zara.com), or search without --site',
    )
  return {
    ok: true,
    running,
    name: found.name,
    host: found.host,
    template: found.template,
    via: found.via,
  }
}

export interface BookmarkWriter {
  root(): BookmarkFolder
  find(url: string): BookmarkItem | undefined
  add(url: string, title: string): BookmarkItem | undefined
  remove(id: string): boolean
}

export function bookmarkWrite(
  tool: string,
  args: Args,
  store: BookmarkWriter,
  titleFor: (url: string) => string | undefined,
  running: boolean,
): CliReply {
  const url = text(args, 'url')
  const placed = (id: string) => flattenBookmarks(store.root()).find((h) => h.item.id === id)
  if (tool === 'bookmark_add') {
    if (!isBookmarkableUrl(url))
      return failure('bad-url', `${url} cannot be bookmarked`, 'use an http(s) url')
    const existing = store.find(url)
    if (existing !== undefined)
      return {
        ok: true,
        running,
        existed: true,
        bookmark: bookmarkOut(existing, placed(existing.id)?.path ?? []),
      }
    const given = text(args, 'title')
    const title = given !== '' ? given : (titleFor(url) ?? (hostOf(url) !== '' ? hostOf(url) : url))
    const item = store.add(url, title)
    if (item === undefined) return failure('failed', 'the bookmark was not added')
    return {
      ok: true,
      running,
      existed: false,
      bookmark: bookmarkOut(item, placed(item.id)?.path ?? []),
      undo: [['ewe-browser', 'bookmark', 'remove', url]],
    }
  }
  const hits = flattenBookmarks(store.root()).filter((h) => h.item.url === url)
  const first = hits[0]
  if (first === undefined) return failure('not-bookmarked', `${url} is not bookmarked`)
  for (const hit of hits) store.remove(hit.item.id)
  return {
    ok: true,
    running,
    removed: hits.length,
    undo: [['ewe-browser', 'bookmark', 'add', url, '--title', first.item.title]],
  }
}
