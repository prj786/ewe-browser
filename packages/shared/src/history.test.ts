import { describe, expect, it } from 'vitest'
import {
  clearCovers,
  hostInSite,
  isHistoryClear,
  isHistoryRequest,
  isRemoteTabsFile,
  isSite,
  keepCutoff,
  localDay,
  nextLocalDay,
  parseHistoryQuery,
  rangeStart,
  searchRemoteTabs,
  siteOf,
  type RemoteMachine,
} from './history'

const now = Date.UTC(2026, 9, 15, 12)
const DAY = 86_400_000

describe('history ranges and retention', () => {
  it('maps the clear ranges and keep options to times', () => {
    expect(rangeStart('hour', now)).toBe(now - 3_600_000)
    expect(rangeStart('day', now)).toBe(now - DAY)
    expect(rangeStart('week', now)).toBe(now - 7 * DAY)
    expect(rangeStart('month', now)).toBe(now - 28 * DAY)
    expect(rangeStart('all', now)).toBe(0)
    expect(keepCutoff(0, now)).toBe(0)
    expect(keepCutoff(30, now)).toBe(now - 30 * DAY)
  })

  it('finds local day boundaries', () => {
    const day = localDay(now)
    expect(new Date(day).getHours()).toBe(0)
    expect(day <= now && now < nextLocalDay(day)).toBe(true)
  })
})

describe('sites and clears', () => {
  it('treats a site as the host and its subdomains', () => {
    expect(siteOf('WWW.YouTube.com')).toBe('youtube.com')
    expect(hostInSite('music.youtube.com', 'youtube.com')).toBe(true)
    expect(hostInSite('youtube.com', 'youtube.com')).toBe(true)
    expect(hostInSite('notyoutube.com', 'youtube.com')).toBe(false)
  })

  it('covers visits by time, page and site', () => {
    const range = { id: 'r', at: now, from: now - 10, to: now }
    expect(clearCovers(range, 'https://a/', 'a', now - 5)).toBe(true)
    expect(clearCovers(range, 'https://a/', 'a', now - 11)).toBe(false)
    const page = { ...range, from: 0, url: 'https://a/' }
    expect(clearCovers(page, 'https://b/', 'b', now)).toBe(false)
    const site = { ...range, from: 0, site: 'flock.test' }
    expect(clearCovers(site, 'https://x.flock.test/', 'x.flock.test', 1)).toBe(true)
  })

  it('validates clear records from other machines', () => {
    expect(isHistoryClear({ id: 'a', at: 1, from: 0, to: 1 })).toBe(true)
    expect(isHistoryClear({ id: 'a', at: 1, from: 2, to: 1 })).toBe(false)
    expect(isHistoryClear({ id: '', at: 1, from: 0, to: 1 })).toBe(false)
    expect(isHistoryClear({ id: 'a', at: 1, from: 0, to: 1, site: '../x' })).toBe(false)
    expect(isHistoryClear({ id: 'a', at: -1, from: 0, to: 1 })).toBe(false)
  })

  it('accepts real host names, ports and IPv6 as sites, nothing else', () => {
    for (const site of ['youtube.com', 'a_b.test', '127.0.0.1:8080', '[::1]:3000', 'localhost'])
      expect(isSite(site)).toBe(true)
    for (const site of [
      'a..b',
      '-a.com',
      'a-.com',
      'a.com.',
      '.a.com',
      'a.com:',
      'A.com',
      '../x',
      '',
    ])
      expect(isSite(site)).toBe(false)
  })
})

describe('history page requests', () => {
  it('accepts the page ops and refuses bad shapes', () => {
    expect(isHistoryRequest({ op: 'rows', query: 'wool' })).toBe(true)
    expect(
      isHistoryRequest({ op: 'rows', query: '', site: 'a.test', before: { time: 5, id: 2 } }),
    ).toBe(true)
    expect(isHistoryRequest({ op: 'rows', query: '', limit: 10_000 })).toBe(false)
    expect(isHistoryRequest({ op: 'delete', items: [{ url: 'https://a/', from: 0, to: 9 }] })).toBe(
      true,
    )
    expect(isHistoryRequest({ op: 'delete', items: [{ url: 'https://a/', from: 9, to: 0 }] })).toBe(
      false,
    )
    expect(
      isHistoryRequest({ op: 'delete', items: [{ url: 'javascript:1', from: 0, to: 9 }] }),
    ).toBe(false)
    expect(isHistoryRequest({ op: 'deleteSite', site: 'a.test', siteData: true })).toBe(true)
    expect(
      isHistoryRequest({
        op: 'clear',
        range: 'hour',
        history: true,
        cookies: false,
        cache: false,
        downloads: true,
      }),
    ).toBe(true)
    expect(
      isHistoryRequest({
        op: 'clear',
        range: 'year',
        history: true,
        cookies: false,
        cache: false,
        downloads: true,
      }),
    ).toBe(false)
    expect(isHistoryRequest({ op: 'keep', days: 90 })).toBe(true)
    expect(isHistoryRequest({ op: 'keep', days: 7 })).toBe(false)
    expect(isHistoryRequest({ op: 'drop' })).toBe(false)
  })

  it('reads site: out of a search', () => {
    expect(parseHistoryQuery('sheep site:www.Wikipedia.org wool')).toEqual({
      query: 'sheep wool',
      site: 'wikipedia.org',
    })
    expect(parseHistoryQuery('  ')).toEqual({ query: '', site: undefined })
  })
})

describe('tabs from other computers', () => {
  const machines: RemoteMachine[] = [
    {
      machine: 'kosmos',
      savedAt: now,
      windows: [
        {
          workspaces: [
            {
              name: 'Wool',
              color: 'violet',
              tabs: [
                { url: 'https://wool.test/sheep', title: 'Sheep wool', pinned: false },
                { url: 'https://other.test/', title: 'Other', pinned: true },
              ],
            },
          ],
        },
      ],
    },
  ]

  it('accepts a 16-hex machine id in a tabs file and refuses others', () => {
    const file = { version: 1, machine: 'kosmos', savedAt: now, windows: [] }
    expect(isRemoteTabsFile({ ...file, id: '0123456789abcdef' })).toBe(true)
    expect(isRemoteTabsFile({ ...file, id: '../x' })).toBe(false)
  })

  it('validates a tabs file', () => {
    expect(isRemoteTabsFile({ version: 1, machine: 'kosmos', savedAt: now, ...machines[0] })).toBe(
      true,
    )
    expect(
      isRemoteTabsFile({
        version: 1,
        machine: 'x',
        savedAt: now,
        windows: [
          { workspaces: [{ name: 'a', color: null, tabs: [{ url: 'javascript:1', title: '' }] }] },
        ],
      }),
    ).toBe(false)
  })

  it('searches tabs by every word', () => {
    expect(searchRemoteTabs(machines, 'sheep WOOL', 5)).toEqual([
      { machine: 'kosmos', workspace: 'Wool', url: 'https://wool.test/sheep', title: 'Sheep wool' },
    ])
    expect(searchRemoteTabs(machines, '', 1)).toHaveLength(1)
  })
})
