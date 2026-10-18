import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const MAIN = join(__dirname, '../../out/main/index.js')
const SAFED = process.env.EWE_SAFED_BIN
const SAFE = process.env.EWE_SAFE_BIN
const MASTER = 'master-password-1'

interface Sandbox {
  env: Record<string, string>
  socket: string
  daemon: ChildProcess
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'ewe-safe-e2e-'))
  const dirs = ['runtime', 'state', 'data', 'config', 'bin']
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true })
  chmodSync(join(root, 'runtime'), 0o700)
  const fakeConf = join(root, 'bin', 'ewe-conf')
  writeFileSync(
    fakeConf,
    '#!/bin/sh\nif [ "$1" = get ] && [ "$2" = safe ]; then echo \'{"confirm_cards": false}\'; elif [ "$1" = get ]; then echo null; else echo \'{"ok": true}\'; fi\n',
  )
  chmodSync(fakeConf, 0o755)
  const socket = join(root, 'runtime', 'ewe-safe.sock')
  const env = {
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
    XDG_RUNTIME_DIR: join(root, 'runtime'),
    XDG_STATE_HOME: join(root, 'state'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_CONFIG_HOME: join(root, 'config'),
    EWE_SAFE_SOCKET: socket,
    EWE_SAFE_NO_LOGIND: '1',
    EWE_SAFE_KDF_ITERATIONS: '2',
  }
  const daemon = spawn(SAFED ?? 'ewe-safed', [], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  })
  return { env, socket, daemon }
}

function cli(sb: Sandbox, args: string[], input?: string): Record<string, unknown> {
  const out = execFileSync(SAFE ?? 'ewe-safe', args, {
    env: { ...process.env, ...sb.env },
    input: input ?? '',
    encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as Record<string, unknown>
}

interface Served {
  server: Server
  origin: string
}

function serve(host: string, pages: Record<string, string>): Promise<Served> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const body = pages[path] ?? pages[`${req.method ?? 'GET'} ${path}`]
    if (body === undefined) {
      res.writeHead(404).end()
      return
    }
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
    })
  })
  return new Promise((resolve) =>
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, origin: `http://${host}:${String(port)}` })
    }),
  )
}

const html = (body: string) =>
  `<!doctype html><html><body style="font:16px sans-serif;margin:40px">${body}</body></html>`

const LOGIN_FORM = (extra = '') => `<form method="post" action="/welcome">
  <p><input id="user" name="username" placeholder="Username" ${extra} style="width:320px;height:32px"></p>
  <p><input id="pass" name="password" type="password" placeholder="Password" style="width:320px;height:32px"></p>
  <p><button id="go" type="submit">Sign in</button></p></form>`

const SIGNUP_FORM = `<form method="post" action="/welcome" id="register">
  <p><input id="user" name="username" style="width:320px;height:32px"></p>
  <p><input id="pass" name="password" type="password" style="width:320px;height:32px"></p>
  <p><input id="confirm" name="confirm" type="password" style="width:320px;height:32px"></p>
  <p><button id="go" type="submit">Create account</button></p></form>`

const ADDRESS_FORM = `<form onsubmit="return false">
  <p><input id="name" autocomplete="name" style="width:320px;height:32px"></p>
  <p><input id="line1" autocomplete="address-line1" style="width:320px;height:32px"></p>
  <p><input id="city" autocomplete="address-level2" style="width:320px;height:32px"></p>
  <p><select id="country" autocomplete="country"><option value="">-</option>
    <option value="GE">Georgia</option></select></p></form>`

const CARD_FORM = `<form onsubmit="return false">
  <p><input id="cname" autocomplete="cc-name" style="width:320px;height:32px"></p>
  <p><input id="num" autocomplete="cc-number" style="width:320px;height:32px"></p>
  <p><input id="exp" autocomplete="cc-exp" placeholder="MM/YY" style="width:320px;height:32px"></p>
  <p><input id="csc" autocomplete="cc-csc" style="width:320px;height:32px"></p></form>`

