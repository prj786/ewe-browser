import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DownloadEntry } from '@ewe/shared'
import { HistoryService } from '../../src/main/history-service'
import { BookmarksStore } from '../../src/main/storage/bookmarks-store'
import { DownloadsStore } from '../../src/main/storage/downloads-store'
import { HistoryStore } from '../../src/main/storage/history-store'
import { SettingsStore } from '../../src/main/storage/settings-store'
import { SyncService } from '../../src/main/sync/service'

vi.mock('electron', () => ({
  app: { getName: () => 'ewe-browser', userAgentFallback: '' },
  ipcMain: { handle: () => undefined },
  webContents: { getAllWebContents: () => [] },
}))

const DAY = 86_400_000
const now = Date.now()
const dirs: string[] = []
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function download(id: string, started: number, status: DownloadEntry['status']): DownloadEntry {
  return {
    id,
    url: `https://files.test/${id}`,
    filename: `${id}.txt`,
    path: `/tmp/${id}.txt`,
    mime: 'text/plain',
    received: 1,
    total: 1,
    speed: 0,
    status,
    started,
    ended: status === 'completed' ? started + 1 : null,
  }
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-history-service-'))
  dirs.push(dir)
  const settings = new SettingsStore(dir)
  const history = new HistoryStore(dir)
  const downloads = new DownloadsStore(dir)
  const bookmarks = new BookmarksStore(dir)
  await settings.load()
  await history.load()
  const sync = new SyncService({ userData: dir, settings, bookmarks, history })
  const calls: string[] = []
  const fakeSession = {
    clearData: (options: {
      dataTypes?: string[]
      origins?: string[]
      excludeOrigins?: string[]
    }) => {
      calls.push(
        `clearData ${(options.dataTypes ?? []).join(',')} origins=${(options.origins ?? []).join(',')} exclude=${(options.excludeOrigins ?? []).join(',')}`,
      )
      return Promise.resolve()
    },
    clearCache: () => {
      calls.push('clearCache')
      return Promise.resolve()
    },
    clearCodeCaches: () => {
      calls.push('clearCodeCaches')
      return Promise.resolve()
    },
  }
  const cleared: [number, number][] = []
  const service = new HistoryService({
    history,
    settings,
    downloads,
    sync,
    sessions: () => [fakeSession as unknown as Electron.Session],
    extensionOrigins: () => ['chrome-extension://abc'],
    onHistoryCleared: (from, to) => cleared.push([from, to]),
  })
  cleanups.push(() => {
    service.dispose()
    sync.dispose()
    history.close()
  })
  return { settings, history, downloads, service, calls, cleared }
}

describe('HistoryService', () => {
  it('clears a time range of history and downloads, never cookies or cache for a range', async () => {
    const { history, downloads, service, calls, cleared } = await setup()
    history.record('https://old.test/', 'Old', now - 3 * DAY)
    history.record('https://new.test/', 'New', now - 10 * 60_000)
    downloads.add(download('old', now - 3 * DAY, 'completed'))
    downloads.add(download('new', now - 60_000, 'completed'))
    downloads.add(download('running', now - 60_000, 'progressing'))
    const result = await service.handle({
      op: 'clear',
      range: 'hour',
      history: true,
      cookies: true,
      cache: true,
      downloads: true,
    })
    expect(result).toEqual({
      ok: true,
      value: { history: 1, downloads: 1, cookies: false, cache: false },
    })
    expect(history.all().map((e) => e.url)).toEqual(['https://old.test/'])
    expect(cleared).toHaveLength(1)
    expect((cleared[0]?.[1] ?? 0) - (cleared[0]?.[0] ?? 0)).toBe(60 * 60_000)
    expect(
      downloads
        .list()
        .map((d) => d.id)
        .sort(),
    ).toEqual(['old', 'running'])
    expect(calls).toEqual([])
  })

  it('clears cookies, site data and the cache for all time, keeping extensions', async () => {
    const { service, calls } = await setup()
    const result = await service.handle({
      op: 'clear',
      range: 'all',
      history: false,
      cookies: true,
      cache: true,
      downloads: false,
    })
    expect(result).toEqual({
      ok: true,
      value: { history: 0, downloads: 0, cookies: true, cache: true },
    })
    expect(calls).toEqual([
      'clearData cookies,localStorage,indexedDB,serviceWorkers,fileSystems,backgroundFetch,webSQL origins= exclude=chrome-extension://abc',
      'clearCache',
      'clearCodeCaches',
    ])
  })

  it('deletes a whole site and, when asked, its cookies and site data', async () => {
    const { history, service, calls } = await setup()
    history.record('https://www.flock.test/', 'Flock', now - 1000)
    history.record('https://shop.flock.test/', 'Shop', now - 1000)
    history.record('https://keep.test/', 'Keep', now - 1000)
    expect(await service.handle({ op: 'siteCount', site: 'flock.test' })).toEqual({
      ok: true,
      value: 2,
    })
    expect(await service.handle({ op: 'deleteSite', site: 'flock.test', siteData: true })).toEqual({
      ok: true,
      value: { removed: 2, siteData: true },
    })
    expect(history.all().map((e) => e.url)).toEqual(['https://keep.test/'])
    expect(calls[0]).toContain('origins=https://flock.test,http://flock.test')
    expect(calls[0]).toContain('https://shop.flock.test')
  })

  it('serves day rows with site: in the search, and keeps the retention setting', async () => {
    const { history, settings, service } = await setup()
    history.record('https://a.test/sheep', 'Sheep', now - 100 * DAY)
    history.record('https://b.test/sheep', 'Sheep too', now - 1000)
    const rows = await service.handle({ op: 'rows', query: 'sheep site:b.test' })
    expect(rows.ok && (rows.value as { rows: { url: string }[] }).rows.map((r) => r.url)).toEqual([
      'https://b.test/sheep',
    ])
    expect(await service.handle({ op: 'keep', days: 90 })).toEqual({ ok: true, value: 90 })
    expect(settings.get().historyDays).toBe(90)
    expect(history.all().map((e) => e.url)).toEqual(['https://b.test/sheep'])
    const summary = await service.handle({ op: 'summary' })
    expect(summary).toEqual({
      ok: true,
      value: { pages: 1, keepDays: 90, sync: false, lastSync: null, warning: null, machines: [] },
    })
  })

  it('deletes the visits of one page on one day', async () => {
    const { history, service } = await setup()
    history.record('https://a.test/', 'A', now - 2 * DAY)
    history.record('https://a.test/', 'A', now - 1000)
    const result = await service.handle({
      op: 'delete',
      items: [{ url: 'https://a.test/', from: now - 60_000, to: now }],
    })
    expect(result).toEqual({ ok: true, value: { removed: 1 } })
    expect(history.all()[0]?.last).toBe(now - 2 * DAY)
  })
})
