import type { TabState } from '@ewe/shared'

export function faviconFor(url: string, tabs: TabState[]): string | null {
  const open = tabs.find((t) => t.url === url && t.favicon !== null)
  if (open !== undefined) return open.favicon
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}/favicon.ico` : null
  } catch {
    return null
  }
}
