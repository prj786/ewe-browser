import { NEW_TAB_URL, SAD_TAB_URL } from './models'
import { hostOf } from './url'

export interface BookmarkItem {
  id: string
  kind: 'bookmark'
  title: string
  url: string
  added: number
}

export interface BookmarkFolder {
  id: string
  kind: 'folder'
  title: string
  children: BookmarkNode[]
  added: number
}

export type BookmarkNode = BookmarkItem | BookmarkFolder

export interface BookmarkHit {
  item: BookmarkItem
  path: string[]
  score: number
}

export const BOOKMARKS_ROOT_ID = 'root'
export const BOOKMARK_TITLE_MAX = 500
export const BOOKMARK_DEPTH_MAX = 16

export function isBookmarkableUrl(url: string): boolean {
  if (/^https?:\/\/./i.test(url)) return true
  if (!url.startsWith('app://')) return false
  return !url.startsWith(NEW_TAB_URL) && !url.startsWith(SAD_TAB_URL)
}

export function emptyBookmarks(now = Date.now()): BookmarkFolder {
  return { id: BOOKMARKS_ROOT_ID, kind: 'folder', title: 'Bookmarks', children: [], added: now }
}

export function findBookmarkNode(root: BookmarkFolder, id: string): BookmarkNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    if (child.id === id) return child
    if (child.kind === 'folder') {
      const hit = findBookmarkNode(child, id)
      if (hit !== null) return hit
    }
  }
  return null
}

export function findBookmarkFolder(root: BookmarkFolder, id: string): BookmarkFolder | null {
  const node = findBookmarkNode(root, id)
  return node?.kind === 'folder' ? node : null
}

export function findBookmarkParent(root: BookmarkFolder, id: string): BookmarkFolder | null {
  for (const child of root.children) {
    if (child.id === id) return root
    if (child.kind === 'folder') {
      const hit = findBookmarkParent(child, id)
      if (hit !== null) return hit
    }
  }
  return null
}

export function flattenBookmarks(
  root: BookmarkFolder,
  path: string[] = [],
): { item: BookmarkItem; path: string[] }[] {
  const out: { item: BookmarkItem; path: string[] }[] = []
  for (const child of root.children) {
    if (child.kind === 'bookmark') out.push({ item: child, path })
    else out.push(...flattenBookmarks(child, [...path, child.title]))
  }
  return out
}

export function bookmarkedUrls(root: BookmarkFolder): Set<string> {
  return new Set(flattenBookmarks(root).map((b) => b.item.url))
}

export function countBookmarks(folder: BookmarkFolder): number {
  let n = 0
  for (const child of folder.children) n += child.kind === 'bookmark' ? 1 : countBookmarks(child)
  return n
}

export function scoreBookmark(item: BookmarkItem, query: string): number {
  const q = query.toLowerCase()
  if (q === '') return 1
  const title = item.title.toLowerCase()
  const host = hostOf(item.url).toLowerCase()
  let score = 0
  if (title.startsWith(q)) score = 4
  else if (title.includes(q)) score = 2
  if (host.startsWith(q)) score = Math.max(score, 3)
  else if (host.includes(q)) score = Math.max(score, 1.5)
  if (score === 0 && item.url.toLowerCase().includes(q)) score = 1
  return score
}

export function rankBookmarks(root: BookmarkFolder, query: string, limit: number): BookmarkHit[] {
  const q = query.trim()
  const hits: BookmarkHit[] = []
  const seen = new Set<string>()
  for (const { item, path } of flattenBookmarks(root)) {
    const score = scoreBookmark(item, q)
    if (score === 0 || seen.has(item.url)) continue
    seen.add(item.url)
    hits.push({ item, path, score })
  }
  hits.sort((a, b) => b.score - a.score || b.item.added - a.item.added)
  return hits.slice(0, limit)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isBookmarkNode(value: unknown, depth = 0): value is BookmarkNode {
  if (!isObject(value) || depth > BOOKMARK_DEPTH_MAX) return false
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false
  if (!isFiniteNumber(value.added)) return false
  if (value.kind === 'bookmark') return typeof value.url === 'string'
  if (value.kind !== 'folder' || !Array.isArray(value.children)) return false
  return value.children.every((child) => isBookmarkNode(child, depth + 1))
}

export function isBookmarkFolder(value: unknown): value is BookmarkFolder {
  return isBookmarkNode(value) && value.kind === 'folder'
}

export function sanitizeBookmarks(
  root: BookmarkFolder,
  nextId: () => string,
  now = Date.now(),
): BookmarkFolder {
  const ids = new Set<string>([BOOKMARKS_ROOT_ID])
  const claim = (id: string): string => {
    const clean = id === '' || ids.has(id) ? nextId() : id
    ids.add(clean)
    return clean
  }
  const clampTime = (t: number): number => (t > 0 && t <= now + 86_400_000 ? Math.floor(t) : now)
  const walk = (folder: BookmarkFolder, depth: number): BookmarkNode[] => {
    if (depth >= BOOKMARK_DEPTH_MAX) return []
    const out: BookmarkNode[] = []
    for (const child of folder.children) {
      const title = child.title.slice(0, BOOKMARK_TITLE_MAX)
      if (child.kind === 'bookmark') {
        if (!isBookmarkableUrl(child.url)) continue
        out.push({
          id: claim(child.id),
          kind: 'bookmark',
          title,
          url: child.url.slice(0, 2048),
          added: clampTime(child.added),
        })
      } else {
        out.push({
          id: claim(child.id),
          kind: 'folder',
          title,
          children: walk(child, depth + 1),
          added: clampTime(child.added),
        })
      }
    }
    return out
  }
  return {
    id: BOOKMARKS_ROOT_ID,
    kind: 'folder',
    title: root.title.slice(0, BOOKMARK_TITLE_MAX) || 'Bookmarks',
    children: walk(root, 0),
    added: clampTime(root.added),
  }
}
