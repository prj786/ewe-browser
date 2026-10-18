import { lookup } from 'node:dns/promises'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  activeUrl,
  inPage,
  launch,
  overlayState,
  pageBounds,
  send,
  serve,
  shellOf,
  visit,
  windowWith,
} from './wave2-support'

const ASK_PAGE = '<!doctype html><title>Flock call</title><p>Flock call</p>'

function permissionsFile(userData: string): unknown {
  const path = join(userData, 'permissions.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

async function promptKinds(overlay: Page): Promise<string[]> {
  await expect(overlay.locator('.perm-prompt')).toBeVisible()
  return overlay
    .locator('.perm-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-kind') ?? ''))
}

test('site permissions ask on the page, remember the answer and agree with permissions.query', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-perm-'))
  const site = await serve({ '/call.html': ASK_PAGE, '/other.html': '<title>Other</title>' })
  const origin = site.url
  const app = await launch(userData, {}, ['--use-fake-device-for-media-stream'])
  try {
    const shell = await shellOf(app)
    const overlay = await windowWith(app, '/ui/overlay/')
    await visit(shell, `${origin}/call.html`)

    expect(
      await inPage<string>(app, "navigator.permissions.query({name:'camera'}).then(s => s.state)"),
    ).toBe('prompt')
    expect(await inPage<string>(app, 'Notification.permission')).toBe('default')
    await inPage(
      app,
      `window.media = navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(s => { s.getTracks().forEach(t => t.stop()); return 'granted' }, e => e.name); 1`,
      true,
    )
    expect(await promptKinds(overlay)).toEqual(['camera', 'microphone'])
    await expect(overlay.locator('.perm-site')).toHaveText(new URL(origin).host)
    const page = await pageBounds(app)
    await expect
      .poll(async () => (await overlayState(app)).bounds)
      .toMatchObject({ x: page?.x, y: page?.y, width: 384 })
    const fitted = (await overlayState(app)).bounds?.height ?? 0
    expect(fitted).toBeGreaterThan(100)
    expect(fitted).toBeLessThan(220)

    await overlay.evaluate(() => document.querySelector<HTMLButtonElement>('.perm-allow')?.click())
    await new Promise((r) => setTimeout(r, 300))
    await expect(overlay.locator('.perm-prompt')).toBeVisible()
    await new Promise((r) => setTimeout(r, 400))
    await overlay.locator('.perm-allow').click()
    expect(await inPage<string>(app, 'window.media')).toBe('granted')
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    expect(
      await inPage<string>(app, "navigator.permissions.query({name:'camera'}).then(s => s.state)"),
    ).toBe('granted')
    await expect
      .poll(() => permissionsFile(userData), { timeout: 5000 })
      .toMatchObject({
        sites: [{ origin, permissions: { camera: 'allow', microphone: 'allow' } }],
      })

    await inPage(app, 'window.note = Notification.requestPermission(); 1', true)
    expect(await promptKinds(overlay)).toEqual(['notifications'])
    await new Promise((r) => setTimeout(r, 600))
    await overlay.locator('.perm-block').click()
    expect(await inPage<string>(app, 'window.note')).toBe('denied')
    expect(await inPage<string>(app, 'Notification.requestPermission()', true)).toBe('denied')
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)

    await inPage(
      app,
      `window.where = new Promise(r => navigator.geolocation.getCurrentPosition(() => r('ok'), e => r(e.code))); 1`,
      true,
    )
    expect(await promptKinds(overlay)).toEqual(['location'])
    await expect(overlay.locator('.perm-note')).toContainText('no location service')
    await send(shell, { type: 'tab.create', url: `${origin}/other.html` })
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    const ids = await shell.evaluate(async () =>
      (await window.ewe.getState())?.tabs.map((t) => t.id),
    )
    await send(shell, { type: 'tab.activate', id: ids?.at(-2) ?? '' })
    await expect(overlay.locator('.perm-prompt')).toBeVisible()
    await overlay.locator('.perm-close').click()
    expect(await inPage<number>(app, 'window.where')).toBe(1)
    const locate = `new Promise(r => navigator.geolocation.getCurrentPosition(() => r('ok'), e => r(e.code)))`
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    await inPage(app, `window.again = ${locate}; 1`, true)
    expect(await promptKinds(overlay)).toEqual(['location'])
    await overlay.locator('.perm-close').click()
    expect(await inPage<number>(app, 'window.again')).toBe(1)
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    expect(await inPage<number>(app, locate, true)).toBe(1)
    expect((await overlayState(app)).visible).toBe(false)
    await expect
      .poll(() => permissionsFile(userData))
      .toMatchObject({
        sites: [
          {
            origin,
            permissions: { camera: 'allow', microphone: 'allow', notifications: 'block' },
          },
        ],
      })
  } finally {
    await app.close()
    site.close()
  }
})

