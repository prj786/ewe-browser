export type SiteGroup =
  'shop' | 'video' | 'music' | 'social' | 'dev' | 'reference' | 'maps' | 'travel'

export interface SiteEntry {
  name: string
  aliases: string[]
  host: string
  template: string
  group: SiteGroup
}

export interface SiteLocale {
  cc: string
  lang: string
}

export type SiteVia = 'history' | 'opensearch' | 'table' | 'filter'

export type SiteResolution =
  | { ok: true; name: string; host: string; template: string; via: SiteVia }
  | { ok: false; error: 'unknown-site'; message: string }

export const SITES: readonly SiteEntry[] = [
  {
    name: 'Zara',
    aliases: [],
    host: 'zara.com',
    template: 'https://www.zara.com/{cc}/{lang}/search?searchTerm={q}',
    group: 'shop',
  },
  {
    name: 'H&M',
    aliases: ['hm', 'h and m', 'hennes'],
    host: 'hm.com',
    template: 'https://www2.hm.com/en_us/search-results.html?q={q}',
    group: 'shop',
  },
  {
    name: 'Amazon',
    aliases: [],
    host: 'amazon.com',
    template: 'https://www.amazon.com/s?k={q}',
    group: 'shop',
  },
  {
    name: 'eBay',
    aliases: [],
    host: 'ebay.com',
    template: 'https://www.ebay.com/sch/i.html?_nkw={q}',
    group: 'shop',
  },
  {
    name: 'AliExpress',
    aliases: ['ali express', 'ali'],
    host: 'aliexpress.com',
    template: 'https://www.aliexpress.com/wholesale?SearchText={q}',
    group: 'shop',
  },
  {
    name: 'Etsy',
    aliases: [],
    host: 'etsy.com',
    template: 'https://www.etsy.com/search?q={q}',
    group: 'shop',
  },
  {
    name: 'IKEA',
    aliases: [],
    host: 'ikea.com',
    template: 'https://www.ikea.com/us/en/search/?q={q}',
    group: 'shop',
  },
  {
    name: 'Walmart',
    aliases: [],
    host: 'walmart.com',
    template: 'https://www.walmart.com/search?q={q}',
    group: 'shop',
  },
  {
    name: 'Target',
    aliases: [],
    host: 'target.com',
    template: 'https://www.target.com/s?searchTerm={q}',
    group: 'shop',
  },
  {
    name: 'Best Buy',
    aliases: ['bestbuy'],
    host: 'bestbuy.com',
    template: 'https://www.bestbuy.com/site/searchpage.jsp?st={q}',
    group: 'shop',
  },
  {
    name: 'Nike',
    aliases: [],
    host: 'nike.com',
    template: 'https://www.nike.com/w?q={q}',
    group: 'shop',
  },
  {
    name: 'Adidas',
    aliases: [],
    host: 'adidas.com',
    template: 'https://www.adidas.com/us/search?q={q}',
    group: 'shop',
  },
  {
    name: 'Uniqlo',
    aliases: [],
    host: 'uniqlo.com',
    template: 'https://www.uniqlo.com/us/en/search?q={q}',
    group: 'shop',
  },
  {
    name: 'Temu',
    aliases: [],
    host: 'temu.com',
    template: 'https://www.temu.com/search_result.html?search_key={q}',
    group: 'shop',
  },
  {
    name: 'ASOS',
    aliases: [],
    host: 'asos.com',
    template: 'https://www.asos.com/search/?q={q}',
    group: 'shop',
  },
  {
    name: 'Newegg',
    aliases: [],
    host: 'newegg.com',
    template: 'https://www.newegg.com/p/pl?d={q}',
    group: 'shop',
  },
  {
    name: 'Steam',
    aliases: ['steam store'],
    host: 'steampowered.com',
    template: 'https://store.steampowered.com/search/?term={q}',
    group: 'shop',
  },
  {
    name: 'YouTube',
    aliases: ['yt'],
    host: 'youtube.com',
    template: 'https://www.youtube.com/results?search_query={q}',
    group: 'video',
  },
  {
    name: 'YouTube Music',
    aliases: ['yt music', 'ytmusic'],
    host: 'music.youtube.com',
    template: 'https://music.youtube.com/search?q={q}',
    group: 'music',
  },
  {
    name: 'Spotify',
    aliases: [],
    host: 'spotify.com',
    template: 'https://open.spotify.com/search/{q}',
    group: 'music',
  },
  {
    name: 'SoundCloud',
    aliases: ['sound cloud'],
    host: 'soundcloud.com',
    template: 'https://soundcloud.com/search?q={q}',
    group: 'music',
  },
  {
    name: 'Bandcamp',
    aliases: [],
    host: 'bandcamp.com',
    template: 'https://bandcamp.com/search?q={q}',
    group: 'music',
  },
  {
    name: 'Genius',
    aliases: ['lyrics'],
    host: 'genius.com',
    template: 'https://genius.com/search?q={q}',
    group: 'music',
  },
  {
    name: 'Netflix',
    aliases: [],
    host: 'netflix.com',
    template: 'https://www.netflix.com/search?q={q}',
    group: 'video',
  },
  {
    name: 'Twitch',
    aliases: [],
    host: 'twitch.tv',
    template: 'https://www.twitch.tv/search?term={q}',
    group: 'video',
  },
  {
    name: 'Vimeo',
    aliases: [],
    host: 'vimeo.com',
    template: 'https://vimeo.com/search?q={q}',
    group: 'video',
  },
  {
    name: 'IMDb',
    aliases: [],
    host: 'imdb.com',
    template: 'https://www.imdb.com/find/?q={q}',
    group: 'video',
  },
  {
    name: 'Letterboxd',
    aliases: [],
    host: 'letterboxd.com',
    template: 'https://letterboxd.com/search/{q}/',
    group: 'video',
  },
  {
    name: 'Reddit',
    aliases: [],
    host: 'reddit.com',
    template: 'https://www.reddit.com/search/?q={q}',
    group: 'social',
  },
  {
    name: 'X',
    aliases: ['twitter'],
    host: 'x.com',
    template: 'https://x.com/search?q={q}',
    group: 'social',
  },
  {
    name: 'Facebook',
    aliases: ['fb'],
    host: 'facebook.com',
    template: 'https://www.facebook.com/search/top?q={q}',
    group: 'social',
  },
  {
    name: 'Instagram',
    aliases: ['insta', 'ig'],
    host: 'instagram.com',
    template: 'https://www.instagram.com/explore/search/keyword/?q={q}',
    group: 'social',
  },
  {
    name: 'LinkedIn',
    aliases: ['linked in'],
    host: 'linkedin.com',
    template: 'https://www.linkedin.com/search/results/all/?keywords={q}',
    group: 'social',
  },
  {
    name: 'TikTok',
    aliases: ['tik tok'],
    host: 'tiktok.com',
    template: 'https://www.tiktok.com/search?q={q}',
    group: 'social',
  },
  {
    name: 'Pinterest',
    aliases: [],
    host: 'pinterest.com',
    template: 'https://www.pinterest.com/search/pins/?q={q}',
    group: 'social',
  },
  {
    name: 'Bluesky',
    aliases: ['bsky'],
    host: 'bsky.app',
    template: 'https://bsky.app/search?q={q}',
    group: 'social',
  },
  {
    name: 'Hacker News',
    aliases: ['hn', 'hackernews'],
    host: 'news.ycombinator.com',
    template: 'https://hn.algolia.com/?q={q}',
    group: 'social',
  },
  {
    name: 'GitHub',
    aliases: ['gh'],
    host: 'github.com',
    template: 'https://github.com/search?q={q}',
    group: 'dev',
  },
  {
    name: 'GitLab',
    aliases: [],
    host: 'gitlab.com',
    template: 'https://gitlab.com/search?search={q}',
    group: 'dev',
  },
  {
    name: 'Stack Overflow',
    aliases: ['stackoverflow', 'so'],
    host: 'stackoverflow.com',
    template: 'https://stackoverflow.com/search?q={q}',
    group: 'dev',
  },
  {
    name: 'Arch Wiki',
    aliases: ['archwiki', 'arch linux wiki'],
    host: 'wiki.archlinux.org',
    template: 'https://wiki.archlinux.org/index.php?search={q}',
    group: 'dev',
  },
  {
    name: 'AUR',
    aliases: ['arch user repository'],
    host: 'aur.archlinux.org',
    template: 'https://aur.archlinux.org/packages?K={q}',
    group: 'dev',
  },
  {
    name: 'Arch packages',
    aliases: ['arch', 'archlinux', 'arch linux', 'pacman'],
    host: 'archlinux.org',
    template: 'https://archlinux.org/packages/?q={q}',
    group: 'dev',
  },
  {
    name: 'npm',
    aliases: [],
    host: 'npmjs.com',
    template: 'https://www.npmjs.com/search?q={q}',
    group: 'dev',
  },
  {
    name: 'crates.io',
    aliases: ['crates', 'cargo'],
    host: 'crates.io',
    template: 'https://crates.io/search?q={q}',
    group: 'dev',
  },
  {
    name: 'PyPI',
    aliases: ['pip'],
    host: 'pypi.org',
    template: 'https://pypi.org/search/?q={q}',
    group: 'dev',
  },
  {
    name: 'MDN',
    aliases: ['mdn web docs', 'mozilla developer'],
    host: 'developer.mozilla.org',
    template: 'https://developer.mozilla.org/en-US/search?q={q}',
    group: 'dev',
  },
  {
    name: 'Docker Hub',
    aliases: ['docker', 'dockerhub'],
    host: 'hub.docker.com',
    template: 'https://hub.docker.com/search?q={q}',
    group: 'dev',
  },
  {
    name: 'Go packages',
    aliases: ['go', 'golang', 'pkg.go.dev'],
    host: 'pkg.go.dev',
    template: 'https://pkg.go.dev/search?q={q}',
    group: 'dev',
  },
  {
    name: 'Docs.rs',
    aliases: ['docsrs', 'rust docs'],
    host: 'docs.rs',
    template: 'https://docs.rs/releases/search?query={q}',
    group: 'dev',
  },
  {
    name: 'Flathub',
    aliases: [],
    host: 'flathub.org',
    template: 'https://flathub.org/apps/search?q={q}',
    group: 'dev',
  },
  {
    name: 'Wikipedia',
    aliases: ['wiki'],
    host: 'wikipedia.org',
    template: 'https://{lang}.wikipedia.org/w/index.php?search={q}',
    group: 'reference',
  },
  {
    name: 'Wiktionary',
    aliases: [],
    host: 'wiktionary.org',
    template: 'https://{lang}.wiktionary.org/w/index.php?search={q}',
    group: 'reference',
  },
  {
    name: 'Internet Archive',
    aliases: ['archive.org', 'archive', 'wayback'],
    host: 'archive.org',
    template: 'https://archive.org/search?query={q}',
    group: 'reference',
  },
  {
    name: 'Goodreads',
    aliases: [],
    host: 'goodreads.com',
    template: 'https://www.goodreads.com/search?q={q}',
    group: 'reference',
  },
  {
    name: 'Wolfram Alpha',
    aliases: ['wolfram', 'wolframalpha'],
    host: 'wolframalpha.com',
    template: 'https://www.wolframalpha.com/input?i={q}',
    group: 'reference',
  },
  {
    name: 'Google',
    aliases: [],
    host: 'google.com',
    template: 'https://www.google.com/search?q={q}',
    group: 'reference',
  },
  {
    name: 'Google Images',
    aliases: ['images'],
    host: 'images.google.com',
    template: 'https://www.google.com/search?udm=2&q={q}',
    group: 'reference',
  },
  {
    name: 'Google Scholar',
    aliases: ['scholar'],
    host: 'scholar.google.com',
    template: 'https://scholar.google.com/scholar?q={q}',
    group: 'reference',
  },
  {
    name: 'Google Translate',
    aliases: ['translate'],
    host: 'translate.google.com',
    template: 'https://translate.google.com/?sl=auto&text={q}',
    group: 'reference',
  },
  {
    name: 'DuckDuckGo',
    aliases: ['ddg', 'duck duck go'],
    host: 'duckduckgo.com',
    template: 'https://duckduckgo.com/?q={q}',
    group: 'reference',
  },
  {
    name: 'Bing',
    aliases: [],
    host: 'bing.com',
    template: 'https://www.bing.com/search?q={q}',
    group: 'reference',
  },
  {
    name: 'Google Maps',
    aliases: ['maps', 'gmaps'],
    host: 'maps.google.com',
    template: 'https://www.google.com/maps/search/{q}',
    group: 'maps',
  },
  {
    name: 'OpenStreetMap',
    aliases: ['osm', 'open street map'],
    host: 'openstreetmap.org',
    template: 'https://www.openstreetmap.org/search?query={q}',
    group: 'maps',
  },
  {
    name: 'Booking.com',
    aliases: ['booking'],
    host: 'booking.com',
    template: 'https://www.booking.com/searchresults.html?ss={q}',
    group: 'travel',
  },
  {
    name: 'Tripadvisor',
    aliases: ['trip advisor'],
    host: 'tripadvisor.com',
    template: 'https://www.tripadvisor.com/Search?q={q}',
    group: 'travel',
  },
]

