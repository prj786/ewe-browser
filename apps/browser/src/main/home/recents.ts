import { open, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extensionOf,
  fileKind,
  isSearchResultUrl,
  pickRecents,
  recentKindOf,
  type DownloadEntry,
  type HistoryVisit,
  type RecentFilter,
  type RecentItem,
  type RecentKind,
  type RecentSource,
  type Track,
} from '@ewe/shared'
import { titleFromName } from '../media/library'
import type { RecentRecord } from '../storage/recent-store'

const CANDIDATES = 80
const HISTORY_SCAN = 400
const SNIPPET_BYTES = 1200
const SNIPPET_LINES = 16
const MAX_KNOWN = 2000

export interface SystemRecent {
  path: string
  time: number
}

const BOOKMARK_RE = /<bookmark\s([^>]*)>([\s\S]*?)<\/bookmark>/g
const STAMP_RE = /="(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)"/g
const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name] ?? '')
}

export function parseRecentlyUsed(xml: string): SystemRecent[] {
  const out: SystemRecent[] = []
  for (const m of xml.matchAll(BOOKMARK_RE)) {
    const attrs = m[1] ?? ''
    const href = /href="([^"]*)"/.exec(attrs)?.[1]
    if (href === undefined) continue
    const uri = unescapeXml(href)
    if (!uri.startsWith('file://')) continue
    let path: string
    try {
      path = fileURLToPath(uri)
    } catch {
      continue
    }
    let time = 0
    for (const s of `${attrs} ${m[2] ?? ''}`.matchAll(STAMP_RE)) {
      const ms = Date.parse(s[1] ?? '')
      if (Number.isFinite(ms) && ms > time) time = ms
    }
    if (time > 0) out.push({ path, time })
  }
  return out
}

export function recentlyUsedPath(): string {
  const data = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  return join(data, 'recently-used.xbel')
}

function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function fileRecent(
  path: string,
  time: number,
  source: RecentSource,
  size: number | null,
): RecentItem | null {
  const kind: RecentKind | null = recentKindOf(path)
  if (kind === null) return null
  const name = basename(path)
  return {
    key: path,
    kind,
    title: kind === 'doc' ? name : kind === 'audio' ? titleFromName(path) : stem(name),
    time,
    source,
    url: null,
    path,
    dir: dirname(path),
    fileKind: fileKind({ name, dir: false }),
    ext: extensionOf(name),
    size,
    host: null,
    artist: null,
    album: null,
    cover: kind === 'video' || kind === 'audio',
    snippet: null,
  }
}

export function webRecent(visit: HistoryVisit): RecentItem {
  return {
    key: visit.url,
    kind: 'web',
    title: visit.title === '' ? visit.host : visit.title,
    time: visit.last,
    source: 'visited',
    url: visit.url,
    path: null,
    dir: null,
    fileKind: null,
    ext: '',
    size: null,
    host: visit.host,
    artist: null,
    album: null,
    cover: false,
    snippet: null,
  }
}

export function snippetOf(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const cut = bytes.length >= SNIPPET_BYTES ? text.slice(0, text.lastIndexOf('\n')) : text
  const lines = cut
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\p{Cc}/gu, ' ').trimEnd())
  while (lines.length > 0 && lines[0] === '') lines.shift()
  const out = lines.slice(0, SNIPPET_LINES).join('\n').trimEnd()
  return out === '' ? null : out
}

async function readSnippet(path: string): Promise<string | null> {
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = new Uint8Array(SNIPPET_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, SNIPPET_BYTES, 0)
      return snippetOf(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

export interface RecentsDeps {
  records(): RecentRecord[]
  hidden(): ReadonlyMap<string, number>
  history(limit: number): HistoryVisit[]
  downloads(): DownloadEntry[]
  track(path: string): Track | undefined
  xbelPath?: (() => string) | undefined
}

export class RecentsService {
  private readonly deps: RecentsDeps
  private readonly known = new Set<string>()
  private xbel: { path: string; mtime: number; items: SystemRecent[] } | null = null

  constructor(deps: RecentsDeps) {
    this.deps = deps
  }

  knows(path: string): boolean {
    return this.known.has(path)
  }

  async collect(filter: RecentFilter, limit: number): Promise<RecentItem[]> {
    const hidden = this.deps.hidden()
    const visible = (key: string, time: number) => (hidden.get(key) ?? -1) < time
    const candidates = new Map<string, { time: number; source: RecentSource }>()
    const add = (path: string, time: number, source: RecentSource) => {
      const kind = recentKindOf(path)
      if (kind === null || (filter !== 'all' && kind !== filter) || !visible(path, time)) return
      const seen = candidates.get(path)
      if (seen === undefined || time > seen.time) candidates.set(path, { time, source })
    }
    if (filter !== 'web') {
      for (const r of await this.system()) add(r.path, r.time, 'system')
      for (const d of this.deps.downloads())
        if (d.status === 'completed') add(d.path, d.ended ?? d.started, 'downloaded')
      for (const r of this.deps.records()) add(r.path, r.time, r.source)
    }
    const newest = [...candidates.entries()]
      .sort((a, b) => b[1].time - a[1].time)
      .slice(0, CANDIDATES)
    const infos = await Promise.all(newest.map(([path]) => stat(path).catch(() => null)))
    const items: RecentItem[] = []
    newest.forEach(([path, c], i) => {
      const info = infos[i]
      if (info?.isFile() !== true) return
      const item = fileRecent(path, c.time, c.source, info.size)
      if (item !== null) items.push(item)
    })
    if (filter === 'all' || filter === 'web') {
      for (const visit of this.deps.history(HISTORY_SCAN)) {
        if (isSearchResultUrl(visit.url) || !visible(visit.url, visit.last)) continue
        items.push(webRecent(visit))
      }
    }
    const picked = pickRecents(items, filter, limit)
    await Promise.all(picked.map((item) => this.enrich(item)))
    if (this.known.size > MAX_KNOWN) this.known.clear()
    for (const item of picked) if (item.path !== null) this.known.add(item.path)
    return picked
  }

  private async enrich(item: RecentItem): Promise<void> {
    if (item.path === null) return
    if (item.kind === 'audio') {
      const track = this.deps.track(item.path)
      if (track === undefined) return
      item.title = track.title
      item.artist =
        (track.artist || track.albumArtist) === '' ? null : track.artist || track.albumArtist
      item.album = track.album === '' ? null : track.album
      item.cover = track.cover
      return
    }
    if (item.fileKind === 'text') item.snippet = await readSnippet(item.path)
  }

  private async system(): Promise<SystemRecent[]> {
    const path = this.deps.xbelPath?.() ?? recentlyUsedPath()
    try {
      const info = await stat(path)
      if (this.xbel?.path === path && this.xbel.mtime === info.mtimeMs) return this.xbel.items
      const items = parseRecentlyUsed(await readFile(path, 'utf8'))
      this.xbel = { path, mtime: info.mtimeMs, items }
      return items
    } catch {
      return []
    }
  }
}
