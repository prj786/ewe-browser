import { describe, expect, it } from 'vitest'
import {
  bookmarkedUrls,
  countBookmarks,
  emptyBookmarks,
  findBookmarkFolder,
  findBookmarkNode,
  findBookmarkParent,
  flattenBookmarks,
  isBookmarkFolder,
  isBookmarkNode,
  isBookmarkableUrl,
  rankBookmarks,
  sanitizeBookmarks,
  type BookmarkFolder,
} from './bookmarks'

const now = Date.UTC(2026, 9, 12)
const day = 86_400_000

function tree(): BookmarkFolder {
  return {
    id: 'root',
    kind: 'folder',
    title: 'Bookmarks',
    added: now - 10 * day,
    children: [
      {
        id: 'a',
        kind: 'bookmark',
        title: 'Example Domain',
        url: 'https://example.com/',
        added: now,
      },
      {
        id: 'dev',
        kind: 'folder',
        title: 'Dev',
        added: now - day,
        children: [
          {
            id: 'b',
            kind: 'bookmark',
            title: 'Electron',
            url: 'https://www.electronjs.org/',
            added: now - 2 * day,
          },
          {
            id: 'c',
            kind: 'bookmark',
            title: 'Sheep - Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Sheep',
            added: now - 3 * day,
          },
          {
            id: 'dup',
            kind: 'bookmark',
            title: 'Example again',
            url: 'https://example.com/',
            added: now - 4 * day,
          },
        ],
      },
      { id: 's', kind: 'bookmark', title: 'Settings', url: 'app://settings/', added: now - day },
    ],
  }
}

describe('isBookmarkableUrl', () => {
  it('accepts http(s) and internal pages but not transient or unsafe urls', () => {
    expect(isBookmarkableUrl('https://example.com/')).toBe(true)
    expect(isBookmarkableUrl('http://localhost:3000/')).toBe(true)
    expect(isBookmarkableUrl('app://settings/')).toBe(true)
    expect(isBookmarkableUrl('app://home/')).toBe(true)
    expect(isBookmarkableUrl('app://newtab/')).toBe(false)
    expect(isBookmarkableUrl('app://sad/?url=x')).toBe(false)
    expect(isBookmarkableUrl('about:blank')).toBe(false)
    expect(isBookmarkableUrl('javascript:alert(1)')).toBe(false)
    expect(isBookmarkableUrl('file:///etc/passwd')).toBe(false)
    expect(isBookmarkableUrl('https://')).toBe(false)
  })
})

describe('tree helpers', () => {
  it('finds nodes, folders and parents', () => {
    const root = tree()
    expect(findBookmarkNode(root, 'c')?.title).toBe('Sheep - Wikipedia')
    expect(findBookmarkNode(root, 'root')).toBe(root)
    expect(findBookmarkFolder(root, 'dev')?.children).toHaveLength(3)
    expect(findBookmarkFolder(root, 'a')).toBeNull()
    expect(findBookmarkParent(root, 'c')?.id).toBe('dev')
    expect(findBookmarkParent(root, 'a')?.id).toBe('root')
    expect(findBookmarkParent(root, 'root')).toBeNull()
    expect(findBookmarkParent(root, 'nope')).toBeNull()
  })

  it('flattens with folder paths and counts bookmarks only', () => {
    const root = tree()
    expect(flattenBookmarks(root).map((b) => [b.item.id, b.path])).toEqual([
      ['a', []],
      ['b', ['Dev']],
      ['c', ['Dev']],
      ['dup', ['Dev']],
      ['s', []],
    ])
    expect(countBookmarks(root)).toBe(5)
    expect([...bookmarkedUrls(root)]).toEqual([
      'https://example.com/',
      'https://www.electronjs.org/',
      'https://en.wikipedia.org/wiki/Sheep',
      'app://settings/',
    ])
    expect(emptyBookmarks(now)).toEqual({
      id: 'root',
      kind: 'folder',
      title: 'Bookmarks',
      children: [],
      added: now,
    })
  })
})

