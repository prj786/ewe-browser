import { filesUrl, isLocalPathInput } from './files'
import type { SearchEngineId } from './models'

export interface ResolvedInput {
  kind: 'url' | 'search' | 'tabs' | 'bookmarks'
  url: string
  query: string
}

export const SEARCH_ENGINES: Record<SearchEngineId, { name: string; template: string }> = {
  google: { name: 'Google', template: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
  kagi: { name: 'Kagi', template: 'https://kagi.com/search?q=%s' },
  brave: { name: 'Brave', template: 'https://search.brave.com/search?q=%s' },
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i
const BARE_SCHEME_RE = /^(about|app|chrome|file|data|mailto|view-source):/i
const BLOCKED_SCHEME_RE = /^(javascript|vbscript):/i
const HOST_RE =
  /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d{1,5})?(?:[/?#].*)?$/i
const LOCAL_HOST_RE =
  /^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\])(?::\d+|[/?#]|$)/i

export function searchUrl(query: string, engine: SearchEngineId): string {
  return SEARCH_ENGINES[engine].template.replace('%s', encodeURIComponent(query))
}

export function resolveInput(raw: string, engine: SearchEngineId): ResolvedInput {
  const input = raw.trim()
  if (input.startsWith('t:')) {
    const query = input.slice(2).trim()
    return { kind: 'tabs', url: '', query }
  }
  if (input.startsWith('b:')) {
    const query = input.slice(2).trim()
    return { kind: 'bookmarks', url: '', query }
  }
  if (input.startsWith('w:')) {
    const query = input.slice(2).trim()
    return { kind: 'search', url: searchUrl(query, engine), query }
  }
  if (input === '') return { kind: 'url', url: 'app://newtab/', query: '' }
  if (isLocalPathInput(input)) return { kind: 'url', url: filesUrl(input), query: input }
  if (BLOCKED_SCHEME_RE.test(input))
    return { kind: 'search', url: searchUrl(input, engine), query: input }
  if (SCHEME_RE.test(input) || BARE_SCHEME_RE.test(input)) {
    return { kind: 'url', url: input, query: input }
  }
  if (!/\s/.test(input) && HOST_RE.test(input)) {
    const scheme = LOCAL_HOST_RE.test(input) ? 'http' : 'https'
    return { kind: 'url', url: `${scheme}://${input}`, query: input }
  }
  return { kind: 'search', url: searchUrl(input, engine), query: input }
}

export function displayUrl(url: string): string {
  if (url === '' || url.startsWith('app://newtab')) return ''
  try {
    const u = new URL(url)
    if (u.protocol === 'app:' && u.host === 'files') return u.searchParams.get('path') ?? 'Files'
    if (u.protocol === 'app:') return `${u.protocol}//${u.host}`
    const host = u.host.replace(/^www\./, '')
    const path = u.pathname === '/' ? '' : u.pathname
    return `${host}${path}${u.search}`
  } catch {
    return url
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function isOpenableUrl(url: string): boolean {
  return /^(https?:\/\/|app:\/\/)/i.test(url) || url === 'about:blank'
}

export function isRestorableUrl(url: string): boolean {
  return isOpenableUrl(url) || /^file:\/\//i.test(url)
}
