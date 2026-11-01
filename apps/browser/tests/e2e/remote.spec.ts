import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage } from 'node:http'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { WindowSnapshot } from '@ewe/shared'
import { activeUrl, cliIn, inPage, launch, send, shellOf, visit, windowWith } from './wave2-support'

const WORK = '3f9c0a1b2c3d4e5f'
const THIS = 'aa00bb11cc22dd33'
const SHOTS = process.env.EWE_REMOTE_SHOTS

const STATUS = {
  ok: true,
  this: { id: THIS, name: 'home', sharing: false },
  computers: [
    {
      id: WORK,
      name: 'work-pc',
      user: 'you',
      sharing: true,
      online: true,
      paired: true,
      allowed: false,
      last_seen: 1793500000,
    },
    { id: 'bb00cc11dd22ee33', name: 'attic', sharing: false, online: false, paired: true },
    { id: THIS, name: 'home', sharing: true, online: true, paired: true },
  ],
  tailscale: { installed: true },
}

interface Stub {
  bin: string
  calls(): string[]
  tunnel(answer: unknown): void
}

function stubRemote(dir: string, socksPort: number): Stub {
  const bin = join(dir, 'ewe-remote')
  writeFileSync(join(dir, 'status.json'), JSON.stringify(STATUS))
  const tunnel = (answer: unknown) =>
    writeFileSync(join(dir, 'tunnel.json'), JSON.stringify(answer))
  tunnel({ ok: true, socks: `127.0.0.1:${String(socksPort)}`, pid: 4242 })
  writeFileSync(
    bin,
    `#!/bin/sh
dir="$(dirname "$0")"
printf '%s\\n' "$*" >> "$dir/calls.log"
case "$1" in
  status) cat "$dir/status.json" ;;
  tunnel) cat "$dir/tunnel.json" ;;
  *) printf '{"ok":false,"error":"usage"}' ;;
esac
`,
  )
  chmodSync(bin, 0o755)
  return {
    bin,
    calls: () => {
      try {
        return readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
    tunnel,
  }
}

interface Socks {
  port: number
  seen: { atyp: number; host: string; port: number }[]
  kill(): Promise<void>
}

function socks5(targetPort: number): Promise<Socks> {
  const seen: Socks['seen'] = []
  const open = new Set<Socket>()
  const server = createServer((client) => {
    open.add(client)
    client.on('close', () => open.delete(client))
    client.on('error', () => undefined)
    let greeted = false
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (!greeted) {
        const methods = buf[1]
        if (methods === undefined || buf.length < 2 + methods) return
        buf = buf.subarray(2 + methods)
        greeted = true
        client.write(Buffer.from([5, 0]))
      }
      if (buf.length < 5) return
      const atyp = buf[3] ?? 0
      let host: string
      let at: number
      if (atyp === 1) {
        if (buf.length < 10) return
        host = [...buf.subarray(4, 8)].join('.')
        at = 8
      } else if (atyp === 3) {
        const length = buf[4] ?? 0
        if (buf.length < 7 + length) return
        host = buf.subarray(5, 5 + length).toString('latin1')
        at = 5 + length
      } else {
        client.destroy()
        return
      }
      const port = buf.readUInt16BE(at)
      const rest = buf.subarray(at + 2)
      client.off('data', onData)
      seen.push({ atyp, host, port })
      const upstream = connect(targetPort, '127.0.0.1', () => {
        client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
        if (rest.length > 0) upstream.write(rest)
        client.pipe(upstream)
        upstream.pipe(client)
      })
      open.add(upstream)
      upstream.on('close', () => open.delete(upstream))
      upstream.on('error', () => client.destroy())
    }
    client.on('data', onData)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        port,
        seen,
        kill: () =>
          new Promise((done) => {
            server.close(() => done())
            for (const socket of open) socket.destroy()
          }),
      })
    })
  })
}

