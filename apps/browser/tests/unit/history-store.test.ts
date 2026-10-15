import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localDay } from '@ewe/shared'
import { HistoryStore, MAX_ENTRIES } from '../../src/main/storage/history-store'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 15, 12)
const dirs: string[] = []
const stores: HistoryStore[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-history-'))
  dirs.push(dir)
  return dir
}

async function open(dir: string): Promise<HistoryStore> {
  const store = new HistoryStore(dir)
  await store.load()
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('history store on SQLite', () => {
  it('migrates history.json once and keeps it as history.json.bak', async () => {
    const dir = tempDir()
    const legacy = {
      version: 1,
      entries: [
        { url: 'https://a.test/', title: 'Alpha', host: 'a.test', count: 3, last: now - DAY },
        { url: 'https://b.test/x', title: 'Beta', host: 'b.test', count: 1, last: now },
        { url: 'app://home/', title: 'Home', host: 'home', count: 1, last: now },
      ],
    }
    writeFileSync(join(dir, 'history.json'), JSON.stringify(legacy))
    const store = await open(dir)
    expect(store.size()).toBe(2)
    expect(store.list('', 10).map((e) => [e.url, e.count])).toEqual([
      ['https://b.test/x', 1],
      ['https://a.test/', 3],
    ])
    expect(existsSync(join(dir, 'history.json'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'history.json.bak'), 'utf8'))).toEqual(legacy)
    store.close()

    writeFileSync(join(dir, 'history.json'), JSON.stringify({ version: 1, entries: [] }))
    const again = await open(dir)
    expect(again.size()).toBe(2)
    expect(again.visitCount()).toBe(2)
  })

  it('imports a legacy file entry by entry and skips the malformed ones', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'history.json'),
      JSON.stringify({
        version: 1,
        entries: [
          { url: 'https://ok.test/', title: 'Ok', host: 'ok.test', count: 1, last: now },
          { url: 'https://bad.test/', title: 5, host: 'bad.test', count: 1, last: now },
          { url: 'file:///etc/passwd', title: 'x', host: '', count: 1, last: now },
          null,
          { url: 'https://nan.test/', title: '', host: 'nan.test', count: 1, last: 'soon' },
        ],
      }),
    )
    const store = await open(dir)
    expect(store.list('', 10).map((e) => e.url)).toEqual(['https://ok.test/'])
  })

  it('re-imports history.json.bak when the database had to be replaced', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'history.json'),
      JSON.stringify({
        version: 1,
        entries: [
          { url: 'https://saved.test/', title: 'Saved', host: 'saved.test', count: 2, last: now },
        ],
      }),
    )
    const first = await open(dir)
    expect(first.size()).toBe(1)
    first.close()
    writeFileSync(join(dir, 'history.db'), 'garbage after a crash')
    for (const suffix of ['-wal', '-shm'])
      if (existsSync(join(dir, `history.db${suffix}`))) rmSync(join(dir, `history.db${suffix}`))
    const again = await open(dir)
    expect(again.list('', 10).map((e) => [e.url, e.count])).toEqual([['https://saved.test/', 2]])
    expect(existsSync(join(dir, 'history.json.bak'))).toBe(true)
  })

  it('starts empty without a legacy file and survives a broken database', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'history.db'), 'this is not a database')
    const store = await open(dir)
    expect(store.size()).toBe(0)
    store.record('https://sheep.test/', 'Sheep', now)
    expect(store.size()).toBe(1)
  })

  it('records visits write-through and keeps frecency in memory', async () => {
    const dir = tempDir()
    const store = await open(dir)
    store.record('https://wiki.test/sheep', '', now - 2 * DAY)
    store.record('https://wiki.test/sheep', 'Sheep', now - DAY)
    store.record('http://example.test/', 'Example', now)
    store.title('http://example.test/', 'Example Domain')
    store.record('file:///etc/passwd', 'nope', now)
    expect(store.suggest('wiki').map((s) => s.url)).toEqual(['https://wiki.test/sheep'])
    expect(store.complete('exa')).toBe('example.test')
    store.close()
    const reopened = await open(dir)
    expect(reopened.list('', 10)).toEqual([
      {
        url: 'http://example.test/',
        title: 'Example Domain',
        host: 'example.test',
        count: 1,
        last: now,
      },
      {
        url: 'https://wiki.test/sheep',
        title: 'Sheep',
        host: 'wiki.test',
        count: 2,
        last: now - DAY,
      },
    ])
    expect(reopened.visitCount()).toBe(3)
  })

  it('lists one row per page and day, newest first, with paging', async () => {
    const store = await open(tempDir())
    store.record('https://a.test/', 'A', now - 2 * DAY)
    store.record('https://a.test/', 'A', now - 2 * DAY + 1000)
    store.record('https://b.test/', 'B', now - DAY)
    store.record('https://a.test/', 'A', now)
    const all = store.rows('')
    expect(all.next).toBeNull()
    expect(all.rows.map((r) => [r.url, r.day, r.visits])).toEqual([
      ['https://a.test/', localDay(now), 1],
      ['https://b.test/', localDay(now - DAY), 1],
      ['https://a.test/', localDay(now - 2 * DAY), 2],
    ])
    const first = store.rows('', { limit: 2 })
    expect(first.rows).toHaveLength(2)
    expect(first.next).not.toBeNull()
    const second = store.rows('', { limit: 2, before: first.next ?? undefined })
    expect(second.rows.map((r) => r.url)).toEqual(['https://a.test/'])
    expect(second.rows[0]?.visits).toBe(2)
  })

  it('searches title and url with full-text search, short words and site filters', async () => {
    const store = await open(tempDir())
    store.record('https://en.wikipedia.org/wiki/Sheep', 'Sheep - Wikipedia', now - 3000)
    store.record('https://www.youtube.com/watch?v=1', 'Sheep shearing', now - 2000)
    store.record('https://music.youtube.com/', 'YouTube Music', now - 1000)
    store.record('https://github.com/prj786/ewe', 'prj786/ewe', now)
    const urls = (query: string, site?: string) =>
      store.rows(query, site === undefined ? {} : { site }).rows.map((r) => r.url)
    expect(urls('sheep')).toEqual([
      'https://www.youtube.com/watch?v=1',
      'https://en.wikipedia.org/wiki/Sheep',
    ])
    expect(urls('SHEEP wiki')).toEqual(['https://en.wikipedia.org/wiki/Sheep'])
    expect(urls('ewe')).toEqual(['https://github.com/prj786/ewe'])
    expect(urls('gi')).toEqual(['https://github.com/prj786/ewe'])
    expect(urls('"quoted')).toEqual([])
    expect(urls('', 'youtube.com')).toEqual([
      'https://music.youtube.com/',
      'https://www.youtube.com/watch?v=1',
    ])
    expect(store.siteCount('youtube.com')).toBe(2)
    expect(
      store
        .siteHosts('youtube.com')
        .map((h) => h.host)
        .sort(),
    ).toEqual(['music.youtube.com', 'youtube.com'])
  })

  it('clears a time range exactly and keeps older visits of the same page', async () => {
    const store = await open(tempDir())
    store.record('https://a.test/', 'A', now - 3 * DAY)
    store.record('https://a.test/', 'A', now - 10 * 60_000)
    store.record('https://b.test/', 'B', now - 5 * 60_000)
    store.record('https://c.test/', 'C', now - 2 * DAY)
    const touched = store.clear({ from: now - 3_600_000, to: now }, now)
    expect(touched).toBe(2)
    expect(store.list('', 10).map((e) => [e.url, e.last, e.count])).toEqual([
      ['https://c.test/', now - 2 * DAY, 1],
      ['https://a.test/', now - 3 * DAY, 1],
    ])
    expect(store.clears(now)).toEqual([
      expect.objectContaining({ at: now, from: now - 3_600_000, to: now }),
    ])
    expect(store.suggest('b.test')).toEqual([])
  })

  it('removes a page, a page on one day, and a whole site', async () => {
    const store = await open(tempDir())
    store.record('https://a.test/', 'A', now - DAY)
    store.record('https://a.test/', 'A', now)
    store.record('https://www.flock.test/1', 'one', now)
    store.record('https://shop.flock.test/2', 'two', now)
    store.record('https://notflock.test/', 'other', now)
    const today = localDay(now)
    expect(
      store.clearMany([{ url: 'https://a.test/', from: today, to: today + DAY - 1 }], now),
    ).toBe(1)
    expect(store.list('', 10).find((e) => e.url === 'https://a.test/')?.last).toBe(now - DAY)
    expect(store.remove('https://a.test/', now)).toBe(true)
    expect(store.remove('https://a.test/', now)).toBe(false)
    expect(store.clear({ from: 0, to: now, site: 'flock.test' }, now)).toBe(2)
    expect(store.list('', 10).map((e) => e.url)).toEqual(['https://notflock.test/'])
    expect(
      store
        .clears(now)
        .map((c) => c.url ?? c.site)
        .sort(),
    ).toEqual(['flock.test', 'https://a.test/', 'https://a.test/'])
  })

  it('applies clears from other machines once and ignores expired ones', async () => {
    const store = await open(tempDir())
    store.record('https://a.test/', 'A', now - DAY)
    store.record('https://b.test/', 'B', now)
    const clear = { id: 'remote-1', at: now, from: 0, to: now - 1000, url: 'https://a.test/' }
    expect(store.applyClears([clear], now)).toBe(true)
    expect(store.applyClears([clear], now)).toBe(false)
    expect(store.size()).toBe(1)
    const old = { id: 'remote-2', at: now - 400 * DAY, from: 0, to: now, site: 'b.test' }
    expect(store.applyClears([old], now)).toBe(false)
    expect(store.size()).toBe(1)
    expect(store.clears(now).map((c) => c.id)).toEqual(['remote-1'])
  })

  it('keeps history for the chosen number of days', async () => {
    const store = await open(tempDir())
    store.record('https://old.test/', 'Old', now - 40 * DAY)
    store.record('https://mixed.test/', 'Mixed', now - 50 * DAY)
    store.record('https://mixed.test/', 'Mixed', now - DAY)
    store.record('https://new.test/', 'New', now)
    expect(store.enforceRetention(0, now)).toBe(0)
    expect(store.enforceRetention(30, now)).toBe(2)
    expect(store.list('', 10).map((e) => e.url)).toEqual([
      'https://new.test/',
      'https://mixed.test/',
    ])
    expect(store.clears(now)).toEqual([])
  })

  it('applies a merged sync result as a diff inside its scope', async () => {
    const store = await open(tempDir())
    store.record('https://keep.test/', 'Keep', now - DAY)
    store.record('https://gone.test/', 'Gone', now - DAY)
    store.record('https://outside.test/', 'Outside', now - DAY)
    store.applyMerged(
      {
        'https://keep.test/': {
          url: 'https://keep.test/',
          title: 'Keep (remote)',
          host: 'evil.test',
          count: 5,
          last: now,
        },
        'https://new.test/': {
          url: 'https://new.test/',
          title: 'New',
          host: 'new.test',
          count: 2,
          last: now - 1000,
        },
        'javascript:alert(1)': {
          url: 'javascript:alert(1)',
          title: '',
          host: '',
          count: 1,
          last: now,
        },
      },
      ['https://keep.test/', 'https://gone.test/'],
    )
    expect(store.list('', 10).map((e) => [e.url, e.title, e.host, e.count, e.last])).toEqual([
      ['https://keep.test/', 'Keep (remote)', 'keep.test', 5, now],
      ['https://new.test/', 'New', 'new.test', 2, now - 1000],
      ['https://outside.test/', 'Outside', 'outside.test', 1, now - DAY],
    ])
    expect(store.rows('').rows.filter((r) => r.url === 'https://keep.test/')).toHaveLength(2)
  })

  it('caps the number of pages', async () => {
    const dir = tempDir()
    const entries = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({
      url: `https://p${i}.test/`,
      title: `${i}`,
      host: `p${i}.test`,
      count: 1,
      last: now - (MAX_ENTRIES + 5 - i) * 1000,
    }))
    writeFileSync(join(dir, 'history.json'), JSON.stringify({ version: 1, entries }))
    const store = await open(dir)
    expect(store.size()).toBe(MAX_ENTRIES)
    expect(store.list('p0.test', 5)).toEqual([])
    store.record('https://fresh.test/', 'Fresh', now)
    expect(store.size()).toBe(MAX_ENTRIES)
    expect(store.rows('fresh').rows.map((r) => r.url)).toEqual(['https://fresh.test/'])
  })
})
