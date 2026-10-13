import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  countBookmarks,
  isBookmarkableUrl,
  type BookmarkFolder,
  type BookmarkNode,
} from '@ewe/shared'

export const CHROME_IMPORT_TITLE = 'Imported from Chrome'
const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000
const ROOTS: { key: string; title: string }[] = [
  { key: 'bookmark_bar', title: 'Bookmarks bar' },
  { key: 'other', title: 'Other bookmarks' },
  { key: 'synced', title: 'Mobile bookmarks' },
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function chromeTimeToMs(value: unknown, fallback: number): number {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  if (!/^\d+$/.test(text)) return fallback
  const ms = Number(text) / 1000 - CHROME_EPOCH_OFFSET_MS
  return Number.isFinite(ms) && ms > 0 && ms <= fallback + 86_400_000 ? Math.floor(ms) : fallback
}

export function importFolderTitle(now: number): string {
  return `${CHROME_IMPORT_TITLE} (${new Date(now).toISOString().slice(0, 10)})`
}

function convertNode(
  node: unknown,
  now: number,
  nextId: () => string,
  depth: number,
): BookmarkNode | null {
  if (!isObject(node) || depth > 16) return null
  const title = typeof node.name === 'string' ? node.name : ''
  const added = chromeTimeToMs(node.date_added, now)
  if (node.type === 'url') {
    if (typeof node.url !== 'string' || !/^https?:\/\//i.test(node.url)) return null
    if (!isBookmarkableUrl(node.url)) return null
    return {
      id: nextId(),
      kind: 'bookmark',
      title: title === '' ? node.url : title,
      url: node.url,
      added,
    }
  }
  if (node.type !== 'folder' || !Array.isArray(node.children)) return null
  const children = node.children
    .map((child) => convertNode(child, now, nextId, depth + 1))
    .filter((child): child is BookmarkNode => child !== null)
  return { id: nextId(), kind: 'folder', title, children, added }
}

export function parseChromeBookmarks(
  json: unknown,
  now = Date.now(),
  nextId: () => string = randomUUID,
): BookmarkFolder | null {
  if (!isObject(json) || !isObject(json.roots)) return null
  const roots = json.roots
  const children: BookmarkNode[] = []
  for (const { key, title } of ROOTS) {
    const converted = convertNode(roots[key], now, nextId, 0)
    if (converted?.kind !== 'folder' || converted.children.length === 0) continue
    children.push({ ...converted, title })
  }
  return { id: nextId(), kind: 'folder', title: importFolderTitle(now), children, added: now }
}

export function chromeBookmarkPaths(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  const override = env.EWE_CHROME_BOOKMARKS
  const defaults = [
    join(home, '.config/google-chrome/Default/Bookmarks'),
    join(home, '.config/chromium/Default/Bookmarks'),
  ]
  return override === undefined || override === '' ? defaults : [override, ...defaults]
}

export type ChromeImportResult =
  | { ok: true; folder: BookmarkFolder; count: number; path: string }
  | { ok: false; error: 'not-found' | 'unreadable'; paths: string[] }

export async function readChromeBookmarks(
  paths: string[],
  now = Date.now(),
): Promise<ChromeImportResult> {
  let found: string | null = null
  for (const path of paths) {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    found = path
    try {
      const folder = parseChromeBookmarks(JSON.parse(text), now)
      if (folder !== null) return { ok: true, folder, count: countBookmarks(folder), path }
    } catch {
      break
    }
  }
  return { ok: false, error: found === null ? 'not-found' : 'unreadable', paths }
}
