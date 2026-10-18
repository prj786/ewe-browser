import { join } from 'node:path'
import { getDomain } from 'tldts'
import { bareHost } from '@ewe/shared'
import { isLocalHost } from '../privacy/https-only'
import { debounce, readJson, writeJsonAtomic } from '../storage/json-file'

export const OPENSEARCH_MAX_BYTES = 64 * 1024
export const OPENSEARCH_MAX_HOSTS = 500
export const OPENSEARCH_REFRESH_MS = 30 * 86_400_000
export const OPENSEARCH_TEMPLATE_MAX = 2048

export const OPENSEARCH_LINK_SCRIPT = `(() => {
  const link = document.querySelector('link[rel~="search" i][type="application/opensearchdescription+xml" i][href]')
  return link ? link.href : null
})()`

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
    out.set((m[1] ?? '').toLowerCase().replace(/^.*:/, ''), decodeXml(m[3] ?? m[4] ?? ''))
  return out
}

const FIXED: Record<string, string> = {
  inputEncoding: 'UTF-8',
  outputEncoding: 'UTF-8',
  language: '*',
  count: '20',
  startIndex: '1',
  startPage: '1',
}

function convertTemplate(raw: string): string | null {
  if (raw.length > OPENSEARCH_TEMPLATE_MAX) return null
  let url: URL
  try {
    url = new URL(
      raw.replace(/\{([^}]*)\}/g, (_w, name: string) => `__ewe_${encodeURIComponent(name)}__`),
    )
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const keep = new URLSearchParams()
  let hasTerm = false
  for (const [key, value] of url.searchParams) {
    const name = /^__ewe_(.*)__$/.exec(value)?.[1]
    if (name === undefined) {
      keep.append(key, value)
      continue
    }
    const decoded = decodeURIComponent(name)
    if (decoded === 'searchTerms') {
      keep.append(key, '__ewe_q__')
      hasTerm = true
    } else if (decoded.endsWith('?')) continue
    else if (Object.hasOwn(FIXED, decoded)) keep.append(key, FIXED[decoded] ?? '')
    else return null
  }
  const pathTerm = url.pathname.includes('__ewe_searchTerms__')
  if (url.pathname.replace('__ewe_searchTerms__', '').includes('__ewe_')) return null
  if (!hasTerm && !pathTerm) return null
  const query = keep.toString().replace('__ewe_q__', '{q}')
  const path = url.pathname.replace('__ewe_searchTerms__', '{q}')
  return `${url.protocol}//${url.host}${path}${query === '' ? '' : `?${query}`}`
}

export function parseOpenSearch(xml: string): string | null {
  if (xml.length > OPENSEARCH_MAX_BYTES * 2) return null
  for (const m of xml.matchAll(
    /<(?:[\w-]+:)?Url\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:[\w-]+:)?Url>)/gi,
  )) {
    const attrs = attributes(m[1] ?? '')
    const type = (attrs.get('type') ?? '').toLowerCase()
    if (type !== 'text/html' && type !== 'application/xhtml+xml') continue
    const method = (attrs.get('method') ?? 'get').toLowerCase()
    if (method !== 'get') continue
    const rel = (attrs.get('rel') ?? 'results').toLowerCase()
    if (!rel.split(/\s+/).includes('results')) continue
    let template = attrs.get('template') ?? ''
    const params = [...(m[3] ?? '').matchAll(/<(?:[\w-]+:)?Param\b([^>]*?)\/?>/gi)].map((p) =>
      attributes(p[1] ?? ''),
    )
    if (params.length > 0) {
      const extra = params
        .filter((p) => p.has('name') && p.has('value'))
        .map((p) => `${encodeURIComponent(p.get('name') ?? '')}=${p.get('value') ?? ''}`)
        .join('&')
      if (extra !== '') template += `${template.includes('?') ? '&' : '?'}${extra}`
    }
    const converted = convertTemplate(template.trim())
    if (converted !== null) return converted
  }
  return null
}

export function tenantOf(host: string): string {
  const bare = bareHost(host)
  return getDomain(bare, { allowPrivateDomains: true }) ?? bare
}

function safeHttpsHost(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return null
  if (parsed.port !== '' && parsed.port !== '443') return null
  const host = parsed.hostname.toLowerCase()
  return host === '' || isLocalHost(host) ? null : host
}

export function acceptDescriptor(pageHost: string, descriptor: string): boolean {
  const host = safeHttpsHost(descriptor)
  return host !== null && !isLocalHost(pageHost) && tenantOf(host) === tenantOf(pageHost)
}

export function acceptTemplate(pageHost: string, template: string): boolean {
  if (template.length > OPENSEARCH_TEMPLATE_MAX) return false
  const host = safeHttpsHost(template.replaceAll('{q}', 'q'))
  return host !== null && bareHost(host) === bareHost(pageHost)
}

export interface OpenSearchEntry {
  template: string
  descriptor: string
  checked: number
}

interface OpenSearchFile {
  version: 1
  hosts: Record<string, OpenSearchEntry>
}

function isEntry(value: unknown): value is OpenSearchEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.template === 'string' &&
    v.template.includes('{q}') &&
    v.template.startsWith('https://') &&
    v.template.length <= OPENSEARCH_TEMPLATE_MAX &&
    typeof v.descriptor === 'string' &&
    typeof v.checked === 'number' &&
    Number.isFinite(v.checked)
  )
}

function isFile(value: unknown): value is OpenSearchFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === 1 && typeof v.hosts === 'object' && v.hosts !== null
}

export class SiteSearchStore {
  private readonly path: string
  private hosts = new Map<string, OpenSearchEntry>()
  private readonly write = debounce(() => {
    void writeJsonAtomic(this.path, this.toFile())
  }, 1000)

  constructor(userData: string) {
    this.path = join(userData, 'site-search.json')
  }

  async load(): Promise<void> {
    const file = await readJson(this.path, isFile)
    this.hosts = new Map()
    if (file === null) return
    for (const [host, entry] of Object.entries(file.hosts))
      if (isEntry(entry) && acceptTemplate(host, entry.template)) this.hosts.set(bareHost(host), entry)
  }

  get(host: string): OpenSearchEntry | undefined {
    return this.hosts.get(bareHost(host))
  }

  entries(): [string, OpenSearchEntry][] {
    return [...this.hosts.entries()]
  }

  fresh(host: string, now = Date.now()): boolean {
    const entry = this.get(host)
    return entry !== undefined && now - entry.checked < OPENSEARCH_REFRESH_MS
  }

  put(host: string, template: string, descriptor: string, now = Date.now()): void {
    const key = bareHost(host)
    this.hosts.delete(key)
    this.hosts.set(key, { template, descriptor, checked: now })
    while (this.hosts.size > OPENSEARCH_MAX_HOSTS) {
      const oldest = [...this.hosts.entries()].sort((a, b) => a[1].checked - b[1].checked)[0]
      if (oldest === undefined) break
      this.hosts.delete(oldest[0])
    }
    this.write()
  }

  clearRange(from: number, to: number): number {
    let removed = 0
    for (const [host, entry] of [...this.hosts])
      if (entry.checked >= from && entry.checked <= to) {
        this.hosts.delete(host)
        removed++
      }
    if (removed > 0) this.write()
    return removed
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.toFile())
  }

  private toFile(): OpenSearchFile {
    return { version: 1, hosts: Object.fromEntries(this.hosts) }
  }
}