export function siteSlug(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function siteByName(text: string): SiteEntry | undefined {
  const slug = siteSlug(text)
  if (slug === '') return undefined
  return SITES.find(
    (s) => siteSlug(s.name) === slug || s.aliases.some((alias) => siteSlug(alias) === slug),
  )
}

export function bareHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '')
}

export function onHost(host: string, site: string): boolean {
  const h = bareHost(host)
  const s = bareHost(site)
  return h === s || h.endsWith(`.${s}`)
}

export function siteByHost(host: string): SiteEntry | undefined {
  let best: SiteEntry | undefined
  for (const site of SITES)
    if (onHost(host, site.host) && (best === undefined || site.host.length > best.host.length))
      best = site
  return best
}

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i

export function domainOf(text: string): string | null {
  const input = text.trim()
  if (input === '' || /\s/.test(input)) return null
  let raw: string
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      const url = new URL(input)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
      raw = url.hostname
    } catch {
      return null
    }
  } else raw = input.split(/[/?#:]/)[0] ?? ''
  const host = bareHost(raw)
  return DOMAIN_RE.test(host) ? host : null
}

export function withLocale(template: string, locale: SiteLocale): string {
  return template
    .replaceAll('{cc}', encodeURIComponent(locale.cc))
    .replaceAll('{lang}', encodeURIComponent(locale.lang))
}

export function fillSiteTemplate(template: string, query: string, locale: SiteLocale): string {
  return withLocale(template, locale).replaceAll('{q}', encodeURIComponent(query))
}

export function parseSiteQuery(input: string): { site: string; query: string } | null {
  const match = /^@(\S+)(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (match === null) return null
  const site = match[1] ?? ''
  if (site === '' || site.startsWith('@')) return null
  return { site, query: (match[2] ?? '').trim() }
}

export const SEARCH_PARAMS = [
  'q',
  'query',
  'search',
  'searchTerm',
  'search_query',
  'k',
  'keyword',
  'keywords',
  'term',
  'text',
  '_nkw',
  'SearchText',
  's',
  'p',
  'w',
  'field-keywords',
  'K',
] as const

const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i

function looksLikeTerm(value: string): boolean {
  const text = value.trim()
  if (text === '' || text.length > 200) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return false
  return /\p{L}/u.test(text)
}

export function learnSearchTemplate(raw: string): { template: string; term: string } | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const base = `${url.protocol}//${url.host}${url.pathname}`
  for (const name of SEARCH_PARAMS) {
    const value = url.searchParams.get(name)
    if (value !== null && looksLikeTerm(value))
      return { template: `${base}?${encodeURIComponent(name)}={q}`, term: value.trim() }
  }
  const segments = url.pathname.split('/').slice(1)
  const at =
    segments[0] === 'search'
      ? 0
      : LOCALE_SEGMENT.test(segments[0] ?? '') && segments[1] === 'search'
        ? 1
        : -1
  if (at < 0) return null
  const rest = segments.slice(at + 1)
  if (rest.length === 0 || rest.length > 2 || (rest.length === 2 && rest[1] !== '')) return null
  let term: string
  try {
    term = decodeURIComponent(rest[0] ?? '').replace(/\+/g, ' ')
  } catch {
    return null
  }
  if (!looksLikeTerm(term)) return null
  const prefix = segments.slice(0, at + 1).join('/')
  const slash = rest.length === 2 ? '/' : ''
  return { template: `${url.protocol}//${url.host}/${prefix}/{q}${slash}`, term: term.trim() }
}