async function windowWith(app: ElectronApplication, part: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((w) => w.url().includes(part)), { timeout: 20_000 })
    .toBe(true)
  const page = app.windows().find((w) => w.url().includes(part))
  if (page === undefined) throw new Error(`window ${part} not found`)
  await page.waitForLoadState('domcontentloaded')
  return page
}

async function open(app: ElectronApplication, shell: Page, url: string): Promise<Page> {
  await shell.evaluate((u) => window.ewe.send({ type: 'tab.navigate', input: u }), url)
  const page = await windowWith(app, url)
  await page.waitForLoadState('load')
  await page.waitForTimeout(400)
  return page
}

async function menuItems(app: ElectronApplication): Promise<string[]> {
  const overlay = await windowWith(app, '/ui/overlay/')
  await expect
    .poll(() => overlay.locator('.safe-suggest .safe-row').count(), { timeout: 10_000 })
    .toBeGreaterThan(0)
  return overlay.locator('.safe-suggest .safe-row').allInnerTexts()
}

async function pick(app: ElectronApplication, text: string): Promise<void> {
  const overlay = await windowWith(app, '/ui/overlay/')
  await overlay.waitForTimeout(650)
  await overlay.locator('.safe-suggest .safe-row').filter({ hasText: text }).first().click()
}

async function pickFirst(app: ElectronApplication, page: Page): Promise<void> {
  const overlay = await windowWith(app, '/ui/overlay/')
  const first = overlay.locator('.safe-suggest .safe-row').first()
  const on = () => first.evaluate((el) => el.classList.contains('active')).catch(() => false)
  await page.waitForTimeout(300)
  for (let i = 0; i < 6 && !(await on()); i++) {
    await page.keyboard.press('ArrowDown')
    await expect
      .poll(on, { timeout: 800 })
      .toBe(true)
      .catch(() => undefined)
  }
  expect(await on()).toBe(true)
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
}

async function promptButton(app: ElectronApplication, text: string): Promise<void> {
  const overlay = await windowWith(app, '/ui/overlay/')
  const button = overlay.locator('.safe-prompt button').filter({ hasText: text })
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
}

function logins(sb: Sandbox): { title: string; username: string; urls: string[] }[] {
  const reply = cli(sb, ['list', '--kind', 'login'])
  return (reply.items ?? []) as { title: string; username: string; urls: string[] }[]
}

