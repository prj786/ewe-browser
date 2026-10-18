import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  countryOfZone,
  localeOfEnv,
  parseZoneTable,
  siteLocaleOf,
} from '../../src/main/site-search/locale'
import {
  OPENSEARCH_MAX_HOSTS,
  SiteSearchStore,
  acceptDescriptor,
  acceptTemplate,
  parseOpenSearch,
} from '../../src/main/site-search/opensearch'
import {
  filterTemplate,
  historyTemplate,
  hostFromHistory,
  resolveSite,
  type SiteHistoryEntry,
  type SiteSources,
} from '../../src/main/site-search/resolve'

const ZONES = `# tzdb timezone descriptions
#codes	coordinates	TZ	comments
GE	+4143+04449	Asia/Tbilisi
AE,OM,RE,SC,TF	+2518+05518	Asia/Dubai	Crozet
DE,DK,NO,SE,SJ	+5230+01322	Europe/Berlin	most of Germany
`
const LEGACY = `NO	+5955+01045	Europe/Oslo
`

const entry = (url: string, count: number, last: number): SiteHistoryEntry => ({
  url,
  host: new URL(url).host.replace(/^www\./, ''),
  count,
  last,
})

function sources(
  history: SiteHistoryEntry[] = [],
  opensearch: [string, { template: string; checked: number }][] = [],
  bookmarks: string[] = [],
): SiteSources {
  return {
    history: () => history,
    bookmarks: () => bookmarks,
    opensearch: () => opensearch,
    locale: { cc: 'ge', lang: 'en' },
    engine: 'google',
  }
}

describe('the locale for {cc} and {lang}', () => {
  it('reads the country of the time zone from zone1970.tab, then zone.tab', () => {
    expect(parseZoneTable(ZONES).get('Asia/Dubai')).toBe('ae')
    expect(countryOfZone('Asia/Tbilisi', [ZONES])).toBe('ge')
    expect(countryOfZone('Europe/Oslo', [ZONES, LEGACY])).toBe('no')
    expect(countryOfZone('Mars/Base', [ZONES, LEGACY])).toBeNull()
  })

  it('falls back to the LANG territory, then us; the language comes from LANG, else en', () => {
    expect(localeOfEnv({ LANG: 'en_US.UTF-8' })).toEqual({ lang: 'en', territory: 'us' })
    expect(localeOfEnv({ LANG: 'C.UTF-8' })).toEqual({ lang: null, territory: null })
    expect(localeOfEnv({ LANG: 'POSIX' })).toEqual({ lang: null, territory: null })
    expect(localeOfEnv({ LANG: 'de_DE@euro' })).toEqual({ lang: 'de', territory: 'de' })
    expect(localeOfEnv({ LANG: 'fr' })).toEqual({ lang: 'fr', territory: null })
    expect(localeOfEnv({ LC_ALL: 'ka_GE.UTF-8', LANG: 'en_US.UTF-8' })).toEqual({
      lang: 'ka',
      territory: 'ge',
    })
    expect(
      siteLocaleOf({ env: { LANG: 'en_US.UTF-8' }, zone: 'Asia/Tbilisi', tables: [ZONES] }),
    ).toEqual({
      cc: 'ge',
      lang: 'en',
    })
    expect(
      siteLocaleOf({ env: { LANG: 'de_AT.UTF-8' }, zone: 'Mars/Base', tables: [ZONES] }),
    ).toEqual({
      cc: 'at',
      lang: 'de',
    })
    expect(siteLocaleOf({ env: {}, zone: null, tables: [] })).toEqual({ cc: 'us', lang: 'en' })
  })

  it('reads this machine’s real zone table when it is there', () => {
    const path = '/usr/share/zoneinfo/zone1970.tab'
    if (!existsSync(path)) return
    expect(countryOfZone('Asia/Tbilisi', [readFileSync(path, 'utf8')])).toBe('ge')
  })
})

