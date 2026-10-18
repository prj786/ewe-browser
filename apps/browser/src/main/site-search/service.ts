import type { Session, WebContents } from 'electron'
import {
  bareHost,
  fillSiteTemplate,
  flattenBookmarks,
  parseSiteQuery,
  type BookmarkFolder,
  type SearchEngineId,
  type SiteResolution,
} from '@ewe/shared'
import { systemSiteLocale } from './locale'
import {
  OPENSEARCH_LINK_SCRIPT,
  OPENSEARCH_MAX_BYTES,
  acceptDescriptor,
  acceptTemplate,
  parseOpenSearch,
  type SiteSearchStore,
} from './opensearch'
import { resolveSite, type SiteHistoryEntry, type SiteSources } from './resolve'

const DISCOVERY_WORLD = 1011
const FETCH_TIMEOUT_MS = 8000
const CHECKED_MAX = 5000

export interface SiteSearchDeps {
  store: SiteSearchStore
  history(): Iterable<SiteHistoryEntry>
  bookmarks(): BookmarkFolder
  engine(): SearchEngineId
}

export function sourcesOf(deps: SiteSearchDeps): SiteSources {
  return {
    history: () => deps.history(),
    bookmarks: () => flattenBookmarks(deps.bookmarks()).map((h) => h.item.url),
    opensearch: () => deps.store.entries(),
    locale: systemSiteLocale(),
    engine: deps.engine(),
  }
}

export async function fetchCapped(
  session: Session,
  url: string,
  max = OPENSEARCH_MAX_BYTES,
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await session.fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    })
    if (!response.ok || response.body === null) return null
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > max) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export class SiteSearchService {
  private readonly deps: SiteSearchDeps
  private readonly checked = new Set<string>()

  constructor(deps: SiteSearchDeps) {
    this.deps = deps
  }

  resolve(input: string): SiteResolution {
    return resolveSite(input, sourcesOf(this.deps))
  }

  url(template: string, query: string): string {
    return fillSiteTemplate(template, query, systemSiteLocale())
  }

  rewrite(input: string): string | null {
    const parsed = parseSiteQuery(input)
    if (parsed === null) return null
    const found = this.resolve(parsed.site)
    if (!found.ok) return null
    if (parsed.query === '') return `https://${found.host}/`
    return this.url(found.template, parsed.query)
  }

  watch(contents: WebContents): void {
    contents.on('did-finish-load', () => void this.discover(contents))
  }

  private async discover(contents: WebContents): Promise<void> {
    if (contents.isDestroyed()) return
    let host: string
    try {
      const url = new URL(contents.getURL())
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return
      host = bareHost(url.hostname)
    } catch {
      return
    }
    if (host === '' || this.checked.has(host) || this.deps.store.fresh(host)) return
    if (this.checked.size >= CHECKED_MAX) this.checked.clear()
    this.checked.add(host)
    const href: unknown = await contents
      .executeJavaScriptInIsolatedWorld(DISCOVERY_WORLD, [{ code: OPENSEARCH_LINK_SCRIPT }])
      .catch(() => null)
    if (typeof href !== 'string' || !acceptDescriptor(host, href) || contents.isDestroyed()) return
    const xml = await fetchCapped(contents.session, href)
    if (xml === null) return
    const template = parseOpenSearch(xml)
    if (template === null || !acceptTemplate(host, template)) return
    this.deps.store.put(host, template, href)
  }
}
