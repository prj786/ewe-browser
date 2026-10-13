import { runTool } from '../files/places'
import { chromeUserAgent } from '../identity'

export interface DavAccount {
  base: string
  user: string
  server: string
  auth: string
}

export interface DavFile {
  etag: string | null
  body: string
}

export async function nextcloudAccount(): Promise<DavAccount | null> {
  const override = process.env.EWE_SYNC_URL
  if (override !== undefined) {
    const base = override.endsWith('/') ? override : `${override}/`
    return { base, user: 'test', server: new URL(base).origin, auth: 'Basic dGVzdDp0ZXN0' }
  }
  const text = await runTool('ewe-cloud', ['token', '--json'], 60_000)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text.trim()) as Record<string, unknown>
    const server = typeof parsed.server === 'string' ? parsed.server.replace(/\/+$/, '') : ''
    const user = typeof parsed.user === 'string' ? parsed.user : ''
    const token = typeof parsed.token === 'string' ? parsed.token : ''
    if (parsed.ok !== true || server === '' || user === '' || token === '') return null
    const root = (await runTool('ewe-cloud', ['webdav-url'], 30_000))?.trim() ?? ''
    const dav = /^https?:\/\//.test(root)
      ? root.replace(/\/?$/, '/')
      : `${server}/remote.php/dav/files/${encodeURIComponent(user)}/`
    return {
      base: `${dav}ewe/browser/`,
      user,
      server,
      auth: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`,
    }
  } catch {
    return null
  }
}

export class DavError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class Dav {
  constructor(private readonly account: DavAccount) {}

  private async request(
    method: string,
    name: string,
    init: { body?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const response = await fetch(new URL(name, this.account.base), {
      method,
      headers: {
        Authorization: this.account.auth,
        'User-Agent': `${chromeUserAgent()} ewe-browser-sync`,
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(60_000),
    })
    if (response.status === 401) throw new DavError(401, 'Nextcloud did not accept the login')
    return response
  }

  async ensureFolder(): Promise<void> {
    const parent = new URL('..', this.account.base).href
    for (const url of [parent, this.account.base]) {
      const response = await this.request('MKCOL', url)
      if (![201, 405, 301].includes(response.status) && !response.ok)
        throw new DavError(response.status, `Could not create the sync folder (${response.status})`)
    }
  }

  async get(name: string): Promise<DavFile | null> {
    const response = await this.request('GET', name)
    if (response.status === 404) return null
    if (!response.ok)
      throw new DavError(response.status, `Could not read ${name} (${response.status})`)
    return { etag: response.headers.get('etag'), body: await response.text() }
  }

  async put(name: string, body: string, etag: string | null): Promise<'ok' | 'conflict'> {
    const response = await this.request('PUT', name, {
      body,
      headers: {
        'Content-Type': 'application/json',
        ...(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag }),
      },
    })
    if (response.status === 412) return 'conflict'
    if (!response.ok)
      throw new DavError(response.status, `Could not save ${name} (${response.status})`)
    return 'ok'
  }
}
