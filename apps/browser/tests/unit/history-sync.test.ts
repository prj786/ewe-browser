import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryClear, SessionWindow } from '@ewe/shared'
import type { HistoryEntry } from '../../src/main/history'
import { HistoryService } from '../../src/main/history-service'
import { BookmarksStore } from '../../src/main/storage/bookmarks-store'
import { DownloadsStore } from '../../src/main/storage/downloads-store'
import { HistoryStore } from '../../src/main/storage/history-store'
import { SettingsStore } from '../../src/main/storage/settings-store'
import {
  CLEAR_TTL,
  MAX_CLEARS,
  compactClears,
  filterHistory,
  merge3,
  mergeHistory,
  narrowHistory,
  sameClears,
} from '../../src/main/sync/merge'
import { legacyFileId, machineId } from '../../src/main/sync/machine'
import { ownTabs, SyncService, tabsFileName } from '../../src/main/sync/service'
import { parsePropfind } from '../../src/main/sync/webdav'
import { davMock, type DavMock } from '../support/dav-mock'

vi.mock('electron', () => ({
  app: { getName: () => 'ewe-browser', userAgentFallback: 'Mozilla/5.0 Chrome/152.0.0.0' },
  ipcMain: { handle: () => undefined },
  webContents: { getAllWebContents: () => [] },
}))

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 15, 12)

const entry = (url: string, last: number, count = 1, title = url): HistoryEntry => ({
  url,
  title,
  host: new URL(url).host,
  count,
  last,
})

const records = (...entries: HistoryEntry[]) =>
  Object.fromEntries(entries.map((e) => [e.url, e])) as Record<string, HistoryEntry>

const clear = (patch: Partial<HistoryClear> & { id: string }): HistoryClear => ({
  at: now,
  from: 0,
  to: now,
  ...patch,
})

describe('history clears in the merge', () => {
  it('drops entries covered by a page, a site or a time range, and entries past the cutoff', () => {
    const input = records(
      entry('https://a.test/', now - DAY),
      entry('https://www.flock.test/1', now - DAY),
      entry('https://shop.flock.test/2', now - DAY),
      entry('https://other.test/', now - 30 * 60_000),
      entry('https://old.test/', now - 40 * DAY),
      entry('https://later.test/', now + 1000),
    )
    const clears = [
      clear({ id: '1', url: 'https://a.test/' }),
      clear({ id: '2', site: 'flock.test' }),
      clear({ id: '3', from: now - 3_600_000, to: now }),
    ]
    expect(Object.keys(filterHistory(input, clears, now - 30 * DAY))).toEqual([
      'https://later.test/',
    ])
    expect(Object.keys(filterHistory(input, [], 0))).toHaveLength(6)
  })

  it('drops malformed records from the server', () => {
    const bad = {
      'https://ok.test/': entry('https://ok.test/', now),
      'https://other.test/': entry('https://wrong-key.test/', now),
      'https://title.test/': { ...entry('https://title.test/', now), title: 5 },
      'https://last.test/': { ...entry('https://last.test/', now), last: 'soon' },
      'https://null.test/': null,
    } as unknown as Record<string, HistoryEntry>
    expect(Object.keys(filterHistory(bad, [], 0))).toEqual(['https://ok.test/'])
  })

  it('lets a visit after the deletion win, and a visit before it lose', () => {
    const deleted = clear({ id: 'd', url: 'https://a.test/', to: now })
    const before = records(entry('https://a.test/', now - 1000, 4))
    const after = records(entry('https://a.test/', now + 1000, 1))
    expect(filterHistory(before, [deleted], 0)).toEqual({})
    expect(filterHistory(after, [deleted], 0)).toEqual(after)
  })

  it('carries a deletion through the three-way merge even against an old edit', () => {
    const deleted = [clear({ id: 'd', url: 'https://a.test/' })]
    const base = filterHistory(records(entry('https://a.test/', now - DAY)), deleted, 0)
    const local = filterHistory(records(), deleted, 0)
    const remote = filterHistory(records(entry('https://a.test/', now - 60_000, 2)), deleted, 0)
    expect(mergeHistory(base, local, remote)).toEqual({})
    expect(merge3({ a: 1 }, {}, { a: 2 }, (l: number, r: number) => Math.max(l, r))).toEqual({
      a: 2,
    })
  })

  it('keeps pages older than the clear horizon out of an upload, and lets a server delete win', () => {
    const horizon = now - CLEAR_TTL
    const old = now - CLEAR_TTL - DAY
    const base = records(entry('https://synced.test/', old))
    const local = records(
      entry('https://synced.test/', old, 3),
      entry('https://never.test/', old),
      entry('https://fresh.test/', now),
      entry('https://shared.test/', old),
    )
    const remote = records(entry('https://shared.test/', old))
    const narrowed = narrowHistory(base, local, remote, horizon)
    expect(Object.keys(narrowed.local).sort()).toEqual([
      'https://fresh.test/',
      'https://shared.test/',
    ])
    expect(narrowed.dropped).toEqual(['https://synced.test/'])
  })

  it('compacts clears: expired ones go, an all-time clear covers older ones, the order is stable', () => {
    const list = [
      clear({ id: 'b', at: now - 10, from: now - 100, to: now - 10 }),
      clear({ id: 'old', at: now - CLEAR_TTL - 1 }),
      clear({ id: 'all', at: now - 5, from: 0, to: now - 5 }),
      clear({ id: 'a', at: now - 1, url: 'https://x.test/', to: now - 1 }),
      clear({ id: 'a', at: now - 1, url: 'https://x.test/', to: now - 1 }),
    ]
    expect(compactClears(list, now).map((c) => c.id)).toEqual(['all', 'a'])
    const many = Array.from({ length: MAX_CLEARS + 10 }, (_, i) =>
      clear({ id: `c${i}`, at: now - i, url: `https://p${i}.test/`, to: now - i }),
    )
    const kept = compactClears(many, now)
    expect(kept).toHaveLength(MAX_CLEARS)
    expect(kept.at(-1)?.id).toBe('c0')
    expect(sameClears(kept, kept)).toBe(true)
    expect(sameClears(undefined, kept)).toBe(false)
  })
})