describe('OpenSearch descriptions', () => {
  it('takes the text/html Url template and turns {searchTerms} into {q}', () => {
    const xml = `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Flock</ShortName>
  <Url type="application/x-suggestions+json" template="https://flock.example/suggest?q={searchTerms}"/>
  <Url type="text/html" method="get" template="https://flock.example/search?q={searchTerms}&amp;lang={language}&amp;page={startPage?}&amp;src=os"/>
</OpenSearchDescription>`
    expect(parseOpenSearch(xml)).toBe('https://flock.example/search?q={q}&lang=*&src=os')
  })

  it('reads Param children, path templates and namespaced elements', () => {
    expect(
      parseOpenSearch(`<os:OpenSearchDescription xmlns:os="http://a9.com/-/spec/opensearch/1.1/">
        <os:Url type="text/html" template="https://wool.example/find">
          <os:Param name="term" value="{searchTerms}"/>
          <os:Param name="from" value="opensearch"/>
        </os:Url></os:OpenSearchDescription>`),
    ).toBe('https://wool.example/find?term={q}&from=opensearch')
    expect(
      parseOpenSearch(
        '<Url type="text/html" template="https://lamb.example/search/{searchTerms}/"/>',
      ),
    ).toBe('https://lamb.example/search/{q}/')
  })

  it('refuses POST, suggestion-only, unknown required parameters and other schemes', () => {
    expect(
      parseOpenSearch(
        '<Url type="text/html" method="post" template="https://x.example/s?q={searchTerms}"/>',
      ),
    ).toBeNull()
    expect(
      parseOpenSearch(
        '<Url type="text/html" template="https://x.example/s?q={searchTerms}&amp;k={secret}"/>',
      ),
    ).toBeNull()
    expect(
      parseOpenSearch(
        '<Url type="text/html" rel="suggestions" template="https://x.example/s?q={searchTerms}"/>',
      ),
    ).toBeNull()
    expect(
      parseOpenSearch('<Url type="text/html" template="javascript:alert({searchTerms})"/>'),
    ).toBeNull()
    expect(parseOpenSearch('<Url type="text/html" template="https://x.example/home"/>')).toBeNull()
    expect(parseOpenSearch('not xml at all')).toBeNull()
  })

  it('keeps 500 hosts at most in site-search.json and reloads them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-site-search-'))
    const store = new SiteSearchStore(dir)
    await store.load()
    for (let i = 0; i <= OPENSEARCH_MAX_HOSTS; i++)
      store.put(
        `www.h${i}.example`,
        `https://h${i}.example/s?q={q}`,
        `https://h${i}.example/os.xml`,
        i,
      )
    expect(store.entries()).toHaveLength(OPENSEARCH_MAX_HOSTS)
    expect(store.get('h0.example')).toBeUndefined()
    expect(store.get(`h${OPENSEARCH_MAX_HOSTS}.example`)?.template).toContain('{q}')
    expect(store.fresh(`h${OPENSEARCH_MAX_HOSTS}.example`, OPENSEARCH_MAX_HOSTS + 1000)).toBe(true)
    expect(store.fresh('h1.example', 40 * 86_400_000)).toBe(false)
    await store.flush()
    const again = new SiteSearchStore(dir)
    await again.load()
    expect(again.entries()).toHaveLength(OPENSEARCH_MAX_HOSTS)
  })
})

describe('resolving a site for search --site', () => {
  it('uses the table, with the locale filled in, when nothing better is known', () => {
    expect(resolveSite('zara', sources())).toEqual({
      ok: true,
      name: 'Zara',
      host: 'zara.com',
      template: 'https://www.zara.com/ge/en/search?searchTerm={q}',
      via: 'table',
    })
    expect(resolveSite('H&M', sources())).toMatchObject({ name: 'H&M', via: 'table' })
  })

  it('prefers the newest search url from history, then an OpenSearch description', () => {
    const history = [
      entry('https://www.zara.com/ge/en/search?searchTerm=jeans&section=MAN', 1, 10),
      entry('https://www.zara.com/ge/en/woman-shoes-l1251.html', 4, 30),
      entry('https://www.zara.com/ge/ka/search?searchTerm=coat', 1, 20),
    ]
    expect(resolveSite('zara', sources(history))).toMatchObject({
      template: 'https://www.zara.com/ge/ka/search?searchTerm={q}',
      via: 'history',
    })
    const described: [string, { template: string; checked: number }][] = [
      ['www.zara.com', { template: 'https://www.zara.com/os?q={q}', checked: 1 }],
    ]
    expect(resolveSite('zara.com', sources([], described))).toMatchObject({
      name: 'Zara',
      template: 'https://www.zara.com/os?q={q}',
      via: 'opensearch',
    })
  })

  it('finds visited sites by the first label of their domain, most visited first', () => {
    const history = [
      entry('https://www.myauto.ge/en/', 12, 5),
      entry('https://myauto.example/', 2, 50),
      entry('https://www.myauto.ge/en/s/?q=prius', 1, 6),
    ]
    expect(hostFromHistory('myauto', sources(history))).toBe('myauto.ge')
    expect(resolveSite('MyAuto', sources(history))).toEqual({
      ok: true,
      name: 'myauto.ge',
      host: 'myauto.ge',
      template: 'https://www.myauto.ge/en/s/?q={q}',
      via: 'history',
    })
    expect(
      resolveSite('flockshop', sources([], [], ['https://flockshop.example/a'])),
    ).toMatchObject({
      host: 'flockshop.example',
      via: 'filter',
    })
  })

  it('falls back to a site: search for a known host and fails for unknown words', () => {
    expect(resolveSite('ss.ge', sources())).toEqual({
      ok: true,
      name: 'ss.ge',
      host: 'ss.ge',
      template: filterTemplate('ss.ge', 'google'),
      via: 'filter',
    })
    expect(filterTemplate('ss.ge', 'duckduckgo')).toBe(
      'https://duckduckgo.com/?q=site%3Ass.ge%20{q}',
    )
    expect(resolveSite('nowhere', sources())).toMatchObject({ ok: false, error: 'unknown-site' })
    expect(resolveSite('', sources())).toMatchObject({ ok: false, error: 'unknown-site' })
  })

  it('keeps subdomain sites apart from their parent domain', () => {
    const history = [entry('https://www.youtube.com/results?search_query=sheep', 2, 9)]
    expect(historyTemplate('music.youtube.com', sources(history))).toBeNull()
    expect(resolveSite('youtube music', sources(history))).toMatchObject({ via: 'table' })
    expect(resolveSite('youtube', sources(history))).toMatchObject({ via: 'history' })
  })

  it('learns only https search urls, and only on sites visited more than once', () => {
    expect(
      historyTemplate('plain.example', sources([entry('http://plain.example/s?q=wool', 5, 1)])),
    ).toBeNull()
    expect(
      historyTemplate('once.example', sources([entry('https://once.example/s?q=wool', 1, 1)])),
    ).toBeNull()
    expect(
      historyTemplate(
        'once.example',
        sources([
          entry('https://once.example/s?q=wool', 1, 1),
          entry('https://once.example/about', 1, 2),
        ]),
      ),
    ).toBe('https://once.example/s?q={q}')
  })

  it('uses an OpenSearch template of the exact host first and never one of another tenant', () => {
    const stored: [string, { template: string; checked: number }][] = [
      ['news.flock.example', { template: 'https://news.flock.example/s?q={q}', checked: 9 }],
      ['flock.example', { template: 'https://flock.example/find?q={q}', checked: 1 }],
      ['alice.github.io', { template: 'https://alice.github.io/s?q={q}', checked: 5 }],
    ]
    expect(resolveSite('flock.example', sources([], stored))).toMatchObject({
      template: 'https://flock.example/find?q={q}',
      via: 'opensearch',
    })
    expect(resolveSite('github.io', sources([], stored))).toMatchObject({ via: 'filter' })
    expect(resolveSite('bob.github.io', sources([], stored))).toMatchObject({ via: 'filter' })
  })
})