test.describe('Safe in ewe browser', () => {
  test.skip(SAFED === undefined || SAFE === undefined, 'needs EWE_SAFED_BIN and EWE_SAFE_BIN')

  let sb: Sandbox
  let a: Served
  let b: Served
  let app: ElectronApplication
  let shell: Page
  let wallet = false

  test.beforeAll(async () => {
    sb = sandbox()
    await expect.poll(() => existsSync(sb.socket), { timeout: 10_000 }).toBe(true)
    b = await serve('localhost', {
      '/inner': html(`<h3>Partner sign in</h3>${LOGIN_FORM()}`),
      '/address': html(`<h2>Shipping</h2>${ADDRESS_FORM}`),
      '/card': html(`<h2>Pay</h2>${CARD_FORM}`),
    })
    a = await serve('127.0.0.1', {
      '/login': html(`<h2>Sign in</h2>${LOGIN_FORM()}`),
      '/autofocus': html(`<h2>Sign in</h2>${LOGIN_FORM('autofocus')}`),
      '/signup': html(`<h2>Create account</h2>${SIGNUP_FORM}`),
      '/card': html(`<h2>Pay</h2>${CARD_FORM}`),
      '/frame': html(
        `<h2>Embeds a partner</h2><iframe src="${b.origin}/inner" style="width:520px;height:300px;border:1px solid #888"></iframe>`,
      ),
      'POST /welcome': html('<h2 id="welcome">Welcome</h2>'),
    })
    expect(cli(sb, ['init', '--place', 'local'], `${MASTER}\n${MASTER}\n`).ok).toBe(true)
    const add = (title: string, username: string, url: string, password: string) =>
      cli(
        sb,
        [
          'add',
          '--kind',
          'login',
          '--title',
          title,
          '--username',
          username,
          '--url',
          url,
          '--password-stdin',
        ],
        `${password}\n`,
      )
    expect(add('Fixture A', 'sam', a.origin, 'pw-A-123').ok).toBe(true)
    expect(add('Partner B', 'bob', b.origin, 'pw-B-456').ok).toBe(true)
    const home = cli(sb, [
      'add',
      '--kind',
      'address',
      '--title',
      'Home',
      '--full-name',
      'Sam Moe',
      '--line1',
      '12 Main St',
      '--city',
      'Tbilisi',
      '--country',
      'GE',
    ])
    const card = cli(
      sb,
      ['add', '--kind', 'card', '--holder', 'Sam Moe', '--expiry', '08/29', '--card-stdin'],
      '4242424242424242\n123\n\n',
    )
    wallet = home.ok === true && card.ok === true
    const user = mkdtempSync(join(tmpdir(), 'ewe-safe-browser-'))
    app = await electron.launch({
      args: [MAIN],
      env: {
        ...process.env,
        EWE_USER_DATA: user,
        EWE_SAFE_SOCKET: sb.socket,
        EWE_SAFE_BIN: SAFE ?? '',
        EWE_SAFE_KDF_ITERATIONS: '2',
        EWE_SAFE_ASK_CMD: `printf '%s\\n' '${MASTER}' | '${SAFE ?? 'ewe-safe'}' unlock`,
      },
    })
    shell = await windowWith(app, '/ui/shell/')
    await shell.waitForFunction(() => typeof window.ewe === 'object')
  })

  test.afterAll(async () => {
    await app.close()
    sb.daemon.kill()
    a.server.close()
    b.server.close()
  })

  test('never fills on page load, even with an autofocused field', async () => {
    const page = await open(app, shell, `${a.origin}/autofocus`)
    await page.waitForTimeout(1500)
    expect(await page.inputValue('#user')).toBe('')
    expect(await page.inputValue('#pass')).toBe('')
  })

  test('a click into the field lists the site logins and fills the picked one', async () => {
    const page = await open(app, shell, `${a.origin}/login`)
    await page.click('#user')
    const items = await menuItems(app)
    expect(items.some((t) => t.includes('Fixture A'))).toBe(true)
    expect(items.some((t) => t.includes('Partner B'))).toBe(false)
    await pick(app, 'Fixture A')
    await expect.poll(() => page.inputValue('#user')).toBe('sam')
    await expect.poll(() => page.inputValue('#pass')).toBe('pw-A-123')
  })

  test('a cross-origin frame matches by its own origin only', async () => {
    const page = await open(app, shell, `${a.origin}/frame`)
    const frame = page.frameLocator('iframe')
    await frame.locator('#user').click()
    const items = await menuItems(app)
    expect(items.some((t) => t.includes('Fixture A'))).toBe(false)
    expect(items.some((t) => t.includes('Partner B'))).toBe(true)
    await pick(app, 'Partner B')
    await expect.poll(() => frame.locator('#user').inputValue()).toBe('bob')
    await expect.poll(() => frame.locator('#pass').inputValue()).toBe('pw-B-456')
  })

  test('a sign-up offers a strong password and then saves the new login', async () => {
    const page = await open(app, shell, `${a.origin}/signup`)
    await page.fill('#user', 'newbie')
    await page.click('#pass')
    expect((await menuItems(app)).some((t) => t.includes('Use a strong password'))).toBe(true)
    await pick(app, 'Use a strong password')
    await expect
      .poll(async () => (await page.inputValue('#pass')).length)
      .toBeGreaterThanOrEqual(20)
    const generated = await page.inputValue('#pass')
    expect(await page.inputValue('#confirm')).toBe(generated)
    await page.click('#go')
    await promptButton(app, 'Save')
    await expect
      .poll(() => logins(sb).some((l) => l.username === 'newbie' && l.urls.includes(a.origin)))
      .toBe(true)
    const id = (
      cli(sb, ['list', '--kind', 'login']).items as { id: string; username: string }[]
    ).find((l) => l.username === 'newbie')?.id
    expect(cli(sb, ['reveal', id ?? '', '--field', 'password', '--json']).value).toBe(generated)
  })

  test('a changed password offers an update', async () => {
    const page = await open(app, shell, `${a.origin}/login`)
    await page.fill('#user', 'sam')
    await page.fill('#pass', 'pw-A-changed')
    await page.click('#go')
    await promptButton(app, 'Update')
    const id = (cli(sb, ['list', '--kind', 'login']).items as { id: string; title: string }[]).find(
      (l) => l.title === 'Fixture A',
    )?.id
    await expect
      .poll(() => cli(sb, ['reveal', id ?? '', '--field', 'password', '--json']).value)
      .toBe('pw-A-changed')
  })

  test('the same login again asks nothing', async () => {
    const page = await open(app, shell, `${a.origin}/login`)
    await page.fill('#user', 'sam')
    await page.fill('#pass', 'pw-A-changed')
    await page.click('#go')
    await page.waitForSelector('#welcome')
    await page.waitForTimeout(3500)
    const overlay = await windowWith(app, '/ui/overlay/')
    expect(await overlay.locator('.safe-prompt').count()).toBe(0)
  })

  test('a locked safe offers Unlock Safe and then the logins', async () => {
    expect(cli(sb, ['lock']).ok).toBe(true)
    const page = await open(app, shell, `${a.origin}/login`)
    await page.click('#user')
    expect((await menuItems(app)).some((t) => t.includes('Unlock Safe'))).toBe(true)
    await pick(app, 'Unlock Safe')
    await expect
      .poll(async () => (await menuItems(app)).some((t) => t.includes('Fixture A')), {
        timeout: 20_000,
      })
      .toBe(true)
    await pick(app, 'Fixture A')
    await expect.poll(() => page.inputValue('#pass')).toBe('pw-A-changed')
  })

  test('a locked safe still asks to save a sign-up: Unlock and save', async () => {
    expect(cli(sb, ['lock']).ok).toBe(true)
    const page = await open(app, shell, `${a.origin}/signup`)
    await page.fill('#user', 'lockie')
    await page.fill('#pass', 'Locked-pw-9')
    await page.fill('#confirm', 'Locked-pw-9')
    await page.click('#go')
    const overlay = await windowWith(app, '/ui/overlay/')
    const button = overlay.locator('.safe-prompt .safe-prompt-save')
    await expect(button).toHaveText('Unlock and save', { timeout: 10_000 })
    await button.click()
    await expect
      .poll(() => logins(sb).some((l) => l.username === 'lockie' && l.urls.includes(a.origin)), {
        timeout: 20_000,
      })
      .toBe(true)
  })

  test('an address fills from the real Safe', async () => {
    test.skip(!wallet, 'this ewe-safe has no cards or addresses')
    const page = await open(app, shell, `${b.origin}/address`)
    await page.click('#line1')
    expect((await menuItems(app)).some((t) => t.includes('Home'))).toBe(true)
    await pickFirst(app, page)
    await expect.poll(() => page.inputValue('#line1')).toBe('12 Main St')
    expect(await page.inputValue('#name')).toBe('Sam Moe')
    expect(await page.inputValue('#city')).toBe('Tbilisi')
    expect(await page.inputValue('#country')).toBe('GE')
  })

  test('a card fills from the real Safe on localhost, never on another http page', async () => {
    test.skip(!wallet, 'this ewe-safe has no cards or addresses')
    const page = await open(app, shell, `${b.origin}/card`)
    await page.click('#num')
    expect((await menuItems(app)).some((t) => t.includes('Visa •••• 4242'))).toBe(true)
    await pickFirst(app, page)
    await expect.poll(() => page.inputValue('#num')).toBe('4242424242424242')
    expect(await page.inputValue('#exp')).toBe('08/29')
    expect(await page.inputValue('#csc')).toBe('123')
    expect(await page.inputValue('#cname')).toBe('Sam Moe')
    const plain = await open(app, shell, `${a.origin}/card`)
    await plain.click('#num')
    await plain.keyboard.press('ArrowDown')
    expect(await menuItems(app)).toEqual(['Safe fills cards only on secure (https) pages'])
    expect(await plain.inputValue('#num')).toBe('')
  })
})