describe('tab files', () => {
  it('keeps web tabs per window and workspace and names the file after the machine', () => {
    const windows: SessionWindow[] = [
      {
        bounds: null,
        activeIndex: 0,
        workspaces: [
          { id: 'w1', name: 'Home', color: 'ewellow' },
          { id: 'w2', name: 'Work', color: 'sky' },
          { id: 'w3', name: 'Empty', color: 'mint' },
        ],
        tabs: [
          { url: 'https://a.test/', title: 'A', workspace: 0, pinned: true },
          { url: 'app://settings/', title: 'Settings', workspace: 0 },
          { url: 'https://b.test/', title: 'B', workspace: 1 },
          { url: 'file:///tmp/x', title: 'x', workspace: 1 },
        ],
      },
      { bounds: null, activeIndex: 0, tabs: [{ url: 'app://home/', title: 'Home' }] },
    ]
    expect(ownTabs(windows)).toEqual([
      {
        workspaces: [
          {
            name: 'Home',
            color: 'ewellow',
            tabs: [{ url: 'https://a.test/', title: 'A', pinned: true }],
          },
          {
            name: 'Work',
            color: 'sky',
            tabs: [{ url: 'https://b.test/', title: 'B', pinned: false }],
          },
        ],
      },
    ])
    expect(tabsFileName('0123456789abcdef')).toBe('tabs-0123456789abcdef.json')
    expect(legacyFileId('Sam’s laptop/2')).toBe('Sam-s-laptop-2')
  })

  it('reads hrefs and etags from a Nextcloud PROPFIND answer', () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">
<d:response><d:href>/remote.php/dav/files/sam/ewe/browser/</d:href><d:propstat><d:prop><d:getetag>&quot;dir&quot;</d:getetag></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/sam/ewe/browser/tabs-kosmos.json</d:href><d:propstat><d:prop><d:getetag>&quot;6a1b&quot;</d:getetag></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/sam/ewe/browser/tabs-my%20box.json</d:href><d:propstat><d:prop/></d:propstat></d:response>
</d:multistatus>`
    expect(parsePropfind(xml)).toEqual([
      { name: 'browser', etag: '"dir"' },
      { name: 'tabs-kosmos.json', etag: '"6a1b"' },
      { name: 'tabs-my box.json', etag: null },
    ])
  })
})

describe('machine identity', () => {
  it('derives a stable id per machine and profile, and keeps a random one without machine-id', () => {
    const one = machineId('/profiles/a')
    expect(one).toMatch(/^[0-9a-f]{16}$/)
    expect(machineId('/profiles/a')).toBe(one)
    expect(machineId('/profiles/b')).not.toBe(one)
    const dir = mkdtempSync(join(tmpdir(), 'ewe-machine-'))
    try {
      const random = machineId(dir, ['/nonexistent/machine-id'])
      expect(random).toMatch(/^[0-9a-f]{16}$/)
      expect(machineId(dir, ['/nonexistent/machine-id'])).toBe(random)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

interface Machine {
  name: string
  dir: string
  settings: SettingsStore
  bookmarks: BookmarksStore
  history: HistoryStore
  sync: SyncService
  service: HistoryService
  tabs: SessionWindow[]
}

describe('sync between two machines through a mock WebDAV server', () => {
  let dav: DavMock
  const machines: Machine[] = []
  const dirs: string[] = []

  beforeEach(async () => {
    dav = await davMock()
    process.env.EWE_SYNC_URL = dav.url
  })

  afterEach(async () => {
    for (const m of machines.splice(0)) {
      m.sync.dispose()
      m.service.dispose()
      m.history.close()
    }
    delete process.env.EWE_SYNC_URL
    delete process.env.EWE_SYNC_MACHINE
    await dav.close()
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  async function machine(name: string): Promise<Machine> {
    const dir = mkdtempSync(join(tmpdir(), `ewe-sync-${name}-`))
    dirs.push(dir)
    const settings = new SettingsStore(dir)
    const bookmarks = new BookmarksStore(dir)
    const history = new HistoryStore(dir)
    await settings.load()
    await bookmarks.load()
    await history.load()
    const sync = new SyncService({ userData: dir, settings, bookmarks, history })
    history.setClock(() => sync.now())
    const service = new HistoryService({
      history,
      settings,
      downloads: new DownloadsStore(dir),
      sync,
      sessions: () => [],
      extensionOrigins: () => [],
    })
    service.start()
    const m: Machine = { name, dir, settings, bookmarks, history, sync, service, tabs: [] }
    sync.setTabsSource(() => m.tabs)
    settings.update({ sync: true })
    machines.push(m)
    return m
  }

  async function run(m: Machine): Promise<void> {
    process.env.EWE_SYNC_MACHINE = m.name
    await m.sync.run()
    expect(m.sync.status()).toMatchObject({ state: 'idle', error: null })
  }

  const urls = (m: Machine) =>
    m.history
      .all()
      .map((e) => e.url)
      .sort()

  it('syncs visits, then deletions, ranges and sites, and lets a newer visit win', async () => {
    const t = Date.now()
    const a = await machine('a')
    const b = await machine('b')
    a.history.record('https://x.test/', 'X', t - 2 * DAY)
    a.history.record('https://y.test/', 'Y', t - 2 * DAY)
    a.history.record('https://www.flock.test/1', 'Flock', t - DAY)
    b.history.record('https://z.test/', 'Z', t - 3 * DAY)
    await run(a)
    await run(b)
    await run(a)
    expect(urls(a)).toEqual(urls(b))
    expect(urls(b)).toEqual([
      'https://www.flock.test/1',
      'https://x.test/',
      'https://y.test/',
      'https://z.test/',
    ])

    a.history.remove('https://x.test/', t - 1000)
    b.history.record('https://y.test/', 'Y again', t - 500)
    await run(a)
    await run(b)
    expect(urls(b)).not.toContain('https://x.test/')
    expect(b.history.all().find((e) => e.url === 'https://y.test/')?.title).toBe('Y again')
    const remote = dav.read('history.json') as {
      data: Record<string, unknown>
      clears: HistoryClear[]
    }
    expect(Object.keys(remote.data)).not.toContain('https://x.test/')
    expect(remote.clears.map((c) => c.url)).toContain('https://x.test/')

    b.history.record('https://x.test/', 'X back', t)
    await run(b)
    await run(a)
    expect(urls(a)).toContain('https://x.test/')

    b.history.record('https://recent.test/', 'Recent', t - 10 * 60_000)
    await run(b)
    await run(a)
    expect(urls(a)).toContain('https://recent.test/')
    a.history.clear({ from: t - 3_600_000, to: t + 1 }, t + 1)
    b.history.clear({ from: 0, to: t + 1, site: 'flock.test' }, t + 1)
    await run(a)
    await run(b)
    await run(a)
    expect(urls(a)).toEqual(urls(b))
    expect(urls(a)).toEqual(['https://y.test/', 'https://z.test/'])
  })

  it('re-uploads clears an old client dropped and never resurrects the deleted page', async () => {
    const t = Date.now()
    const a = await machine('a')
    a.history.record('https://x.test/', 'X', t - DAY)
    a.history.record('https://y.test/', 'Y', t - DAY)
    await run(a)
    a.history.remove('https://x.test/', t - 1000)
    await run(a)
    dav.write('history.json', {
      version: 1,
      machine: 'old',
      savedAt: t,
      data: {
        'https://x.test/': entry('https://x.test/', t - DAY),
        'https://y.test/': entry('https://y.test/', t - DAY),
      },
    })
    const b = await machine('b')
    await run(b)
    await run(a)
    await run(b)
    expect(urls(a)).toEqual(['https://y.test/'])
    expect(urls(b)).toEqual(['https://y.test/'])
    const remote = dav.read('history.json') as { clears?: HistoryClear[] }
    expect(remote.clears?.length).toBe(1)
  })

  it('keeps the history length setting on both machines', async () => {
    const t = Date.now()
    const a = await machine('a')
    const b = await machine('b')
    b.history.record('https://ancient.test/', 'Ancient', t - 60 * DAY)
    b.history.record('https://fresh.test/', 'Fresh', t - DAY)
    await run(b)
    await run(a)
    expect(urls(a)).toEqual(['https://ancient.test/', 'https://fresh.test/'])
    a.settings.update({ historyDays: 30 })
    await run(a)
    await run(b)
    expect(b.settings.get().historyDays).toBe(30)
    expect(urls(a)).toEqual(['https://fresh.test/'])
    expect(urls(b)).toEqual(['https://fresh.test/'])
  })

  it('writes this machine’s tabs and reads the others’', async () => {
    const a = await machine('kosmos')
    const b = await machine('ewebook')
    a.tabs = [
      {
        bounds: null,
        activeIndex: 0,
        workspaces: [{ id: 'w', name: 'Wool', color: 'violet' }],
        tabs: [{ url: 'https://wool.test/', title: 'Wool', workspace: 0 }],
      },
    ]
    b.tabs = [{ bounds: null, activeIndex: 0, tabs: [{ url: 'https://own.test/', title: 'Own' }] }]
    dav.write('tabs-stale.json', {
      version: 1,
      machine: 'stale',
      savedAt: Date.now() - 40 * DAY,
      windows: [],
    })
    dav.write('tabs-broken.json', { version: 1, machine: 'broken' })
    const seen: string[][] = []
    b.sync.on('tabs', (list) => seen.push(list.map((m) => m.machine)))
    await run(a)
    await run(b)
    expect(dav.read(tabsFileName(a.sync.id))).toMatchObject({
      version: 1,
      id: a.sync.id,
      machine: 'kosmos',
      windows: [
        { workspaces: [{ name: 'Wool', color: 'violet', tabs: [{ url: 'https://wool.test/' }] }] },
      ],
    })
    expect(b.sync.remoteTabs().map((m) => m.machine)).toEqual(['kosmos'])
    expect(seen.at(-1)).toEqual(['kosmos'])
    expect(a.sync.remoteTabs()).toEqual([])

    const gets = () =>
      dav.requests.filter((r) => r === `GET ${dav.folder}${tabsFileName(a.sync.id)}`).length
    const before = gets()
    await run(b)
    expect(gets()).toBe(before)

    await run(a)
    expect(a.sync.remoteTabs().map((m) => m.machine)).toEqual(['ewebook'])
    a.settings.update({ sync: false })
    expect(a.sync.remoteTabs()).toEqual([])
  })

  it('tells two machines with the same name apart and removes this machine’s old tab file', async () => {
    const one = await machine('twin')
    const two = await machine('twin')
    one.tabs = [
      { bounds: null, activeIndex: 0, tabs: [{ url: 'https://one.test/', title: 'One' }] },
    ]
    two.tabs = [
      { bounds: null, activeIndex: 0, tabs: [{ url: 'https://two.test/', title: 'Two' }] },
    ]
    dav.write('tabs-twin.json', { version: 1, machine: 'twin', savedAt: Date.now(), windows: [] })
    dav.write('tabs-other.json', { version: 1, machine: 'other', savedAt: Date.now(), windows: [] })
    await run(one)
    expect(dav.read('tabs-twin.json')).toBeNull()
    expect(dav.read('tabs-other.json')).not.toBeNull()
    await run(two)
    await run(one)
    expect(one.sync.id).not.toBe(two.sync.id)
    expect(one.sync.remoteTabs().map((m) => [m.machine, m.id])).toEqual(
      expect.arrayContaining([['twin', two.sync.id]]),
    )
    expect(two.sync.remoteTabs().map((m) => [m.machine, m.id])).toEqual(
      expect.arrayContaining([['twin', one.sync.id]]),
    )
  })

  it('stamps history with the server’s time and warns about clocks that are off', async () => {
    dav.clockOffset = 30 * 60_000
    const a = await machine('slow')
    a.history.record('https://late.test/', 'Late')
    await run(a)
    expect(Math.abs(a.sync.clockOffset() - 30 * 60_000)).toBeLessThan(3000)
    expect(a.sync.status().warning).toContain('behind the Nextcloud server')
    const before = Date.now()
    a.history.remove('https://late.test/')
    const clear = a.history.clears().at(-1)
    expect(clear?.at ?? 0).toBeGreaterThan(before + 29 * 60_000)

    dav.clockOffset = 0
    const remote = dav.read('history.json') as Record<string, unknown>
    dav.write('history.json', { ...remote, machine: 'fast', savedAt: Date.now() + 2 * 3_600_000 })
    const b = await machine('calm')
    await run(b)
    expect(b.sync.status().warning).toContain('The clock on fast is 2 h ahead')
  })

  it('lets a delete win after its record expired, and never uploads an old page it never synced', async () => {
    const t = Date.now()
    const old = t - CLEAR_TTL - 10 * DAY
    dav.write('history.json', {
      version: 1,
      machine: 'a',
      savedAt: t,
      data: records(entry('https://gone.test/', old), entry('https://keep.test/', old)),
    })
    const b = await machine('b')
    await run(b)
    expect(urls(b)).toEqual(['https://gone.test/', 'https://keep.test/'])
    dav.write('history.json', {
      version: 1,
      machine: 'a',
      savedAt: t,
      data: records(entry('https://keep.test/', old)),
      clears: [],
    })
    b.history.applyMerged(
      { 'https://gone.test/': { ...entry('https://gone.test/', old + 1000, 2), title: 'Gone' } },
      [],
    )
    b.history.record('https://private.test/', 'Old local', old)
    await run(b)
    expect(urls(b)).toEqual(['https://keep.test/', 'https://private.test/'])
    const after = dav.read('history.json') as { data: Record<string, unknown> }
    expect(Object.keys(after.data).sort()).toEqual(['https://keep.test/'])
  })

  it('re-uploads everything instead of deleting when the server copy is gone', async () => {
    const a = await machine('a')
    a.history.record('https://one.test/', 'One')
    await run(a)
    dav.files.delete(`${dav.folder}history.json`)
    await run(a)
    expect(urls(a)).toEqual(['https://one.test/'])
    const remote = dav.read('history.json') as { data: Record<string, unknown> }
    expect(Object.keys(remote.data)).toEqual(['https://one.test/'])
  })
})
