import { getDomain } from 'tldts'

export interface Site {
  scheme: 'http' | 'https'
  host: string
  port: string
  explicitPort: boolean
  domain: string | null
}

export type SiteMatch = 'exact' | 'domain'

const DEFAULT_PORTS: Record<Site['scheme'], string> = { http: '80', https: '443' }

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')
}

export function siteOf(input: string): Site | null {
  const text = input.trim()
  if (text === '') return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  const scheme = url.protocol === 'https:' ? 'https' : url.protocol === 'http:' ? 'http' : null
  if (scheme === null) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === '') return null
  const port = url.port === '' ? DEFAULT_PORTS[scheme] : url.port
  const domain = isIp(host)
    ? null
    : getDomain(host, { allowPrivateDomains: true, validateHostname: true })
  return { scheme, host, port, explicitPort: url.port !== '', domain }
}

export function matchSite(page: Site, itemUrl: string): SiteMatch | null {
  const item = siteOf(itemUrl)
  if (item === null) return null
  if (item.scheme === 'https' && page.scheme !== 'https') return null
  const portOk = item.explicitPort
    ? item.port === page.port
    : page.port === DEFAULT_PORTS[page.scheme]
  if (!portOk) return null
  const bare = (h: string) => (h.startsWith('www.') ? h.slice(4) : h)
  if (bare(item.host) === bare(page.host)) return 'exact'
  if (item.domain !== null && item.domain === page.domain) return 'domain'
  return null
}

export interface Matchable {
  title: string
  username?: string | undefined
  urls: string[]
}

export function matchLogins<T extends Matchable>(
  page: Site,
  items: readonly T[],
): (T & { match: SiteMatch })[] {
  const out: (T & { match: SiteMatch })[] = []
  for (const item of items) {
    let best: SiteMatch | null = null
    for (const url of item.urls) {
      const m = matchSite(page, url)
      if (m === 'exact') {
        best = 'exact'
        break
      }
      if (m === 'domain') best = 'domain'
    }
    if (best !== null) out.push({ ...item, match: best })
  }
  const rank = (m: SiteMatch) => (m === 'exact' ? 0 : 1)
  return out.sort(
    (a, b) =>
      rank(a.match) - rank(b.match) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
      (a.username ?? '').localeCompare(b.username ?? '', undefined, { sensitivity: 'base' }),
  )
}

export function displayHost(site: Site): string {
  const host = site.host.startsWith('www.') ? site.host.slice(4) : site.host
  return site.port === DEFAULT_PORTS[site.scheme] ? host : `${host}:${site.port}`
}
