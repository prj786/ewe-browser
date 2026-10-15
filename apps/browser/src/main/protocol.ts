import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { net, type Session } from 'electron'
import { protocol } from 'electron'
import { APP_SCHEME } from '@ewe/shared'
import { rawResponse, thumbResponse } from './files/thumbs'
import { coverResponse } from './media/library'

const PAGES = new Set(['newtab', 'home', 'settings', 'sad', 'files', 'music', 'history'])
const TOKEN_ROUTES = new Set([
  'files/raw',
  'files/thumb',
  'music/raw',
  'music/cover',
  'home/raw',
  'home/thumb',
  'home/cover',
])
const DEV_PREFIXES = ['/@', '/node_modules/', '/pages/', '/ui/', '/assets/']

export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'crx', privileges: { bypassCSP: true } },
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ])
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
}

export function devTargetPath(host: string, pathname: string): string {
  if (pathname === '/' || pathname === '/index.html') return `/pages/${host}/index.html`
  if (DEV_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return pathname
  return `/pages/${host}${pathname}`
}

export function prodRelativePath(host: string, pathname: string): string | null {
  if (pathname === '/' || pathname === '/index.html') return join('pages', host, 'index.html')
  const relative = normalize(pathname).replace(/^[/\\]+/, '')
  if (relative.split(sep).includes('..')) return null
  if (!relative.startsWith(`assets${sep}`)) return null
  return relative
}

export function installAppProtocol(
  session: Session,
  rendererRoot: string,
  devServerUrl: string | undefined,
  filesToken: () => string = () => '',
): void {
  session.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const host = url.hostname
    if (!PAGES.has(host)) return notFound()

    const route = `${host}${url.pathname.replace(/^\/(raw|thumb|cover)\/.*$/, '/$1')}`
    if (TOKEN_ROUTES.has(route)) {
      const token = filesToken()
      const path = url.searchParams.get('path') ?? ''
      if (token === '' || url.searchParams.get('t') !== token || !(path?.startsWith('/') ?? false))
        return new Response('Forbidden', { status: 403 })
      if (route.endsWith('/thumb')) return thumbResponse(path)
      if (route.endsWith('/cover')) return coverResponse(path)
      return rawResponse(path, request.headers.get('range'))
    }

    if (devServerUrl !== undefined) {
      const target = `${devServerUrl}${devTargetPath(host, url.pathname)}${url.search}`
      return net.fetch(target, { headers: { accept: request.headers.get('accept') ?? '*/*' } })
    }

    const relative = prodRelativePath(host, url.pathname)
    if (relative === null) return notFound()
    const file = join(rendererRoot, relative)
    try {
      const body = await readFile(file)
      const type = MIME[extname(file)] ?? 'application/octet-stream'
      return new Response(body, {
        headers: {
          'content-type': type,
          'content-security-policy': PAGE_CSP,
          'x-content-type-options': 'nosniff',
        },
      })
    } catch {
      return notFound()
    }
  })
}