describe('rankBookmarks', () => {
  it('prefers title prefixes, then hosts, then url text, and dedupes urls', () => {
    const root = tree()
    expect(rankBookmarks(root, 'ex', 10).map((h) => h.item.id)).toEqual(['a'])
    expect(rankBookmarks(root, 'wiki', 10).map((h) => h.item.id)).toEqual(['c'])
    expect(rankBookmarks(root, 'electron', 10).map((h) => h.item.id)).toEqual(['b'])
    expect(rankBookmarks(root, 'settings', 10).map((h) => h.item.id)).toEqual(['s'])
    expect(rankBookmarks(root, 'zzz', 10)).toEqual([])
  })

  it('lists everything by recency for an empty query and caps the list', () => {
    const root = tree()
    expect(rankBookmarks(root, '', 10).map((h) => h.item.id)).toEqual(['a', 's', 'b', 'c'])
    expect(rankBookmarks(root, '', 2).map((h) => h.item.id)).toEqual(['a', 's'])
    expect(rankBookmarks(root, 'e', 10)[0]?.path).toEqual([])
  })
})

describe('validation and sanitize', () => {
  it('validates node shapes recursively', () => {
    expect(isBookmarkFolder(tree())).toBe(true)
    expect(isBookmarkNode({ id: 'x', kind: 'bookmark', title: 't', url: 'u', added: 1 })).toBe(true)
    expect(isBookmarkNode({ id: 'x', kind: 'bookmark', title: 't', added: 1 })).toBe(false)
    expect(isBookmarkNode({ id: 'x', kind: 'folder', title: 't', added: 1 })).toBe(false)
    expect(
      isBookmarkNode({ id: 'x', kind: 'folder', title: 't', added: 1, children: [{ id: 'y' }] }),
    ).toBe(false)
    expect(isBookmarkNode({ id: 'x', kind: 'folder', title: 't', added: NaN, children: [] })).toBe(
      false,
    )
    expect(isBookmarkFolder({ id: 'x', kind: 'bookmark', title: 't', url: 'u', added: 1 })).toBe(
      false,
    )
  })

  it('drops unsafe urls, fixes ids, clamps titles and times, and pins the root id', () => {
    let n = 0
    const nextId = () => `gen${++n}`
    const root: BookmarkFolder = {
      id: 'whatever',
      kind: 'folder',
      title: '',
      added: -5,
      children: [
        { id: 'a', kind: 'bookmark', title: 'x'.repeat(600), url: 'https://a.b/', added: now },
        { id: 'a', kind: 'bookmark', title: 'dup id', url: 'https://c.d/', added: now + 5 * day },
        { id: '', kind: 'bookmark', title: 'no id', url: 'https://e.f/', added: 0 },
        { id: 'bad', kind: 'bookmark', title: 'bad', url: 'javascript:alert(1)', added: now },
        { id: 'f', kind: 'folder', title: 'F', added: now, children: [] },
      ],
    }
    const out = sanitizeBookmarks(root, nextId, now)
    expect(out.id).toBe('root')
    expect(out.title).toBe('Bookmarks')
    expect(out.added).toBe(now)
    expect(out.children.map((c) => c.id)).toEqual(['a', 'gen1', 'gen2', 'f'])
    expect(out.children[0]?.title).toHaveLength(500)
    expect(out.children[1]?.added).toBe(now)
    expect(out.children[2]?.added).toBe(now)
    expect(out.children.some((c) => c.kind === 'bookmark' && c.url.startsWith('javascript'))).toBe(
      false,
    )
  })

  it('cuts off folders deeper than the depth limit', () => {
    let node: BookmarkFolder = {
      id: 'leaf',
      kind: 'folder',
      title: 'leaf',
      added: now,
      children: [],
    }
    for (let i = 0; i < 20; i++)
      node = { id: `f${i}`, kind: 'folder', title: `f${i}`, added: now, children: [node] }
    const root: BookmarkFolder = {
      id: 'root',
      kind: 'folder',
      title: 'Bookmarks',
      added: now,
      children: [node],
    }
    expect(isBookmarkFolder(root)).toBe(false)
    let depth = 0
    let cursor: BookmarkFolder | undefined = sanitizeBookmarks(root, () => 'x', now)
    while (cursor?.children[0]?.kind === 'folder') {
      cursor = cursor.children[0]
      depth++
    }
    expect(depth).toBe(16)
  })
})
