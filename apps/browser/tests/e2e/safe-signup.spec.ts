import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
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
import { startFakeSafe, writeFakeCli, type FakeSafe } from '../fake-safed'

const MAIN = join(__dirname, '../../out/main/index.js')

interface Served {
  server: Server
  origin: string
  host: string
}

const html = (body: string, title = 'Test') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="data:,"></head><body style="font:16px sans-serif;margin:40px">${body}</body></html>`

const box = 'style="width:320px;height:32px"'

function serve(
  host: string,
  pages: (origin: () => string) => Record<string, string>,
): Promise<Served> {
  let table: Record<string, string> = {}
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const body = table[`${req.method ?? 'GET'} ${path}`] ?? table[path]
    req.resume()
    req.on('end', () => {
      if (body === undefined) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
    })
  })
  return new Promise((resolve) =>
    server.listen(0, host, () => {
      const a = server.address()
      const port = typeof a === 'object' && a !== null ? a.port : 0
      const origin = `http://${host}:${String(port)}`
      table = pages(() => origin)
      resolve({ server, origin, host: `${host}:${String(port)}` })
    }),
  )
}

const SIGNUP = `<h2>Create account</h2><form method="post" action="/welcome">
  <p><input id="name" name="full_name" placeholder="Your name" ${box}></p>
  <p><input id="email" type="email" name="email" placeholder="Email" ${box}></p>
  <p><input id="pass" type="password" name="password" placeholder="Password" ${box}></p>
  <p><input id="confirm" type="password" name="confirm" placeholder="Repeat password" ${box}></p>
  <p><button id="go" type="submit">Create account</button></p></form>`

const STEP1 = `<h2>Sign up</h2><form method="get" action="/step2">
  <p><input id="email" type="email" name="identifier" placeholder="Email" ${box}></p>
  <p><button id="next" type="submit">Next</button></p></form>`

const STEP2 = `<h2>Choose a password</h2><form method="post" action="/welcome">
  <p><input id="pass" type="password" autocomplete="new-password" ${box}></p>
  <p><input id="confirm" type="password" autocomplete="new-password" ${box}></p>
  <p><button id="go" type="submit">Create account</button></p></form>`

const SPA = `<h1>Join</h1><div id="app"><div id="form">
  <p><input id="email" type="email" placeholder="Email" ${box}></p>
  <p><input id="pass" type="password" autocomplete="new-password" ${box}></p>
  <p><input id="confirm" type="password" autocomplete="new-password" ${box}></p>
  <p><span id="go" style="display:inline-block;padding:8px;border:1px solid">Go</span></p></div></div>
  <script>document.getElementById('go').addEventListener('click', () => {
    setTimeout(() => {
      history.pushState({}, '', '/spa/welcome')
      document.getElementById('form').remove()
      document.getElementById('app').innerHTML = '<h2 id="welcome">Welcome</h2>'
    }, 50)
  })</script>`

const GEN = `<h2>Create account</h2><form onsubmit="return false">
  <p><input id="email" type="email" name="email" ${box}></p>
  <p><input id="pass" type="password" autocomplete="new-password" ${box}></p>
  <p><input id="confirm" type="password" autocomplete="new-password" ${box}></p></form>`

const ADDRESS = `<h2>Shipping</h2><form onsubmit="return false">
  <p><input id="given" autocomplete="given-name" placeholder="First name" ${box}></p>
  <p><input id="family" autocomplete="family-name" placeholder="Last name" ${box}></p>
  <p><input id="line1" autocomplete="address-line1" placeholder="Street" ${box}></p>
  <p><input id="city" autocomplete="address-level2" placeholder="City" ${box}></p>
  <p><input id="zip" autocomplete="postal-code" maxlength="4" placeholder="Postal code" ${box}></p>
  <p><select id="country" autocomplete="country"><option value="">Country</option>
    <option value="DE">Germany</option><option value="GE">Georgia</option></select></p>
  <p><input id="email" type="email" autocomplete="email" placeholder="Email" ${box}></p></form>`

