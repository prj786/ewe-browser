import type { BookmarkFolder, BookmarkNode, Settings } from '@ewe/shared'
import type { HistoryEntry } from '../history'

export type Records<V> = Record<string, V>

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function merge3<V>(
  base: Records<V>,
  local: Records<V>,
  remote: Records<V>,
  resolve: (local: V, remote: V) => V,
): Records<V> {
  const out: Records<V> = {}
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
  for (const key of keys) {
    const b = base[key]
    const l = local[key]
    const r = remote[key]
    let value: V | undefined
    if (same(l, r)) value = l
    else if (same(l, b)) value = r
    else if (same(r, b)) value = l
    else if (l === undefined) value = r
    else if (r === undefined) value = l
    else value = resolve(l, r)
    if (value !== undefined) out[key] = value
  }
  return out
}

export interface FlatBookmark {
  kind: 'bookmark' | 'folder'
  title: string
  url?: string
  parent: string
  index: number
  added: number
}

export function flattenTree(root: BookmarkFolder): Records<FlatBookmark> {
  const out: Records<FlatBookmark> = {}
  const walk = (folder: BookmarkFolder): void => {
    folder.children.forEach((node, index) => {
      out[node.id] =
        node.kind === 'bookmark'
          ? {
              kind: 'bookmark',
              title: node.title,
              url: node.url,
              parent: folder.id,
              index,
              added: node.added,
            }
          : { kind: 'folder', title: node.title, parent: folder.id, index, added: node.added }
      if (node.kind === 'folder') walk(node)
    })
  }
  walk(root)
  return out
}

export function buildTree(flat: Records<FlatBookmark>, root: BookmarkFolder): BookmarkFolder {
  const folders = new Map<string, BookmarkFolder>()
  const tree: BookmarkFolder = { ...root, children: [] }
  folders.set(root.id, tree)
  for (const [id, item] of Object.entries(flat))
    if (item.kind === 'folder')
      folders.set(id, { id, kind: 'folder', title: item.title, children: [], added: item.added })
  const parentOf = (id: string): string => {
    const parent = flat[id]?.parent ?? root.id
    return folders.has(parent) ? parent : root.id
  }
  const loops = (id: string): boolean => {
    const seen = new Set<string>()
    let current = parentOf(id)
    while (current !== root.id) {
      if (current === id || seen.has(current)) return true
      seen.add(current)
      current = parentOf(current)
    }
    return false
  }
  const ordered = Object.entries(flat).sort(
    ([a, x], [b, y]) => x.index - y.index || a.localeCompare(b),
  )
  for (const [id, item] of ordered) {
    const parentId = item.kind === 'folder' && loops(id) ? root.id : parentOf(id)
    const parent = folders.get(parentId) ?? tree
    const node: BookmarkNode | undefined =
      item.kind === 'folder'
        ? folders.get(id)
        : { id, kind: 'bookmark', title: item.title, url: item.url ?? '', added: item.added }
    if (node !== undefined) parent.children.push(node)
  }
  return tree
}

export function mergeBookmarks(
  base: Records<FlatBookmark>,
  local: Records<FlatBookmark>,
  remote: Records<FlatBookmark>,
): Records<FlatBookmark> {
  return merge3(base, local, remote, (l, r) => ({ ...r, ...l }))
}

export function historyRecords(entries: HistoryEntry[]): Records<HistoryEntry> {
  const out: Records<HistoryEntry> = {}
  for (const entry of entries) out[entry.url] = entry
  return out
}

export function mergeHistory(
  base: Records<HistoryEntry>,
  local: Records<HistoryEntry>,
  remote: Records<HistoryEntry>,
): Records<HistoryEntry> {
  return merge3(base, local, remote, (l, r) => {
    const newer = l.last >= r.last ? l : r
    return { ...newer, count: Math.max(l.count, r.count), last: Math.max(l.last, r.last) }
  })
}

export const SYNCED_SETTINGS = ['searchEngine', 'theme', 'rail', 'shortcuts', 'panels'] as const

export type SyncedSettings = Pick<Settings, (typeof SYNCED_SETTINGS)[number]>

export function settingsRecords(settings: Settings): Records<unknown> {
  const out: Records<unknown> = {}
  for (const key of SYNCED_SETTINGS) out[key] = settings[key]
  return out
}

export function mergeSettings(
  base: Records<unknown>,
  local: Records<unknown>,
  remote: Records<unknown>,
): Records<unknown> {
  const first = Object.keys(base).length === 0
  return merge3(base, local, remote, (l, r) => (first ? r : l))
}
