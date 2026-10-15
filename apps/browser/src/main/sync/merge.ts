import {
  clearCovers,
  type BookmarkFolder,
  type BookmarkNode,
  type HistoryClear,
  type Settings,
} from '@ewe/shared'
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

export const CLEAR_TTL = 180 * 86_400_000
export const MAX_CLEARS = 5000

export function compactClears(clears: HistoryClear[], now: number): HistoryClear[] {
  const live = clears.filter((c) => c.at >= now - CLEAR_TTL)
  let everything: HistoryClear | null = null
  for (const c of live)
    if (c.from === 0 && c.url === undefined && c.site === undefined)
      if (everything === null || c.to > everything.to) everything = c
  const kept = live.filter((c) => everything === null || c === everything || c.to > everything.to)
  const byId = new Map<string, HistoryClear>()
  for (const c of kept) byId.set(c.id, c)
  return [...byId.values()]
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_CLEARS)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export interface ClearIndex {
  global: HistoryClear[]
  byUrl: Map<string, HistoryClear[]>
  bySite: Map<string, HistoryClear[]>
}

export function clearIndex(clears: HistoryClear[]): ClearIndex {
  const index: ClearIndex = { global: [], byUrl: new Map(), bySite: new Map() }
  const add = (map: Map<string, HistoryClear[]>, key: string, clear: HistoryClear): void => {
    const list = map.get(key)
    if (list === undefined) map.set(key, [clear])
    else list.push(clear)
  }
  for (const clear of clears) {
    if (clear.url !== undefined) add(index.byUrl, clear.url, clear)
    else if (clear.site !== undefined) add(index.bySite, clear.site, clear)
    else index.global.push(clear)
  }
  return index
}

export function isCleared(index: ClearIndex, entry: HistoryEntry): boolean {
  const hit = (list: HistoryClear[] | undefined): boolean =>
    list?.some((c) => clearCovers(c, entry.url, entry.host, entry.last)) ?? false
  if (hit(index.global) || hit(index.byUrl.get(entry.url))) return true
  if (index.bySite.size === 0) return false
  const parts = entry.host.toLowerCase().split('.')
  for (let i = 0; i < parts.length; i++)
    if (hit(index.bySite.get(parts.slice(i).join('.')))) return true
  return false
}

export function isHistoryRecord(key: string, value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return (
    e.url === key &&
    typeof e.title === 'string' &&
    e.title.length <= 4096 &&
    typeof e.host === 'string' &&
    typeof e.count === 'number' &&
    Number.isFinite(e.count) &&
    typeof e.last === 'number' &&
    Number.isFinite(e.last)
  )
}

export function filterHistory(
  records: Records<HistoryEntry>,
  clears: HistoryClear[],
  cutoff: number,
): Records<HistoryEntry> {
  const index = clearIndex(clears)
  const out: Records<HistoryEntry> = {}
  for (const [url, entry] of Object.entries(records)) {
    if (!isHistoryRecord(url, entry) || entry.last < cutoff) continue
    if (isCleared(index, entry)) continue
    out[url] = entry
  }
  return out
}

export function narrowHistory(
  base: Records<HistoryEntry>,
  local: Records<HistoryEntry>,
  remote: Records<HistoryEntry>,
  horizon: number,
): { local: Records<HistoryEntry>; dropped: string[] } {
  const out: Records<HistoryEntry> = {}
  const dropped: string[] = []
  for (const [key, entry] of Object.entries(local)) {
    if (entry.last >= horizon || Object.hasOwn(remote, key)) out[key] = entry
    else if (Object.hasOwn(base, key)) dropped.push(key)
  }
  return { local: out, dropped }
}

export function sameClears(remote: unknown, local: HistoryClear[]): boolean {
  if (!Array.isArray(remote) || remote.length !== local.length) return false
  const ids = new Set(local.map((c) => c.id))
  return remote.every(
    (c: unknown) =>
      typeof c === 'object' && c !== null && ids.has((c as { id?: unknown }).id as string),
  )
}

export const SYNCED_SETTINGS = [
  'searchEngine',
  'theme',
  'rail',
  'shortcuts',
  'panels',
  'historyDays',
] as const

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