const CARD = `<h2>Pay</h2><form onsubmit="return false">
  <p><input id="cname" autocomplete="cc-name" placeholder="Name on card" ${box}></p>
  <p><input id="num" autocomplete="cc-number" inputmode="numeric" placeholder="Card number" ${box}></p>
  <p><input id="exp" autocomplete="cc-exp" placeholder="MM / YY" ${box}></p>
  <p><input id="csc" autocomplete="cc-csc" maxlength="4" placeholder="CVC" ${box}></p></form>`

const PAY_FRAME = `<input id="num" autocomplete="cc-number" placeholder="1234 1234 1234 1234" ${box}>`

const WELCOME = '<h2 id="welcome">Welcome</h2>'

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
  await expect
    .poll(() => app.windows().some((w) => w.url() === url), { timeout: 20_000 })
    .toBe(true)
  const page = app.windows().find((w) => w.url() === url)
  if (page === undefined) throw new Error(`no page ${url}`)
  await page.waitForLoadState('load')
  await page.waitForTimeout(400)
  return page
}

const overlayOf = (app: ElectronApplication) => windowWith(app, '/ui/overlay/')

async function rows(app: ElectronApplication): Promise<string[]> {
  const overlay = await overlayOf(app)
  return overlay.locator('.safe-suggest .safe-row').allInnerTexts()
}

async function waitRows(app: ElectronApplication): Promise<string[]> {
  await expect.poll(async () => (await rows(app)).length, { timeout: 10_000 }).toBeGreaterThan(0)
  return rows(app)
}

async function pickFirst(app: ElectronApplication, page: Page): Promise<void> {
  const overlay = await overlayOf(app)
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

function overlayVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const view = (win?.contentView.children ?? []).find(
      (v): v is Electron.WebContentsView =>
        v instanceof WebContentsView && v.webContents.getURL().includes('/ui/overlay/'),
    )
    return view?.getVisible() ?? false
  })
}

async function prompt(app: ElectronApplication) {
  const overlay = await overlayOf(app)
  const card = overlay.locator('.safe-prompt')
  await expect(card).toBeVisible({ timeout: 15_000 })
  return card
}

const adds = (fake: FakeSafe) => fake.calls.filter((c) => c.verb === 'add').map((c) => c.args)

