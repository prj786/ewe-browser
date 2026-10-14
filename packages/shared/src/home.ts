import { extensionOf, fileKind, type FileKind } from './files'
import { SEARCH_ENGINES } from './url'

export type RecentKind = 'doc' | 'video' | 'audio' | 'web'
export type RecentFilter = RecentKind | 'all'
export type RecentSource = 'opened' | 'played' | 'downloaded' | 'system' | 'visited'

export const RECENT_KINDS: readonly RecentKind[] = ['doc', 'video', 'audio', 'web']
export const HOME_RECENT_LIMIT = 5

export interface RecentItem {
  key: string
  kind: RecentKind
  title: string
  time: number
  source: RecentSource
  url: string | null
  path: string | null
  dir: string | null
  fileKind: FileKind | null
  ext: string
  size: number | null
  host: string | null
  artist: string | null
  album: string | null
  cover: boolean
  snippet: string | null
}

export type HomeRequest =
  | { op: 'recents'; filter: RecentFilter; limit: number }
  | { op: 'places' }
  | { op: 'token' }
  | { op: 'open'; path: string }
  | { op: 'mpv'; path: string }
  | { op: 'forget'; key: string }

const DOC_TEXT = new Set(['txt', 'md', 'markdown', 'rst', 'org'])
const DOC_KINDS = new Set<FileKind>(['pdf', 'document', 'sheet', 'slides'])

export function recentKindOf(name: string): RecentKind | null {
  const kind = fileKind({ name, dir: false })
  if (kind === 'video') return 'video'
  if (kind === 'audio') return 'audio'
  if (DOC_KINDS.has(kind)) return 'doc'
  if (kind === 'text' && DOC_TEXT.has(extensionOf(name))) return 'doc'
  return null
}

export function isRecentFilter(value: unknown): value is RecentFilter {
  return value === 'all' || (RECENT_KINDS as readonly unknown[]).includes(value)
}

function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}

export function isHomeRequest(value: unknown): value is HomeRequest {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  switch (r.op) {
    case 'recents':
      return (
        isRecentFilter(r.filter) &&
        typeof r.limit === 'number' &&
        Number.isInteger(r.limit) &&
        r.limit > 0 &&
        r.limit <= 100
      )
    case 'places':
    case 'token':
      return true
    case 'open':
    case 'mpv':
      return isKey(r.path) && r.path.startsWith('/')
    case 'forget':
      return isKey(r.key)
    default:
      return false
  }
}

export function isSearchResultUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const host = u.host.replace(/^www\./, '')
  return Object.values(SEARCH_ENGINES).some(({ template }) => {
    const t = new URL(template.replace('%s', 'x'))
    return (
      t.host.replace(/^www\./, '') === host && t.pathname === u.pathname && u.searchParams.has('q')
    )
  })
}

export function dedupeRecents(items: RecentItem[]): RecentItem[] {
  const byKey = new Map<string, RecentItem>()
  for (const item of items) {
    const key = item.kind === 'web' ? `web:${item.host ?? item.key}` : item.key
    const seen = byKey.get(key)
    if (seen === undefined || item.time > seen.time) byKey.set(key, item)
  }
  return [...byKey.values()]
}

export function pickRecents(
  items: RecentItem[],
  filter: RecentFilter,
  limit: number,
): RecentItem[] {
  const sorted = dedupeRecents(items)
    .filter((item) => filter === 'all' || item.kind === filter)
    .sort((a, b) => b.time - a.time)
  if (filter !== 'all') return sorted.slice(0, limit)
  const picked: RecentItem[] = []
  const kinds = new Set<RecentKind>()
  for (const item of sorted) {
    if (picked.length >= limit) break
    if (kinds.has(item.kind)) continue
    kinds.add(item.kind)
    picked.push(item)
  }
  for (const item of sorted) {
    if (picked.length >= limit) break
    if (!picked.includes(item)) picked.push(item)
  }
  return picked.sort((a, b) => b.time - a.time)
}