test('the lock opens site info: toggles, clear site data and the settings list', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-siteinfo-'))
  const site = await serve({ '/page.html': '<title>Wool</title><p>Wool</p>' })
  writeFileSync(
    join(userData, 'permissions.json'),
    JSON.stringify({
      version: 1,
      sites: [{ origin: site.url, permissions: { notifications: 'block' }, updated: 1 }],
    }),
  )
  const app = await launch(userData)
  try {
    const shell = await shellOf(app)
    const overlay = await windowWith(app, '/ui/overlay/')
    await visit(shell, `${site.url}/page.html`)
    await inPage(app, "document.cookie = 'flock=1; path=/'; localStorage.setItem('wool', '1'); 1")
    await expect(shell.locator('.rail-site')).toBeVisible()
    await shell.locator('.rail-site').click()
    await expect(overlay.locator('.site-info')).toBeVisible()
    await expect(overlay.locator('.site-info-status')).toHaveText('Connection is not secure')
    expect(
      await overlay
        .locator('.site-perm')
        .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-kind'))),
    ).toEqual(['camera', 'microphone', 'location', 'notifications'])
    await expect(overlay.locator('.site-perm[data-kind="notifications"] .seg-item.on')).toHaveText(
      'Block',
    )
    await overlay.locator('.site-perm[data-kind="camera"] .seg-item[data-value="allow"]').click()
    await expect(overlay.locator('.site-perm[data-kind="camera"] .seg-item.on')).toHaveText('Allow')
    await overlay
      .locator('.site-perm[data-kind="notifications"] .seg-item[data-value="ask"]')
      .click()
    await expect(overlay.locator('.site-perm[data-kind="notifications"] .seg-item.on')).toHaveText(
      'Ask',
    )
    await expect
      .poll(async () =>
        inPage<string>(app, "navigator.permissions.query({name:'camera'}).then(s => s.state)"),
      )
      .toBe('granted')

    const cookies = () =>
      app.evaluate(
        async ({ session }) =>
          (await session.fromPartition('persist:default').cookies.get({ name: 'flock' })).length,
      )
    expect(await cookies()).toBe(1)
    await overlay.locator('.site-info-clear').click()
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    await expect.poll(cookies).toBe(0)
    await expect.poll(() => inPage<string | null>(app, "localStorage.getItem('wool')")).toBeNull()

    await shell.locator('.rail-site').click()
    await expect(overlay.locator('.site-info')).toBeVisible()
    await overlay.locator('.site-info-settings').click()
    await expect.poll(() => activeUrl(shell)).toBe('app://settings/#privacy')
    const settings = await windowWith(app, 'app://settings/')
    const row = settings.locator(`.settings-site[data-origin="${site.url}"]`)
    await expect(row).toBeVisible()
    await expect(row.locator('.settings-site-perm')).toHaveCount(1)
    await row.locator('.settings-site-perm[data-kind="camera"] select').selectOption('block')
    await expect
      .poll(
        () =>
          (permissionsFile(userData) as { sites: { permissions: unknown }[] }).sites[0]
            ?.permissions,
      )
      .toEqual({ camera: 'block' })
    await row.locator('.settings-site-forget').click()
    await expect(settings.locator('.settings-site')).toHaveCount(0)
  } finally {
    await app.close()
    site.close()
  }
})

test('settings: privacy and security apply live; secure DNS is used for lookups', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-privacy-settings-'))
  const app = await launch(userData)
  try {
    const shell = await shellOf(app)
    await send(shell, { type: 'open.internal', page: 'settings' })
    const settings = await windowWith(app, 'app://settings/')
    const privacy = () => shell.evaluate(async () => (await window.ewe.getSettings())?.privacy)
    await expect(settings.locator('#privacy')).toBeVisible()
    await settings.locator('.settings-secure-dns').selectOption('quad9')
    await expect.poll(privacy).toMatchObject({ secureDns: 'secure', dnsProvider: 'quad9' })
    await settings.locator('.settings-secure-dns').selectOption('custom')
    await expect(settings.locator('.settings-dns-error')).toBeVisible()
    const field = settings.locator('.settings-dns-field')
    await field.fill('http://dns.example/q')
    await expect(settings.locator('.settings-dns-save')).toBeDisabled()
    await field.fill('https://127.0.0.1:59999/dns-query')
    await settings.locator('.settings-dns-save').click()
    await expect.poll(privacy).toMatchObject({ dnsTemplate: 'https://127.0.0.1:59999/dns-query' })
    await expect(settings.locator('.settings-dns-error')).toHaveCount(0)
    const resolve = (host: string) =>
      app.evaluate(async ({ session }, h) => {
        try {
          await session
            .fromPartition('persist:default')
            .resolveHost(h, { cacheUsage: 'disallowed' })
          return 'ok'
        } catch (error) {
          return String(error)
        }
      }, host)
    expect(await resolve('example.org')).not.toBe('ok')
    await settings.locator('.settings-secure-dns').selectOption('off')
    await expect.poll(privacy).toMatchObject({ secureDns: 'off' })
    const online = await lookup('example.org').then(
      () => true,
      () => false,
    )
    if (online) expect(await resolve('example.org')).toBe('ok')

    await settings.locator('.settings-https-only').selectOption('on')
    await expect.poll(privacy).toMatchObject({ httpsOnly: true })
    await expect(settings.locator('.settings-restart')).toHaveCount(0)
    await settings.locator('.settings-third-party').selectOption('allow')
    await expect.poll(privacy).toMatchObject({ blockThirdPartyCookies: false })
    await expect(settings.locator('.settings-restart')).toBeVisible()
    await settings.locator('.settings-third-party').selectOption('block')
    await expect(settings.locator('.settings-restart')).toHaveCount(0)
    await settings.locator('.settings-gpc').selectOption('off')
    await expect.poll(privacy).toMatchObject({ gpc: false })
  } finally {
    await app.close()
  }
})