const LEAKY = (side: string) =>
  `<link rel="dns-prefetch" href="//${side}-prefetch.leak.test"><link rel="preconnect" href="http://${side}-preconnect.leak.test">`

interface Origin {
  port: number
  url: string
  requests: { host: string; path: string }[]
  close(): void
}

function origin(): Promise<Origin> {
  const requests: Origin['requests'] = []
  const page = (req: IncomingMessage): { body: string; cookie?: string } => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    if (path === '/late') return { body: `<title>Late</title>${LEAKY('remote-late')}<p>late</p>` }
    if (path === '/local')
      return { body: `<title>Local</title>${LEAKY('local')}<p>local</p>`, cookie: 'side=local' }
    if (path === '/')
      return {
        body: `<title>Intranet</title>${LEAKY('remote')}<p>inside</p>`,
        cookie: 'side=remote',
      }
    return { body: `<title>${path.slice(1)}</title><p>${path.slice(1)}</p>` }
  }
  const server = createHttpServer((req, res) => {
    requests.push({ host: req.headers.host ?? '', path: req.url ?? '' })
    if (req.url === '/report.txt') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="report.txt"',
      })
      res.end('quarterly numbers')
      return
    }
    const { body, cookie } = page(req)
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      ...(cookie === undefined ? {} : { 'set-cookie': `${cookie}; Path=/` }),
    })
    res.end(body)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        port,
        url: `http://127.0.0.1:${String(port)}`,
        requests,
        close: () => server.close(),
      })
    })
  })
}

interface Trap {
  port: number
  connections(): number
  requests: string[]
  close(): void
}

function trap(): Promise<Trap> {
  let count = 0
  const requests: string[] = []
  const server = createHttpServer((req, res) => {
    requests.push(`${req.headers.host ?? ''}${req.url ?? ''}`)
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<title>Direct</title><p>went direct</p>')
  })
  server.on('connection', () => count++)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ port, connections: () => count, requests, close: () => server.close() })
    })
  })
}

function state(shell: Page): Promise<WindowSnapshot | null> {
  return shell.evaluate(() => window.ewe.getState())
}

async function cookies(app: ElectronApplication, partition: string): Promise<string[]> {
  return app.evaluate(
    async ({ session }, p) =>
      (await session.fromPartition(p).cookies.get({})).map((c) => `${c.name}=${c.value}`),
    partition,
  )
}

function rtcPolicies(app: ElectronApplication): Promise<Record<string, string>> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const out: Record<string, string> = {}
    for (const win of BrowserWindow.getAllWindows())
      for (const view of win.contentView.children) {
        if (!(view instanceof WebContentsView)) continue
        const url = view.webContents.getURL()
        if (/^https?:/.test(url)) out[url] = view.webContents.getWebRTCIPHandlingPolicy()
      }
    return out
  })
}

function capture(app: ElectronApplication): Promise<string> {
  return app.evaluate(async ({ BrowserWindow, WebContentsView, nativeImage }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) throw new Error('no window')
    const base = await win.webContents.capturePage()
    const { width, height } = base.getSize()
    const scale = width / win.getContentBounds().width
    const pixels = Buffer.from(base.toBitmap())
    for (const view of win.contentView.children) {
      if (!(view instanceof WebContentsView) || !view.getVisible()) continue
      const b = view.getBounds()
      if (b.width === 0 || b.height === 0) continue
      const image = await view.webContents.capturePage()
      const size = image.getSize()
      const src = image.toBitmap()
      const ox = Math.round(b.x * scale)
      const oy = Math.round(b.y * scale)
      for (let y = 0; y < size.height; y++) {
        const ty = oy + y
        if (ty < 0 || ty >= height) continue
        for (let x = 0; x < size.width; x++) {
          const tx = ox + x
          if (tx < 0 || tx >= width) continue
          const si = (y * size.width + x) * 4
          const ti = (ty * width + tx) * 4
          const alpha = (src[si + 3] ?? 0) / 255
          if (alpha === 0) continue
          for (let c = 0; c < 3; c++)
            pixels[ti + c] = Math.round((src[si + c] ?? 0) + (pixels[ti + c] ?? 0) * (1 - alpha))
          pixels[ti + 3] = 255
        }
      }
    }
    return nativeImage.createFromBitmap(pixels, { width, height }).toPNG().toString('base64')
  })
}

