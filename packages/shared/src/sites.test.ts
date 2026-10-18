import { describe, expect, it } from 'vitest'
import {
  SITES,
  domainOf,
  fillSiteTemplate,
  learnSearchTemplate,
  onHost,
  parseSiteQuery,
  siteByHost,
  siteByName,
  siteSlug,
  withLocale,
} from './sites'

const ge = { cc: 'ge', lang: 'en' }
const ELSEWHERE = new Set(['Hacker News', 'Google Maps', 'Google Images'])

describe('the built-in site table', () => {
  it('has about fifty sites with unique names and aliases and a {q} in every template', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(50)
    const slugs = new Map<string, string>()
    for (const site of SITES) {
      for (const word of [site.name, ...site.aliases]) {
        const slug = siteSlug(word)
        expect(slug, word).not.toBe('')
        expect(slugs.get(slug) ?? site.name, `${word} also names another site`).toBe(site.name)
        slugs.set(slug, site.name)
      }
      expect(site.template, site.name).toContain('{q}')
      const url = new URL(fillSiteTemplate(site.template, 'red shoes', ge))
      expect(url.protocol, site.name).toBe('https:')
      if (!ELSEWHERE.has(site.name)) expect(onHost(url.hostname, site.host), site.name).toBe(true)
    }
  })

  it('finds sites by name and alias, ignoring case, spaces and punctuation', () => {
    expect(siteByName('zara')?.host).toBe('zara.com')
    expect(siteByName('H&M')?.name).toBe('H&M')
    expect(siteByName('hm')?.name).toBe('H&M')
    expect(siteByName('h and m')?.name).toBe('H&M')
    expect(siteByName('YouTube Music')?.host).toBe('music.youtube.com')
    expect(siteByName('youtube')?.host).toBe('youtube.com')
    expect(siteByName('Arch Wiki')?.host).toBe('wiki.archlinux.org')
    expect(siteByName('twitter')?.name).toBe('X')
    expect(siteByName('myauto')).toBeUndefined()
    expect(siteByName('  ')).toBeUndefined()
  })

  it('finds the most specific site for a host', () => {
    expect(siteByHost('www.youtube.com')?.name).toBe('YouTube')
    expect(siteByHost('music.youtube.com')?.name).toBe('YouTube Music')
    expect(siteByHost('en.wikipedia.org')?.name).toBe('Wikipedia')
    expect(siteByHost('notzara.com')).toBeUndefined()
  })

  it('fills {cc}, {lang} and {q} (encoded)', () => {
    const zara = siteByName('zara')?.template ?? ''
    expect(fillSiteTemplate(zara, "men's shoes", ge)).toBe(
      "https://www.zara.com/ge/en/search?searchTerm=men's%20shoes",
    )
    expect(withLocale(siteByName('wikipedia')?.template ?? '', { cc: 'de', lang: 'de' })).toBe(
      'https://de.wikipedia.org/w/index.php?search={q}',
    )
    expect(fillSiteTemplate('https://x.example/search/{q}', 'a/b c', ge)).toBe(
      'https://x.example/search/a%2Fb%20c',
    )
  })
})

describe('site words', () => {
  it('reads @site queries from the palette', () => {
    expect(parseSiteQuery('@zara men shoes')).toEqual({ site: 'zara', query: 'men shoes' })
    expect(parseSiteQuery('  @ss.ge  2 room flat ')).toEqual({
      site: 'ss.ge',
      query: '2 room flat',
    })
    expect(parseSiteQuery('@zara')).toEqual({ site: 'zara', query: '' })
    expect(parseSiteQuery('mail@example.com')).toBeNull()
    expect(parseSiteQuery('@ shoes')).toBeNull()
    expect(parseSiteQuery('@@x y')).toBeNull()
  })

  it('takes a domain from a word, a host or a url', () => {
    expect(domainOf('zara.com')).toBe('zara.com')
    expect(domainOf('www.ss.ge')).toBe('ss.ge')
    expect(domainOf('https://www.myauto.ge/en/')).toBe('myauto.ge')
    expect(domainOf('ss.ge/en/search')).toBe('ss.ge')
    expect(domainOf('zara')).toBeNull()
    expect(domainOf('men shoes')).toBeNull()
    expect(domainOf('ftp://x.org')).toBeNull()
  })
})

describe('learning a search url from history', () => {
  it('keeps scheme, host, path and only the term parameter', () => {
    expect(
      learnSearchTemplate('https://www.zara.com/ge/en/search?searchTerm=jeans&section=MAN'),
    ).toEqual({ template: 'https://www.zara.com/ge/en/search?searchTerm={q}', term: 'jeans' })
    expect(learnSearchTemplate('https://www.amazon.com/s?k=wool+socks&ref=nb_sb')).toEqual({
      template: 'https://www.amazon.com/s?k={q}',
      term: 'wool socks',
    })
    expect(
      learnSearchTemplate('https://www.youtube.com/results?search_query=sheep')?.template,
    ).toBe('https://www.youtube.com/results?search_query={q}')
    expect(learnSearchTemplate('https://aur.archlinux.org/packages?O=0&K=yay')?.template).toBe(
      'https://aur.archlinux.org/packages?K={q}',
    )
    expect(
      learnSearchTemplate('https://www.ebay.com/sch/i.html?_nkw=lamb&_sacat=0')?.template,
    ).toBe('https://www.ebay.com/sch/i.html?_nkw={q}')
    expect(
      learnSearchTemplate('https://www.aliexpress.com/wholesale?SearchText=wool')?.template,
    ).toBe('https://www.aliexpress.com/wholesale?SearchText={q}')
  })

  it('prefers q over other names and reads /search/<term> paths', () => {
    expect(learnSearchTemplate('https://shop.example/find?s=price&q=boots')?.template).toBe(
      'https://shop.example/find?q={q}',
    )
    expect(learnSearchTemplate('https://letterboxd.com/search/heat/')).toEqual({
      template: 'https://letterboxd.com/search/{q}/',
      term: 'heat',
    })
    expect(learnSearchTemplate('https://shop.example/en/search/red%20boots')).toEqual({
      template: 'https://shop.example/en/search/{q}',
      term: 'red boots',
    })
  })

  it('does not mistake ids, urls, maps paths or plain pages for searches', () => {
    expect(learnSearchTemplate('https://blog.example/?p=1234')).toBeNull()
    expect(learnSearchTemplate('https://x.example/login?q=https://y.example/')).toBeNull()
    expect(learnSearchTemplate('https://www.google.com/maps/search/cafe')).toBeNull()
    expect(learnSearchTemplate('https://shop.example/search/a/b')).toBeNull()
    expect(learnSearchTemplate('https://shop.example/products/jeans')).toBeNull()
    expect(learnSearchTemplate('https://shop.example/search?q=')).toBeNull()
    expect(learnSearchTemplate('app://home/')).toBeNull()
  })
})