test('HTTPS-Only upgrades http, explains a failed upgrade and continues over http for the session', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-https-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ privacy: { httpsOnly: true } }))
  const site = await serve({
    '/page.html': '<title>Plain flock</title><p>plain</p>',
    '/next.html': '<title>Next flock</title>',
    '/local.html': '<title>Local</title><iframe src="http://flock.example/frame.html"></iframe>',
    '/frame.html': '<title>Frame</title>',
  })
  const app = await launch(userData, {}, [
    `--host-resolver-rules=MAP flock.example 127.0.0.1:${site.port}`,
  ])
  try {
    const shell = await shellOf(app)
    await visit(shell, `${site.url}/local.html`)
    await new Promise((r) => setTimeout(r, 1000))
    expect(site.requests.some((r) => r.path === '/frame.html')).toBe(false)

    await send(shell, { type: 'tab.navigate', input: 'http://flock.example/page.html' })
    await expect
      .poll(() => activeUrl(shell), { timeout: 15_000 })
      .toContain('app://sad/?kind=https-only')
    const url = (await activeUrl(shell)) ?? ''
    expect(new URL(url).searchParams.get('url')).toBe('http://flock.example/page.html')
    const sad = await windowWith(app, 'app://sad/')
    await expect(sad.locator('.https-only .empty-title')).toHaveText(
      'flock.example has no secure connection',
    )
    expect(site.requests.some((r) => r.path === '/page.html')).toBe(false)
    await sad.locator('.https-continue').click()
    await expect.poll(() => activeUrl(shell)).toBe('http://flock.example/page.html')
    await expect
      .poll(() =>
        shell.evaluate(async () => {
          const s = await window.ewe.getState()
          return s?.tabs.find((t) => t.id === s.activeTabId)?.title
        }),
      )
      .toBe('Plain flock')
    await visit(shell, 'http://flock.example/next.html')
    expect(site.requests.filter((r) => r.path === '/next.html')).toHaveLength(1)
  } finally {
    await app.close()
    site.close()
  }
})

test('third-party cookies are blocked by Chromium itself, and GPC is sent and exposed', async () => {
  for (const blocked of [true, false]) {
    const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-cookies-'))
    if (!blocked)
      writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({ privacy: { blockThirdPartyCookies: false, gpc: false } }),
      )
    let port = 0
    const site = await serve({
      '/top.html': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`<title>Top</title><iframe src="http://localhost:${port}/frame.html"></iframe>`)
      },
      '/frame.html': (_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/html',
          'set-cookie': 'tp=1; SameSite=None; Secure; Path=/',
        })
        res.end("<script>document.cookie = 'js=1; SameSite=None; Secure; path=/'</script>")
      },
      '/first.html': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'fp=1; Path=/' })
        res.end('<title>First</title>')
      },
    })
    port = site.port
    const app = await launch(userData)
    try {
      const shell = await shellOf(app)
      await visit(shell, `${site.url}/top.html`)
      await expect.poll(() => site.requests.some((r) => r.path === '/frame.html')).toBe(true)
      await new Promise((r) => setTimeout(r, 500))
      const names = () =>
        app.evaluate(async ({ session }, p) => {
          const all = await session
            .fromPartition('persist:default')
            .cookies.get({ url: `http://localhost:${p}/` })
          return all.map((c) => c.name).sort()
        }, port)
      expect(await names()).toEqual(blocked ? [] : ['js', 'tp'])
      await visit(shell, `http://localhost:${port}/first.html`)
      await expect.poll(names).toEqual(blocked ? ['fp'] : ['fp', 'js', 'tp'])
      const gpc = site.requests.filter((r) => r.path === '/top.html').map((r) => r.gpc)
      expect(gpc).toEqual([blocked ? '1' : null])
      expect(await inPage<unknown>(app, 'navigator.globalPrivacyControl')).toBe(
        blocked ? true : undefined,
      )
    } finally {
      await app.close()
      site.close()
    }
  }
})