async function shot(app: ElectronApplication, name: string): Promise<void> {
  if (SHOTS === undefined) return
  await new Promise((resolve) => setTimeout(resolve, 400))
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(await capture(app), 'base64'))
}

function resolverHosts(file: string, needle: string): string[] {
  const log = JSON.parse(readFileSync(file, 'utf8')) as {
    constants: { logEventTypes: Record<string, number> }
    events: { type: number; params?: unknown }[]
  }
  const resolver = new Set(
    Object.entries(log.constants.logEventTypes)
      .filter(([name]) => name.startsWith('HOST_RESOLVER'))
      .map(([, id]) => id),
  )
  const hits = new Set<string>()
  for (const event of log.events) {
    if (!resolver.has(event.type)) continue
    for (const match of JSON.stringify(event.params ?? {}).matchAll(
      new RegExp(`[a-z0-9.-]*${needle}`, 'g'),
    ))
      hits.add(match[0])
  }
  return [...hits]
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('a remote workspace browses through its computer: SOCKS with hostnames, own cookies, nothing direct', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-e2e-remote-'))
  const site = await origin()
  const tunnel = await socks5(site.port)
  const direct = await trap()
  const stub = stubRemote(dir, tunnel.port)
  const netLog = join(dir, 'net.json')
  const downloads = join(dir, 'downloads')
  mkdirSync(downloads)
  const app = await launch(
    join(dir, 'profile'),
    { EWE_REMOTE_BIN: stub.bin, EWE_DOWNLOADS: downloads },
    [`--host-resolver-rules=MAP *.remote.test 127.0.0.1:${String(direct.port)}`],
  )
  try {
    const shell = await shellOf(app)
    const overlay = await windowWith(app, '/ui/overlay/')
    await app.evaluate(({ netLog: log }, file) => log.startLogging(file), netLog)

    await shell.locator('.bar-ws-add').click()
    await expect(overlay.locator('.menu')).toBeVisible()
    expect(await overlay.locator('.menu-item .menu-label').allTextContents()).toEqual([
      'New workspace',
      'Browse from attic',
      'Browse from work-pc',
    ])
    expect(await overlay.locator('.menu-item.disabled .menu-label').allTextContents()).toEqual([
      'Browse from attic',
    ])
    await expect(
      overlay.locator('.menu-item', { hasText: 'attic' }).locator('.menu-hint'),
    ).toHaveText('Not sharing')
    await shot(app, 'remote-menu')
    await overlay.locator('.menu-item', { hasText: 'Browse from work-pc' }).click()

    await expect
      .poll(async () => (await state(shell))?.workspaces.map((w) => [w.name, w.remote ?? null]))
      .toEqual([
        ['Home', null],
        ['work-pc', { id: WORK, name: 'work-pc' }],
      ])
    const chip = shell.locator('.bar-ws.on.remote')
    await expect(chip).toHaveAttribute('data-remote', WORK)
    await expect(chip.locator('.bar-ws-remote')).toBeVisible()
    await expect(chip).toHaveAttribute('title', /browses from work-pc/)
    await expect.poll(() => activeUrl(shell)).toBe('app://home/')
    await expect.poll(() => stub.calls()).toContain(`tunnel ${WORK}`)

    await visit(shell, 'http://intranet.remote.test/')
    expect(await inPage<string>(app, 'document.body.innerText')).toContain('inside')
    expect(tunnel.seen).toContainEqual({ atyp: 3, host: 'intranet.remote.test', port: 80 })
    expect(site.requests).toContainEqual({ host: 'intranet.remote.test', path: '/' })

    await send(shell, { type: 'tab.navigate', input: 'http://intranet.remote.test/report.txt' })
    await expect
      .poll(() => {
        try {
          return readFileSync(join(downloads, 'report.txt'), 'utf8')
        } catch {
          return ''
        }
      })
      .toBe('quarterly numbers')
    await expect
      .poll(() => {
        try {
          const file = JSON.parse(readFileSync(join(dir, 'profile', 'downloads.json'), 'utf8')) as {
            entries: { filename: string; status: string; via?: string }[]
          }
          return file.entries.map((e) => [e.filename, e.status, e.via])
        } catch {
          return []
        }
      })
      .toEqual([['report.txt', 'completed', WORK]])
    expect(tunnel.seen.filter((s) => s.host === 'intranet.remote.test').length).toBeGreaterThan(1)

    await visit(shell, 'http://localhost:8123/loopback')
    expect(tunnel.seen).toContainEqual({ atyp: 3, host: 'localhost', port: 8123 })
    await shot(app, 'remote-chip')

    expect(await cookies(app, `persist:remote-${WORK}`)).toEqual(['side=remote'])
    expect(await cookies(app, 'persist:default')).toEqual([])
    expect(Object.values(await rtcPolicies(app))).toEqual(['disable_non_proxied_udp'])

    await pause(1500)
    expect(direct.requests).toEqual([])
    expect(direct.connections()).toBe(0)
    const throughTunnel = tunnel.seen.length

    const home = (await state(shell))?.workspaces[0]?.id ?? ''
    const remoteId = (await state(shell))?.workspaces[1]?.id ?? ''
    await send(shell, { type: 'workspace.activate', id: home })
    await visit(shell, `${site.url}/local`)
    expect(site.requests).toContainEqual({
      host: `127.0.0.1:${String(site.port)}`,
      path: '/local',
    })
    expect(await cookies(app, 'persist:default')).toEqual(['side=local'])
    expect(await cookies(app, `persist:remote-${WORK}`)).toEqual(['side=remote'])
    const policies = await rtcPolicies(app)
    expect(policies[`${site.url}/local`]).toBe('default')

    await visit(shell, 'http://direct.remote.test/')
    expect(direct.connections()).toBeGreaterThan(0)
    expect(tunnel.seen.length).toBe(throughTunnel)

    await send(shell, { type: 'settings.update', patch: { theme: 'light' } })
    await send(shell, { type: 'workspace.activate', id: remoteId })
    await visit(shell, 'http://intranet.remote.test/late')
    expect(tunnel.seen).toContainEqual({ atyp: 3, host: 'intranet.remote.test', port: 80 })

    await app.evaluate(({ netLog: log }) => log.stopLogging())
    expect(resolverHosts(netLog, 'remote\\.test')).not.toContain('intranet.remote.test')
    const leaked = resolverHosts(netLog, 'leak\\.test')
    expect(leaked.filter((h) => h.startsWith('remote-'))).toEqual([])
    console.log(`[remote e2e] local resolver saw: ${leaked.join(', ') || 'nothing'}`)
  } finally {
    await app.close()
    site.close()
    direct.close()
    await tunnel.kill()
  }
})

