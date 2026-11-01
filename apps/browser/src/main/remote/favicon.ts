import type { Session } from 'electron'

export const FAVICON_MAX_BYTES = 64 * 1024
export const FAVICON_TIMEOUT_MS = 8_000

const IMAGE = /^image\/[a-z0-9.+-]{1,40}$/i

export function inlineableFavicon(url: string): 'data' | 'fetch' | null {
  if (/^data:image\//i.test(url)) return url.length <= FAVICON_MAX_BYTES * 2 ? 'data' : null
  return /^https?:\/\//i.test(url) ? 'fetch' : null
}

export async function inlineFavicon(session: Session, url: string): Promise<string | null> {
  const kind = inlineableFavicon(url)
  if (kind === 'data') return url
  if (kind === null) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS)
  try {
    const response = await session.fetch(url, { signal: controller.signal, credentials: 'omit' })
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
    if (!response.ok || !IMAGE.test(type)) return null
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > FAVICON_MAX_BYTES) return null
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0 || body.length > FAVICON_MAX_BYTES) return null
    return `data:${type.toLowerCase()};base64,${body.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
