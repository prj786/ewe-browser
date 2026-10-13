import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countBookmarks, flattenBookmarks, type BookmarkFolder } from '@ewe/shared'
import { BookmarksStore, isBookmarksFile } from '../../src/main/storage/bookmarks-store'

const now = Date.UTC(2026, 9, 12)

function fresh(): BookmarksStore {
  return new BookmarksStore(mkdtempSync(join(tmpdir(), 'ewe-bm-')))
}

describe('isBookmarksFile', () => {
  it('accepts version 1 with a root folder whose id is root', () => {
    expect(
      isBookmarksFile({
        version: 1,
        root: { id: 'root', kind: 'folder', title: 'Bookmarks', children: [], added: now },
      }),
    ).toBe(true)
    expect(
      isBookmarksFile({
        version: 1,
        root: { id: 'x', kind: 'folder', title: 'Bookmarks', children: [], added: now },
      }),
    ).toBe(false)
    expect(isBookmarksFile({ version: 2, root: {} })).toBe(false)
    expect(isBookmarksFile(null)).toBe(false)
  })
})

describe('BookmarksStore', () => {
  it('starts empty and adds, toggles and removes bookmarks', () => {
    const store = fresh()
    const changes: number[] = []
    store.on('change', (root) => changes.push(countBookmarks(root)))
    expect(store.root().children).toEqual([])
    expect(store.add('javascript:alert(1)', 'x')).toBeUndefined()
    const item = store.add('https://example.com/', '  Example  ', undefined, now)
    expect(item).toMatchObject({ kind: 'bookmark', title: 'Example', url: 'https://example.com/' })
    expect(store.isBookmarked('https://example.com/')).toBe(true)
    expect(store.toggle('https://example.com/', 'Example')).toBe(false)
    expect(store.isBookmarked('https://example.com/')).toBe(false)
    expect(store.toggle('https://example.com/', '')).toBe(true)
    expect(store.find('https://example.com/')?.title).toBe('https://example.com/')
    expect(store.toggle('app://newtab/', 'New tab')).toBeUndefined()
    expect(store.remove('root')).toBe(false)
    expect(store.remove('nope')).toBe(false)
    const id = store.find('https://example.com/')?.id ?? ''
    expect(store.remove(id)).toBe(true)
    expect(changes).toEqual([1, 0, 1, 0])
  })

  it('creates folders, moves and edits nodes, and refuses cycles', () => {
    const store = fresh()
    const dev = store.createFolder('Dev', undefined, now)
    const inner = store.createFolder('  ', dev.id, now)
    expect(inner.title).toBe('New folder')
    const item = store.add('https://www.electronjs.org/', 'Electron', dev.id, now)
    if (item === undefined) throw new Error('add failed')
    expect(flattenBookmarks(store.root()).map((b) => b.path)).toEqual([['Dev']])
    expect(
      store.update(item.id, { title: 'Electron docs', url: 'https://www.electronjs.org/docs' }),
    ).toBe(true)
    expect(store.update(item.id, { url: 'javascript:x' })).toBe(false)
    expect(store.update(item.id, { folderId: 'root' })).toBe(true)
    expect(flattenBookmarks(store.root()).map((b) => b.path)).toEqual([[]])
    expect(store.update(dev.id, { folderId: inner.id })).toBe(false)
    expect(store.update(dev.id, { folderId: dev.id })).toBe(false)
    expect(store.update(dev.id, { title: 'Development' })).toBe(true)
    expect(store.update('root', { title: 'x' })).toBe(false)
    expect(store.update(item.id, { title: '   ' })).toBe(true)
    expect(store.find('https://www.electronjs.org/docs')?.title).toBe(
      'https://www.electronjs.org/docs',
    )
    expect(store.remove(dev.id)).toBe(true)
    expect(store.root().children.map((c) => c.kind)).toEqual(['bookmark'])
  })

  it('replaces an import folder with the same title', () => {
    const store = fresh()
    const folder = (n: number): BookmarkFolder => ({
      id: `import${n}`,
      kind: 'folder',
      title: 'Imported from Chrome (2026-10-12)',
      added: now,
      children: [
        { id: `i${n}`, kind: 'bookmark', title: 'A', url: `https://a.b/${n}`, added: now },
      ],
    })
    store.replaceFolder(folder(1))
    store.replaceFolder(folder(2))
    expect(store.root().children).toHaveLength(1)
    expect(flattenBookmarks(store.root()).map((b) => b.item.url)).toEqual(['https://a.b/2'])
  })

  it('persists atomically and loads the sanitized tree back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-bm-'))
    const store = new BookmarksStore(dir)
    store.add('https://example.com/', 'Example', undefined, now)
    const dev = store.createFolder('Dev', undefined, now)
    store.add('https://www.electronjs.org/', 'Electron', dev.id, now)
    await store.flush()
    const raw: unknown = JSON.parse(readFileSync(join(dir, 'bookmarks.json'), 'utf8'))
    expect(isBookmarksFile(raw)).toBe(true)
    const again = new BookmarksStore(dir)
    await again.load()
    expect(flattenBookmarks(again.root()).map((b) => [b.item.title, b.path])).toEqual([
      ['Example', []],
      ['Electron', ['Dev']],
    ])
    const empty = new BookmarksStore(mkdtempSync(join(tmpdir(), 'ewe-bm-')))
    await empty.load()
    expect(empty.root().children).toEqual([])
  })
})

describe('BookmarksStore reorder', () => {
  it('moves a node to an index inside its folder or another folder', () => {
    const store = fresh()
    const a = store.add('https://a.test/', 'A', undefined, now)
    const b = store.add('https://b.test/', 'B', undefined, now)
    const c = store.add('https://c.test/', 'C', undefined, now)
    const folder = store.createFolder('Dev', undefined, now)
    if (a === undefined || b === undefined || c === undefined) throw new Error('add failed')
    const titles = (f: BookmarkFolder) => f.children.map((n) => n.title)
    expect(store.update(c.id, { index: 0 })).toBe(true)
    expect(titles(store.root())).toEqual(['C', 'A', 'B', 'Dev'])
    expect(store.update(c.id, { index: 3 })).toBe(true)
    expect(titles(store.root())).toEqual(['A', 'B', 'C', 'Dev'])
    expect(store.update(a.id, { folderId: folder.id, index: 0 })).toBe(true)
    expect(store.update(b.id, { folderId: folder.id, index: 0 })).toBe(true)
    const dev = store.root().children.find((n) => n.id === folder.id)
    expect(dev?.kind === 'folder' ? titles(dev) : null).toEqual(['B', 'A'])
    expect(store.update(folder.id, { folderId: folder.id })).toBe(false)
    expect(store.update(b.id, { folderId: 'root', index: 99 })).toBe(true)
    expect(titles(store.root())).toEqual(['C', 'Dev', 'B'])
  })
})