describe('accepting an OpenSearch description', () => {
  it('fetches only https descriptors on the page’s own site, never local addresses', () => {
    expect(acceptDescriptor('www.flock.example', 'https://flock.example/os.xml')).toBe(true)
    expect(acceptDescriptor('flock.example', 'https://cdn.flock.example/os.xml')).toBe(true)
    expect(acceptDescriptor('flock.example', 'http://flock.example/os.xml')).toBe(false)
    expect(acceptDescriptor('flock.example', 'https://evil.example/os.xml')).toBe(false)
    expect(acceptDescriptor('alice.github.io', 'https://bob.github.io/os.xml')).toBe(false)
    expect(acceptDescriptor('flock.example', 'https://127.0.0.1/os.xml')).toBe(false)
    expect(acceptDescriptor('flock.example', 'https://192.168.1.1/os.xml')).toBe(false)
    expect(acceptDescriptor('flock.example', 'https://flock.example:8443/os.xml')).toBe(false)
    expect(acceptDescriptor('flock.example', 'https://u:p@flock.example/os.xml')).toBe(false)
    expect(acceptDescriptor('localhost', 'https://localhost/os.xml')).toBe(false)
    expect(acceptDescriptor('flock.example', 'file:///etc/passwd')).toBe(false)
  })

  it('keeps only https templates on the page’s own host (or its www.), 2 KiB at most', () => {
    expect(acceptTemplate('flock.example', 'https://www.flock.example/s?q={q}')).toBe(true)
    expect(acceptTemplate('www.flock.example', 'https://flock.example/s?q={q}')).toBe(true)
    expect(acceptTemplate('flock.example', 'https://search.flock.example/s?q={q}')).toBe(false)
    expect(acceptTemplate('alice.github.io', 'https://bob.github.io/s?q={q}')).toBe(false)
    expect(acceptTemplate('flock.example', 'http://flock.example/s?q={q}')).toBe(false)
    expect(
      acceptTemplate('flock.example', `https://flock.example/s?q={q}&x=${'a'.repeat(2100)}`),
    ).toBe(false)
  })

  it('does not throw on out-of-range character references and refuses http templates', () => {
    expect(
      parseOpenSearch(
        '<Url type="text/html" template="https://x.example/s?q={searchTerms}&amp;a=&#x110000;"/>',
      ),
    ).toMatch(/^https:\/\/x\.example\/s\?q=\{q\}/)
    expect(
      parseOpenSearch('<Url type="text/html" template="http://x.example/s?q={searchTerms}"/>'),
    ).toBeNull()
  })

  it('forgets descriptors learned in a cleared time range', async () => {
    const store = new SiteSearchStore(mkdtempSync(join(tmpdir(), 'ewe-site-search-clear-')))
    await store.load()
    store.put('a.example', 'https://a.example/s?q={q}', 'https://a.example/os.xml', 100)
    store.put('b.example', 'https://b.example/s?q={q}', 'https://b.example/os.xml', 500)
    expect(store.clearRange(400, 600)).toBe(1)
    expect(store.entries().map(([host]) => host)).toEqual(['a.example'])
    expect(store.clearRange(0, 1000)).toBe(1)
    expect(store.entries()).toEqual([])
  })
})
