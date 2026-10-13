import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countBookmarks, flattenBookmarks } from '@ewe/shared'
import {
  chromeBookmarkPaths,
  chromeTimeToMs,
  importFolderTitle,
  parseChromeBookmarks,
  readChromeBookmarks,
} from '../../src/main/chrome-bookmarks'

const FIXTURE = join(__dirname, '../fixtures/chrome-bookmarks.json')
const now = Date.UTC(2026, 9, 12)
const fixture = (): unknown => JSON.parse(readFileSync(FIXTURE, 'utf8'))

describe('chromeTimeToMs', () => {
  it('converts microseconds since 1601 and falls back for junk or future values', () => {
    expect(chromeTimeToMs('13435286400000000', now)).toBe(Date.UTC(2026, 9, 1))
    expect(chromeTimeToMs(13435286400000000, now)).toBe(Date.UTC(2026, 9, 1))
    expect(chromeTimeToMs('junk', now)).toBe(now)
    expect(chromeTimeToMs('0', now)).toBe(now)
    expect(chromeTimeToMs('99999999999999999999', now)).toBe(now)
    expect(chromeTimeToMs(undefined, now)).toBe(now)
  })
})

describe('parseChromeBookmarks', () => {
  it('maps the Chrome roots into folders inside a dated import folder', () => {
    let n = 0
    const folder = parseChromeBookmarks(fixture(), now, () => `id${++n}`)
    if (folder === null) throw new Error('no folder')
    expect(folder.title).toBe('Imported from Chrome (2026-10-12)')
    expect(importFolderTitle(now)).toBe(folder.title)
    expect(folder.children.map((c) => c.title)).toEqual(['Bookmarks bar', 'Other bookmarks'])
    expect(countBookmarks(folder)).toBe(6)
    expect(flattenBookmarks(folder).map((b) => [b.item.url, b.path])).toEqual([
      ['https://example.com/', ['Bookmarks bar']],
      ['https://www.electronjs.org/', ['Bookmarks bar', 'Dev']],
      ['https://www.solidjs.com/', ['Bookmarks bar', 'Dev']],
      ['https://en.wikipedia.org/wiki/Sheep', ['Bookmarks bar']],
      ['https://wiki.hyprland.org/', ['Other bookmarks']],
      ['https://geist.vercel.app/', ['Other bookmarks']],
    ])
    const items = flattenBookmarks(folder).map((b) => b.item)
    expect(items[0]?.added).toBe(Date.UTC(2026, 9, 1))
    expect(items[5]?.title).toBe('https://geist.vercel.app/')
    expect(items[5]?.added).toBe(now)
    expect(new Set(flattenBookmarks(folder).map((b) => b.item.id)).size).toBe(6)
  })

  it('returns null for files without roots and skips empty roots', () => {
    expect(parseChromeBookmarks(null, now)).toBeNull()
    expect(parseChromeBookmarks({ version: 1 }, now)).toBeNull()
    expect(parseChromeBookmarks('x', now)).toBeNull()
    const empty = parseChromeBookmarks({
      roots: { bookmark_bar: { type: 'folder', children: [] } },
    })
    expect(empty?.children).toEqual([])
  })
})

describe('chromeBookmarkPaths', () => {
  it('puts the override first and falls back to the Chrome and Chromium profiles', () => {
    expect(chromeBookmarkPaths({}, '/home/u')).toEqual([
      '/home/u/.config/google-chrome/Default/Bookmarks',
      '/home/u/.config/chromium/Default/Bookmarks',
    ])
    expect(chromeBookmarkPaths({ EWE_CHROME_BOOKMARKS: '/tmp/b.json' }, '/home/u')[0]).toBe(
      '/tmp/b.json',
    )
    expect(chromeBookmarkPaths({ EWE_CHROME_BOOKMARKS: '' }, '/home/u')).toHaveLength(2)
  })
})

describe('readChromeBookmarks', () => {
  it('reads the first readable file, reports missing or broken files, and never writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-chrome-'))
    const missing = join(dir, 'nope')
    const ok = await readChromeBookmarks([missing, FIXTURE], now)
    expect(ok).toMatchObject({ ok: true, count: 6, path: FIXTURE })
    const none = await readChromeBookmarks([missing], now)
    expect(none).toEqual({ ok: false, error: 'not-found', paths: [missing] })
    const broken = join(dir, 'Bookmarks')
    writeFileSync(broken, '{not json')
    const bad = await readChromeBookmarks([broken, FIXTURE], now)
    expect(bad).toMatchObject({ ok: false, error: 'unreadable' })
    expect(readFileSync(broken, 'utf8')).toBe('{not json')
    expect(JSON.stringify(fixture())).toBe(
      JSON.stringify(JSON.parse(readFileSync(FIXTURE, 'utf8'))),
    )
  })
})
