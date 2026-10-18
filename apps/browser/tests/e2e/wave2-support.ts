import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { ShellCommand } from '@ewe/shared'

export const MAIN = join(__dirname, '../../out/main/index.js')
export const CLI = join(__dirname, '../../out/main/cli.js')

export function launch(
  userData: string,
  env: Record<string, string> = {},
  switches: string[] = [],
): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN, ...switches],
    env: { ...process.env, EWE_USER_DATA: userData, ...env },
  })
}

export async function windowWith(app: ElectronApplication, part: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((w) => w.url().includes(part)), { timeout: 20_000 })
    .toBe(true)
  const page = app.windows().find((w) => w.url().includes(part))
  if (page === undefined) throw new Error(`window ${part} not found`)
  await page.waitForLoadState('domcontentloaded')
  return page
}

export async function shellOf(app: ElectronApplication): Promise<Page> {
  const shell = await windowWith(app, '/ui/shell/')
  await shell.waitForFunction(() => typeof window.ewe === 'object')
  let last = ''
  await expect
    .poll(
      async () => {
        const inner = await shell.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)
        const stable = inner === last
        last = inner
        return stable
      },
      { intervals: [500], timeout: 15_000 },
    )
    .toBe(true)
  return shell
}

export function send(shell: Page, command: ShellCommand): Promise<void> {
  return shell.evaluate((c) => window.ewe.send(c), command)
}

export function activeUrl(shell: Page): Promise<string | undefined> {
  return shell.evaluate(async () => {
    const s = await window.ewe.getState()
    return s?.tabs.find((t) => t.id === s.activeTabId)?.url
  })
}

export function activeLoading(shell: Page): Promise<boolean | undefined> {
  return shell.evaluate(async () => {
    const s = await window.ewe.getState()
    return s?.tabs.find((t) => t.id === s.activeTabId)?.loading
  })
}

export async function visit(shell: Page, url: string): Promise<void> {
  await send(shell, { type: 'tab.navigate', input: url })
  await expect.poll(() => activeUrl(shell), { timeout: 15_000 }).toBe(url)
  await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
}

export function inPage<T>(app: ElectronApplication, code: string, gesture = false): Promise<T> {
  return app.evaluate(
    async ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      const view = win?.contentView.children
        .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
        .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
      if (view === undefined) throw new Error('no page')
      return (await view.webContents.executeJavaScript(p.code, p.gesture)) as T
    },
    { code, gesture },
  )
}

export function overlayState(
  app: ElectronApplication,
): Promise<{ visible: boolean; bounds: Electron.Rectangle | null }> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const overlay = win?.contentView.children
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .find((v) => v.webContents.getURL().includes('/ui/overlay/'))
    return {
      visible: overlay?.getVisible() ?? false,
      bounds: overlay?.getBounds() ?? null,
    }
  })
}

export function pageBounds(app: ElectronApplication): Promise<Electron.Rectangle | null> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const view = win?.contentView.children
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
    return view?.getBounds() ?? null
  })
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void

export interface Served {
  port: number
  url: string
  requests: { path: string; host: string; gpc: string | null; cookie: string | null }[]
  close(): void
}

function router(routes: Record<string, Handler | string>, requests: Served['requests']): Handler {
  return (req, res) => {
    const path = req.url ?? '/'
    requests.push({
      path,
      host: req.headers.host ?? '',
      gpc: typeof req.headers['sec-gpc'] === 'string' ? req.headers['sec-gpc'] : null,
      cookie: req.headers.cookie ?? null,
    })
    const route = routes[path.split('?')[0] ?? '/']
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    if (typeof route === 'string') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(route)
      return
    }
    route(req, res)
  }
}

function listen(
  server: ReturnType<typeof createServer>,
  scheme: string,
  requests: Served['requests'],
): Promise<Served> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ port, url: `${scheme}://127.0.0.1:${port}`, requests, close: () => server.close() })
    })
  })
}

export function serve(routes: Record<string, Handler | string>): Promise<Served> {
  const requests: Served['requests'] = []
  return listen(createServer(router(routes, requests)), 'http', requests)
}

export function serveTls(routes: Record<string, Handler | string>): Promise<Served> {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-e2e-tls-'))
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=ewe-test',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  )
  const requests: Served['requests'] = []
  const server = createTlsServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    router(routes, requests),
  )
  return listen(server, 'https', requests)
}

export function trustAnyCertificate(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ session }) => {
    session.fromPartition('persist:default').setCertificateVerifyProc((_request, callback) => {
      callback(0)
    })
  })
}

export function cliIn(userData: string, cwd?: string) {
  return (...argv: string[]): Record<string, unknown> =>
    JSON.parse(
      execFileSync(process.execPath, [CLI, ...argv], {
        encoding: 'utf8',
        ...(cwd === undefined ? {} : { cwd }),
        env: { ...process.env, EWE_USER_DATA: userData },
      }),
    ) as Record<string, unknown>
}
