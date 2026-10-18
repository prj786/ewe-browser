import { getDomain } from 'tldts'
import {
  SEARCH_ENGINES,
  bareHost,
  domainOf,
  fillSiteTemplate,
  learnSearchTemplate,
  onHost,
  siteByHost,
  siteByName,
  siteSlug,
  withLocale,
  type SearchEngineId,
  type SiteEntry,
  type SiteLocale,
  type SiteResolution,
} from '@ewe/shared'
import { tenantOf } from './opensearch'

export interface SiteHistoryEntry {
  url: string
  host: string
  count: number
  last: number
}

export interface SiteSources {
  history(): Iterable<SiteHistoryEntry>
  bookmarks(): Iterable<string>
  opensearch(): Iterable<[string, { template: string; checked: number }]>
  locale: SiteLocale
  engine: SearchEngineId
}

export function registrable(host: string): string {
  const bare = bareHost(host)
  return getDomain(bare, { allowPrivateDomains: false }) ?? bare
}

function hostOfUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? bareHost(u.hostname) : null
  } catch {
    return null
  }
}

export function hostFromHistory(slug: string, src: SiteSources): string | null {
  if (slug === '') return null
  const score = new Map<string, number>()
  const add = (host: string, n: number) => {
    const domain = registrable(host)
    const label = domain.split('.')[0] ?? ''
    if (siteSlug(label) !== slug) return
    score.set(domain, (score.get(domain) ?? 0) + n)
  }
  for (const entry of src.history()) add(entry.host, Math.max(1, entry.count))
  for (const url of src.bookmarks()) {
    const host = hostOfUrl(url)
    if (host !== null) add(host, 1)
  }
  let best: string | null = null
  let top = 0
  for (const [domain, n] of score)
    if (n > top || (n === top && best !== null && domain < best)) {
      best = domain
      top = n
    }
  return best
}

export const HISTORY_MIN_VISITS = 2

export function historyTemplate(host: string, src: SiteSources): string | null {
  let found: { template: string; last: number } | null = null
  let visits = 0
  for (const entry of src.history()) {
    if (!onHost(entry.host, host)) continue
    visits += Math.max(1, entry.count)
    if (found !== null && entry.last <= found.last) continue
    if (!entry.url.startsWith('https://')) continue
    const learned = learnSearchTemplate(entry.url)
    if (learned !== null) found = { template: learned.template, last: entry.last }
  }
  return visits >= HISTORY_MIN_VISITS ? (found?.template ?? null) : null
}

export function opensearchTemplate(host: string, src: SiteSources): string | null {
  const wanted = bareHost(host)
  const tenant = tenantOf(wanted)
  let exact: string | null = null
  let found: { template: string; checked: number } | null = null
  for (const [stored, entry] of src.opensearch()) {
    if (bareHost(stored) === wanted) exact = entry.template
    if (!onHost(stored, wanted) || tenantOf(stored) !== tenant) continue
    if (found === null || entry.checked > found.checked) found = entry
  }
  return exact ?? found?.template ?? null
}

export function filterTemplate(host: string, engine: SearchEngineId): string {
  return SEARCH_ENGINES[engine].template.replace('%s', `${encodeURIComponent(`site:${host} `)}{q}`)
}

export function resolveSite(input: string, src: SiteSources): SiteResolution {
  const text = input.trim()
  const unknown: SiteResolution = {
    ok: false,
    error: 'unknown-site',
    message: `no site called "${text}" is known`,
  }
  if (text === '') return unknown
  let entry: SiteEntry | undefined = siteByName(text)
  let host: string
  let name: string
  if (entry !== undefined) {
    host = entry.host
    name = entry.name
  } else {
    const domain = domainOf(text) ?? hostFromHistory(siteSlug(text), src)
    if (domain === null) return unknown
    host = domain
    const known = siteByHost(domain)
    entry = known !== undefined && bareHost(known.host) === bareHost(domain) ? known : undefined
    name = entry?.name ?? domain
  }
  const learned = historyTemplate(host, src)
  if (learned !== null) return { ok: true, name, host, template: learned, via: 'history' }
  const described = opensearchTemplate(host, src)
  if (described !== null) return { ok: true, name, host, template: described, via: 'opensearch' }
  if (entry !== undefined)
    return { ok: true, name, host, template: withLocale(entry.template, src.locale), via: 'table' }
  return { ok: true, name, host, template: filterTemplate(host, src.engine), via: 'filter' }
}

export function siteSearchUrl(template: string, query: string, locale: SiteLocale): string {
  return fillSiteTemplate(template, query, locale)
}