test('a dead tunnel fails closed, is asked for again once, and the command line makes remote workspaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-e2e-remote2-'))
  const profile = join(dir, 'profile')
  const site = await origin()
  const first = await socks5(site.port)
  const direct = await trap()
  const stub = stubRemote(dir, first.port)
  const switches = [`--host-resolver-rules=MAP *.remote.test 127.0.0.1:${String(direct.port)}`]
  const env = { EWE_REMOTE_BIN: stub.bin }
  const cli = cliIn(profile)
  let app = await launch(profile, env, switches)
  const tunnels = () => stub.calls().filter((c) => c === `tunnel ${WORK}`).length
  try {
    const shell = await shellOf(app)

    expect(cli('workspace', 'create', '--remote', 'home')).toMatchObject({
      ok: false,
      error: 'this-computer',
    })
    expect(cli('workspace', 'create', '--remote', 'attic')).toMatchObject({
      ok: false,
      error: 'not-sharing',
    })
    expect(cli('workspace', 'create', '--remote', 'nowhere')).toMatchObject({
      ok: false,
      error: 'not-found',
    })
    expect(cli('workspace', 'create', '--remote', 'WORK-PC')).toMatchObject({
      ok: true,
      workspace: { name: 'work-pc', active: true, remote: { id: WORK, name: 'work-pc' } },
    })
    expect(cli('workspaces')).toMatchObject({
      workspaces: [
        { name: 'Home', remote: null },
        { name: 'work-pc', remote: { id: WORK, name: 'work-pc' } },
      ],
    })

    await visit(shell, 'http://intranet.remote.test/')
    expect(first.seen.map((s) => s.host)).toContain('intranet.remote.test')

    await first.kill()
    const before = tunnels()
    await send(shell, { type: 'tab.navigate', input: 'http://intranet.remote.test/other' })
    await expect
      .poll(() => activeUrl(shell), { timeout: 20_000 })
      .toMatch(/^app:\/\/sad\/\?kind=remote&/)
    expect(tunnels()).toBe(before + 1)
    const sad = new URL((await activeUrl(shell)) ?? '')
    expect(sad.searchParams.get('name')).toBe('work-pc')
    expect(sad.searchParams.get('url')).toBe('http://intranet.remote.test/other')
    expect(sad.searchParams.get('error')).toMatch(/ERR_PROXY_CONNECTION_FAILED/)
    await expect
      .poll(() => inPage<string>(app, "document.querySelector('.empty-title')?.textContent ?? ''"))
      .toBe('work-pc can’t be reached')
    expect(site.requests.some((r) => r.path === '/other')).toBe(false)
    await shot(app, 'remote-unreachable')

    const second = await socks5(site.port)
    stub.tunnel({ ok: true, socks: `127.0.0.1:${String(second.port)}`, pid: 4343 })
    const retried = tunnels()
    await visit(shell, 'http://intranet.remote.test/again')
    expect(tunnels()).toBe(retried + 1)
    expect(second.seen.map((s) => s.host)).toContain('intranet.remote.test')
    expect(site.requests).toContainEqual({ host: 'intranet.remote.test', path: '/again' })

    await second.kill()
    stub.tunnel({ ok: false, error: 'unreachable', message: 'work-pc is offline' })
    await send(shell, { type: 'tab.navigate', input: 'http://intranet.remote.test/later' })
    await expect
      .poll(() => activeUrl(shell), { timeout: 20_000 })
      .toMatch(/^app:\/\/sad\/\?kind=remote&/)
    await expect
      .poll(() =>
        inPage<string>(app, "document.querySelector('.remote-message')?.textContent ?? ''"),
      )
      .toBe('work-pc is offline')

    const third = await socks5(site.port)
    stub.tunnel({ ok: true, socks: `127.0.0.1:${String(third.port)}`, pid: 4444 })
    await inPage(app, "document.querySelector('.remote-retry').click(); 1", true)
    await expect
      .poll(() => activeUrl(shell), { timeout: 20_000 })
      .toBe('http://intranet.remote.test/later')
    expect(third.seen.map((s) => s.host)).toContain('intranet.remote.test')
    expect(direct.requests).toEqual([])
    expect(direct.connections()).toBe(0)

    await app.close()
    app = await launch(profile, env, switches)
    const restored = await shellOf(app)
    await expect
      .poll(async () => (await state(restored))?.workspaces.map((w) => w.remote ?? null))
      .toEqual([null, { id: WORK, name: 'work-pc' }])
    await expect(restored.locator('.bar-ws.remote .bar-ws-name')).toHaveText('work-pc')
    await third.kill()
  } finally {
    await app.close()
    site.close()
    direct.close()
  }
})
