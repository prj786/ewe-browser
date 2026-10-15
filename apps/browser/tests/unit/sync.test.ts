import { describe, expect, it } from 'vitest'
import { BOOKMARKS_ROOT_ID, DEFAULT_SETTINGS, type BookmarkFolder } from '@ewe/shared'
import type { HistoryEntry } from '../../src/main/history'
import {
  buildTree,
  flattenTree,
  merge3,
  mergeBookmarks,
  mergeHistory,
  mergeSettings,
  settingsRecords,
} from '../../src/main/sync/merge'

const tree = (children: BookmarkFolder['children']): BookmarkFolder => ({
  id: BOOKMARKS_ROOT_ID,
  kind: 'folder',
  title: 'Bookmarks',
  children,
  added: 0,
})

const bm = (id: string, url: string, title = id) =>
  ({ id, kind: 'bookmark', title, url, added: 1 }) as const

describe('three-way merge', () => {
  const pick = (l: number, r: number) => Math.max(l, r)

  it('keeps one-sided changes, deletions and additions from both sides', () => {
    const base = { a: 1, b: 2, c: 3 }
    const local = { a: 1, b: 20, d: 4 }
    const remote = { a: 10, b: 2, c: 3, e: 5 }
    expect(merge3(base, local, remote, pick)).toEqual({ a: 10, b: 20, d: 4, e: 5 })
  })

  it('resolves real conflicts and lets an edit win over a delete', () => {
    expect(merge3({ a: 1 }, { a: 2 }, { a: 3 }, pick)).toEqual({ a: 3 })
    expect(merge3({ a: 1 }, {}, { a: 3 }, pick)).toEqual({ a: 3 })
    expect(merge3({ a: 1 }, { a: 2 }, {}, pick)).toEqual({ a: 2 })
  })

  it('unions two machines on the first sync', () => {
    expect(merge3({}, { a: 1 }, { b: 2 }, pick)).toEqual({ a: 1, b: 2 })
  })
})

describe('bookmark sync', () => {
  it('round-trips a tree through records', () => {
    const root = tree([
      bm('1', 'https://a.example/'),
      {
        id: 'f',
        kind: 'folder',
        title: 'Wool',
        added: 2,
        children: [bm('2', 'https://b.example/')],
      },
    ])
    expect(buildTree(flattenTree(root), root)).toEqual(root)
  })

  it('merges a move on one machine with an add on the other', () => {
    const base = tree([
      bm('1', 'https://a.example/'),
      { id: 'f', kind: 'folder', title: 'Wool', added: 2, children: [] },
    ])
    const local = tree([
      {
        id: 'f',
        kind: 'folder',
        title: 'Wool',
        added: 2,
        children: [bm('1', 'https://a.example/')],
      },
    ])
    const remote = tree([
      bm('1', 'https://a.example/'),
      { id: 'f', kind: 'folder', title: 'Wool', added: 2, children: [] },
      bm('3', 'https://c.example/'),
    ])
    const merged = buildTree(
      mergeBookmarks(flattenTree(base), flattenTree(local), flattenTree(remote)),
      base,
    )
    expect(merged.children.map((n) => n.id)).toEqual(['f', '3'])
    const folder = merged.children[0]
    expect(folder?.kind === 'folder' ? folder.children.map((n) => n.id) : []).toEqual(['1'])
  })

  it('puts orphans and folder cycles back at the root', () => {
    const merged = buildTree(
      {
        x: { kind: 'bookmark', title: 'x', url: 'https://x/', parent: 'gone', index: 0, added: 0 },
        f: { kind: 'folder', title: 'f', parent: 'g', index: 1, added: 0 },
        g: { kind: 'folder', title: 'g', parent: 'f', index: 2, added: 0 },
      },
      tree([]),
    )
    expect(merged.children.map((n) => n.id)).toEqual(['x', 'f', 'g'])
  })
})

describe('history and settings sync', () => {
  const entry = (url: string, count: number, last: number, title = url): HistoryEntry => ({
    url,
    title,
    host: new URL(url).host,
    count,
    last,
  })

  it('combines visits of the same page and keeps removals', () => {
    const base = {
      'https://a/': entry('https://a/', 1, 10),
      'https://b/': entry('https://b/', 1, 10),
    }
    const local = { 'https://a/': entry('https://a/', 3, 30, 'A local') }
    const remote = {
      'https://a/': entry('https://a/', 2, 40, 'A remote'),
      'https://b/': entry('https://b/', 1, 10),
    }
    expect(mergeHistory(base, local, remote)).toEqual({
      'https://a/': entry('https://a/', 3, 40, 'A remote'),
    })
  })

  it('syncs only portable settings', () => {
    const records = settingsRecords({ ...DEFAULT_SETTINGS, sidebarWidth: 500, background: true })
    expect(Object.keys(records).sort()).toEqual(
      ['historyDays', 'panels', 'rail', 'searchEngine', 'shortcuts', 'theme'].sort(),
    )
    expect(mergeSettings({ theme: 'system' }, { theme: 'dark' }, { theme: 'light' })).toEqual({
      theme: 'dark',
    })
  })
})