test.describe('Safe: sign-ups, cards and addresses', () => {
  test.describe.configure({ mode: 'serial' })
  let dir: string
  let fake: FakeSafe
  let a: Served
  let b: Served
  let c: Served
  let app: ElectronApplication
  let shell: Page
  let log: string
  let refuse: string

  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ewe-b3-'))
    fake = await startFakeSafe(join(dir, 's.sock'))
    log = join(dir, 'cli.log')
    refuse = join(dir, 'refuse')
    b = await serve('localhost', () => ({ '/pay-frame': html(PAY_FRAME) }))
    a = await serve('localhost', () => ({
      '/signup': html(SIGNUP),
      '/step1': html(STEP1),
      '/step2': html(STEP2),
      '/spa': html(SPA),
      '/gen': html(GEN),
      '/address': html(ADDRESS),
      '/card': html(CARD),
      '/pay': html(
        `<h2>Pay</h2><p><input id="cname" autocomplete="cc-name" placeholder="Name on card" ${box}></p>
        <iframe src="${b.origin}/pay-frame" style="width:420px;height:80px;border:1px solid #888"></iframe>`,
      ),
      '/welcome': html(WELCOME),
      'POST /welcome': html(WELCOME),
    }))
    c = await serve('127.0.0.1', () => ({ '/card': html(CARD) }))
    fake.addLogin('Shop', 'old@shop.test', a.origin, 'old-pw')
    fake.addCard('Visa •• 4242', {
      holder: 'Sam Moe',
      number: '4242424242424242',
      expiry: '08/2029',
      security_code: '123',
      pin: '9876',
      brand: 'visa',
    })
    fake.addAddress('Home', {
      full_name: 'Sam Moe',
      organization: '',
      line1: '12 Main St',
      line2: '',
      city: 'Tbilisi',
      region: '',
      postal_code: '0105',
      country: 'GE',
      phone: '',
      email: 'sam@example.com',
    })
    const cli = writeFakeCli(dir)
    app = await electron.launch({
      args: [MAIN],
      env: {
        ...process.env,
        EWE_USER_DATA: join(dir, 'profile'),
        EWE_SAFE_SOCKET: fake.path,
        EWE_SAFE_BIN: cli,
        EWE_SAFE_APP: '/nonexistent',
        EWE_FAKE_CLI_LOG: log,
        EWE_FAKE_CLI_REFUSE: refuse,
      },
    })
    shell = await windowWith(app, '/ui/shell/')
    await shell.waitForFunction(() => typeof window.ewe === 'object')
  })

  test.afterAll(async () => {
    await app.close()
    await fake.close()
    for (const s of [a, b, c]) s.server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const cliCalls = (): string[][] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter((l) => l !== '')
          .map((l) => JSON.parse(l) as string[])
      : []

  test('a sign-up with a confirm field asks to save a new login', async () => {
    const page = await open(app, shell, `${a.origin}/signup`)
    await page.fill('#name', 'Sam Moe')
    await page.fill('#email', 'sam@new.test')
    await page.fill('#pass', 'Signup-pw-1')
    await page.fill('#confirm', 'Signup-pw-1')
    await page.click('#go')
    const card = await prompt(app)
    await expect(card).toContainText('Save this login to Safe?')
    await expect(card).toContainText(`sam@new.test · ${a.host}`)
    await expect(card.locator('.safe-prompt-save')).toHaveText('Save')
    await expect(card.locator('.safe-prompt-never')).toHaveText('Never for this site')
    await card.locator('.safe-prompt-save').click()
    await expect.poll(() => adds(fake).length, { timeout: 10_000 }).toBe(1)
    expect(adds(fake)[0]).toEqual({
      kind: 'login',
      title: a.host,
      url: [a.origin],
      username: 'sam@new.test',
      password_value: 'Signup-pw-1',
    })
  })

  test('with Safe locked the prompt says Unlock and save, and saves after the unlock', async () => {
    fake.lock()
    const page = await open(app, shell, `${a.origin}/signup`)
    await page.fill('#email', 'bo@new.test')
    await page.fill('#pass', 'Signup-pw-2')
    await page.fill('#confirm', 'Signup-pw-2')
    await page.click('#go')
    const card = await prompt(app)
    await expect(card).toContainText('Save this login to Safe?')
    await expect(card).toContainText('Safe is locked')
    await expect(card.locator('.safe-prompt-save')).toHaveText('Unlock and save')
    await card.locator('.safe-prompt-save').click()
    await expect.poll(() => fake.locked, { timeout: 15_000 }).toBe(false)
    await expect.poll(() => adds(fake).length, { timeout: 10_000 }).toBe(2)
    expect(adds(fake)[1]).toMatchObject({ username: 'bo@new.test', password_value: 'Signup-pw-2' })
    expect(cliCalls()).toContainEqual(['unlock', '--ask'])
  })

  test('a multi-step sign-up saves the email typed on the first step', async () => {
    const page = await open(app, shell, `${a.origin}/step1`)
    await page.fill('#email', 'step@new.test')
    await page.click('#next')
    await page.waitForURL(/\/step2/)
    await page.waitForLoadState('load')
    await page.fill('#pass', 'Step-pw-3')
    await page.fill('#confirm', 'Step-pw-3')
    await page.click('#go')
    const card = await prompt(app)
    await expect(card).toContainText(`step@new.test · ${a.host}`)
    await card.locator('.safe-prompt-save').click()
    await expect.poll(() => adds(fake).length, { timeout: 10_000 }).toBe(3)
    expect(adds(fake)[2]).toMatchObject({ username: 'step@new.test', password_value: 'Step-pw-3' })
  })

  test('an app-style sign-up without a form submit still asks', async () => {
    const page = await open(app, shell, `${a.origin}/spa`)
    await page.fill('#email', 'spa@new.test')
    await page.fill('#pass', 'Spa-pw-4')
    await page.fill('#confirm', 'Spa-pw-4')
    await page.click('#go')
    await expect(page.locator('#welcome')).toBeVisible()
    const card = await prompt(app)
    await expect(card).toContainText(`spa@new.test · ${a.host}`)
    await card.locator('.safe-prompt-save').click()
    await expect.poll(() => adds(fake).length, { timeout: 10_000 }).toBe(4)
    expect(adds(fake)[3]).toMatchObject({ username: 'spa@new.test', password_value: 'Spa-pw-4' })
  })

  test('a strong password from Safe is offered when the tab moves on without a submit', async () => {
    const page = await open(app, shell, `${a.origin}/gen`)
    await page.fill('#email', 'gen@new.test')
    await page.click('#pass')
    expect(await waitRows(app)).toContain('Use a strong password')
    await pickFirst(app, page)
    await expect.poll(async () => (await page.inputValue('#pass')).length).toBeGreaterThan(10)
    const generated = await page.inputValue('#pass')
    expect(await page.inputValue('#confirm')).toBe(generated)
    await open(app, shell, `${a.origin}/welcome`)
    const card = await prompt(app)
    await expect(card).toContainText(`gen@new.test · ${a.host}`)
    await card.locator('.safe-prompt-save').click()
    await expect.poll(() => adds(fake).length, { timeout: 10_000 }).toBe(5)
    expect(adds(fake)[4]).toMatchObject({ username: 'gen@new.test', password_value: generated })
  })

  test('a strong password from Safe is offered when its tab closes', async () => {
    await shell.evaluate((u) => window.ewe.send({ type: 'tab.create', url: u }), `${a.origin}/gen`)
    await expect
      .poll(() => app.windows().filter((w) => w.url() === `${a.origin}/gen`).length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0)
    const page = app
      .windows()
      .filter((w) => w.url() === `${a.origin}/gen`)
      .at(-1)
    if (page === undefined) throw new Error('no gen tab')
    await page.waitForLoadState('load')
    await page.waitForTimeout(400)
    await page.fill('#email', 'closed@new.test')
    await page.click('#pass')
    expect(await waitRows(app)).toContain('Use a strong password')
    await pickFirst(app, page)
    await expect.poll(async () => (await page.inputValue('#pass')).length).toBeGreaterThan(10)
    const generated = await page.inputValue('#pass')
    const id = await shell.evaluate(async () => (await window.ewe.getState())?.activeTabId ?? null)
    if (id === null) throw new Error('no active tab')
    await shell.evaluate((tab) => window.ewe.send({ type: 'tab.close', id: tab }), id)
    const card = await prompt(app)
    await expect(card).toContainText(`closed@new.test · ${a.host}`)
    await card.locator('.safe-prompt-save').click()
    await expect.poll(() => adds(fake).length, { timeout: 10_000 }).toBe(6)
    expect(adds(fake)[5]).toMatchObject({ username: 'closed@new.test', password_value: generated })
  })

  test('an address form fills from the list', async () => {
    const page = await open(app, shell, `${a.origin}/address`)
    await page.click('#line1')
    expect(await waitRows(app)).toEqual(['Home\nSam Moe · 12 Main St', 'Open Safe'])
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('line1')
    await pickFirst(app, page)
    await expect.poll(() => page.inputValue('#line1')).toBe('12 Main St')
    expect(await page.inputValue('#given')).toBe('Sam')
    expect(await page.inputValue('#family')).toBe('Moe')
    expect(await page.inputValue('#city')).toBe('Tbilisi')
    expect(await page.inputValue('#zip')).toBe('0105')
    expect(await page.inputValue('#country')).toBe('GE')
    expect(await page.inputValue('#email')).toBe('sam@example.com')
    expect(cliCalls().some((c) => c[0] === 'confirm')).toBe(false)
  })

  test('a locked Safe offers Unlock Safe on an address field, then the addresses', async () => {
    fake.lock()
    const page = await open(app, shell, `${a.origin}/address`)
    await page.click('#city')
    expect(await waitRows(app)).toEqual(['Unlock Safe'])
    await pickFirst(app, page)
    await expect.poll(() => fake.locked, { timeout: 15_000 }).toBe(false)
    await expect
      .poll(async () => (await rows(app)).join('|'), { timeout: 15_000 })
      .toContain('Home')
    await page.keyboard.press('Escape')
  })

  test('a card fill asks to confirm first, then fills the card form', async () => {
    const before = fake.calls.filter((x) => x.verb === 'fields').length
    const page = await open(app, shell, `${a.origin}/card`)
    await page.click('#num')
    expect(await waitRows(app)).toEqual(['Visa •••• 4242\n08/29 · Sam Moe', 'Open Safe'])
    await pickFirst(app, page)
    await expect.poll(() => page.inputValue('#num'), { timeout: 15_000 }).toBe('4242424242424242')
    expect(await page.inputValue('#cname')).toBe('Sam Moe')
    expect(await page.inputValue('#exp')).toBe('08 / 29')
    expect(await page.inputValue('#csc')).toBe('123')
    expect(cliCalls()).toContainEqual([
      'confirm',
      '--ask',
      '--reason',
      `Fill Visa •• 4242 on ${a.host}`,
    ])
    expect(fake.calls.filter((x) => x.verb === 'fields')).toHaveLength(before + 2)
  })

  test('a payment frame from another site gets only its own field', async () => {
    const page = await open(app, shell, `${a.origin}/pay`)
    const frame = page.frameLocator('iframe')
    await frame.locator('#num').click()
    expect(await waitRows(app)).toContain('Visa •••• 4242\n08/29 · Sam Moe')
    await pickFirst(app, page)
    await expect.poll(() => frame.locator('#num').inputValue()).toBe('4242 4242 4242 4242')
    expect(await page.inputValue('#cname')).toBe('')
    expect(cliCalls().filter((x) => x[0] === 'confirm')).toHaveLength(1)
  })

  test('a refused confirm fills nothing', async () => {
    writeFileSync(refuse, '')
    try {
      fake.clearConfirm()
      const page = await open(app, shell, `${a.origin}/card`)
      await page.click('#num')
      await waitRows(app)
      await pickFirst(app, page)
      await expect.poll(() => cliCalls().filter((x) => x[0] === 'confirm').length).toBe(2)
      await page.waitForTimeout(800)
      expect(await page.inputValue('#num')).toBe('')
      expect(await page.inputValue('#csc')).toBe('')
    } finally {
      unlinkSync(refuse)
    }
  })

  test('no card fill into an http page that is not localhost', async () => {
    const before = fake.calls.filter((x) => x.verb === 'fields').length
    const page = await open(app, shell, `${c.origin}/card`)
    await page.click('#num')
    await page.waitForTimeout(1200)
    expect(await overlayVisible(app)).toBe(false)
    await page.keyboard.press('ArrowDown')
    expect(await waitRows(app)).toEqual(['Safe fills cards only on secure (https) pages'])
    await page.keyboard.press('Escape')
    expect(await page.inputValue('#num')).toBe('')
    expect(fake.calls.filter((x) => x.verb === 'fields')).toHaveLength(before)
  })
})
