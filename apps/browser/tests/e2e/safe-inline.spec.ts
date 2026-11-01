import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Frame,
  type Page,
} from '@playwright/test'
import { FAKE_MASTER, startFakeSafe, type FakeSafe } from '../fake-safed'
import { verifyAssertion, verifyRegistration, type Stored } from '../webauthn-rp'

const MAIN = join(__dirname, '../../out/main/index.js')
const GUARD_MS = 650

interface Served {
  server: Server
  origin: string
  port: number
}

function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let text = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (text += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}') as Record<string, unknown>)
      } catch {
        resolve({})
      }
    })
  })
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, 'localhost', () => {
      const a = server.address()
      resolve(typeof a === 'object' && a !== null ? a.port : 0)
    }),
  )
}

const CLIENT = `
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
async function post(path, data) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data ?? {}) })
  return r.json()
}
function failed(e) { return { error: e && e.name, message: e && e.message } }
window.register = async (extra) => {
  try {
    const o = await post('/options/create', extra)
    const options = { publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(o) }
    if (window.__abort) options.signal = window.__abort.signal
    const cred = await navigator.credentials.create(options)
    const verdict = await post('/verify/register', cred.toJSON())
    return {
      verdict,
      isCredential: cred instanceof PublicKeyCredential,
      isAttestation: cred.response instanceof AuthenticatorAttestationResponse,
      transports: cred.response.getTransports(),
      alg: cred.response.getPublicKeyAlgorithm(),
      spki: cred.response.getPublicKey().byteLength,
      rawIdMatches: b64(cred.rawId) === cred.id,
      attachment: cred.authenticatorAttachment,
      ext: cred.getClientExtensionResults(),
    }
  } catch (e) { return failed(e) }
}
window.signIn = async () => {
  try {
    const o = await post('/options/get')
    const options = { publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(o) }
    if (window.__abort) options.signal = window.__abort.signal
    const cred = await navigator.credentials.get(options)
    const verdict = await post('/verify/login', cred.toJSON())
    return { verdict, isAssertion: cred.response instanceof AuthenticatorAssertionResponse }
  } catch (e) { return failed(e) }
}
`

const html = (head: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">${head}</head><body style="font:16px sans-serif;margin:40px">${body}</body></html>`

const FORM = (user = '') => `<form method="post" action="/welcome" onsubmit="return false">
  <p><input id="user" name="username" placeholder="Username" ${user} style="width:320px;height:32px"></p>
  <p><input id="pass" name="password" type="password" autocomplete="current-password" placeholder="Password" style="width:320px;height:32px"></p>
  <p><button id="go" type="submit">Sign in</button></p></form>`

const CONDITIONAL = `
(async () => {
  const status = (t) => { document.getElementById('status').textContent = t }
  if (!(await PublicKeyCredential.isConditionalMediationAvailable())) return status('no conditional')
  const o = await post('/options/get')
  try {
    const cred = await navigator.credentials.get({ mediation: 'conditional', publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(o) })
    const r = await post('/verify/login', cred.toJSON())
    status(r.ok ? 'signed in as ' + r.user : 'failed: ' + r.error)
  } catch (e) { status('error: ' + e.name) }
})()
`

const EARLY = `<script>
window.__early = { createSrc: String(navigator.credentials.create).includes('[native code]') }
PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then((v) => { window.__early.uvpaa = v })
PublicKeyCredential.isConditionalMediationAvailable().then((v) => { window.__early.cma = v })
</script>`

interface Rp {
  served: Served
  frame: Served
  stored: Stored[]
  users: Map<string, string>
}

async function startRp(): Promise<Rp> {
  const issued = new Set<string>()
  const stored: Stored[] = []
  const users = new Map<string, string>()
  const frameServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      html(
        `<script>window.tryCreate = async () => { try { await navigator.credentials.create({ publicKey: { challenge: new Uint8Array(16), rp: { name: 'x' }, user: { id: new Uint8Array(4), name: 'x', displayName: 'x' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } }); return 'created' } catch (e) { return e.name } }</script>`,
        '<p>inner</p>',
      ),
    )
  })
  const framePort = await listen(frameServer)
  const frame: Served = {
    server: frameServer,
    port: framePort,
    origin: `http://localhost:${String(framePort)}`,
  }
  const rp = { served: null as unknown as Served, frame, stored, users }
  const origin = () => rp.served.origin
  const challenge = () => {
    const c = randomBytes(32).toString('base64url')
    issued.add(c)
    return c
  }
  const takeChallenge = (cred: Record<string, unknown>): string => {
    const response = cred.response as Record<string, unknown>
    const data = JSON.parse(
      Buffer.from(String(response.clientDataJSON), 'base64url').toString(),
    ) as {
      challenge: string
    }
    if (!issued.delete(data.challenge)) throw new Error('challenge was not issued')
    return data.challenge
  }
  const pages: Record<string, string> = {
    '/register': html(`<script>${CLIENT}</script>`, '<h2>Register</h2>'),
    '/early': html(`${EARLY}<script>${CLIENT}</script>`, '<h2>Early</h2>'),
    '/login': html(
      `<script>${CLIENT}</script>`,
      `<h2>Sign in</h2>${FORM('autocomplete="username webauthn"')}<p id="status">waiting</p><script>${CONDITIONAL}</script>`,
    ),
    '/plain': html('', `<h2>Plain</h2>${FORM()}`),
    '/autofocus': html(
      '',
      `<h2>Autofocus</h2>${FORM('autofocus')}<script>document.getElementById('user').focus()</script>`,
    ),
    '/frame': html(
      '',
      `<iframe src="${frame.origin}/inner" style="width:420px;height:120px"></iframe>`,
    ),
  }
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      const json = (value: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (req.method === 'POST') {
        const data = await body(req)
        if (path === '/options/create')
          return json({
            challenge: challenge(),
            rp: { id: 'localhost', name: 'Test RP' },
            user: {
              id: Buffer.from(typeof data.userId === 'string' ? data.userId : 'user-1').toString(
                'base64url',
              ),
              name: typeof data.name === 'string' ? data.name : 'sam@example.com',
              displayName: 'Sam',
            },
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 },
              { type: 'public-key', alg: -257 },
            ],
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            attestation: 'none',
            excludeCredentials:
              data.exclude === true
                ? stored.map((s) => ({ type: 'public-key', id: s.credentialId }))
                : [],
            extensions: { credProps: true },
            timeout: 60_000,
          })
        if (path === '/options/get')
          return json({
            challenge: challenge(),
            rpId: 'localhost',
            userVerification: 'required',
            timeout: 60_000,
          })
        if (path === '/verify/register') {
          try {
            const c = takeChallenge(data)
            const s = verifyRegistration(data, {
              challenge: c,
              origin: origin(),
              rpId: 'localhost',
            })
            stored.push(s)
            users.set(s.credentialId, 'sam')
            return json({ ok: true })
          } catch (e) {
            return json({ ok: false, error: (e as Error).message })
          }
        }
        if (path === '/verify/login') {
          try {
            const c = takeChallenge(data)
            const s = stored.find((x) => x.credentialId === data.id)
            if (s === undefined) throw new Error('unknown credential')
            verifyAssertion(data, s, { challenge: c, origin: origin(), rpId: 'localhost' })
            return json({ ok: true, user: users.get(s.credentialId) ?? '' })
          } catch (e) {
            return json({ ok: false, error: (e as Error).message })
          }
        }
      }
      const page = pages[path]
      if (page === undefined) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page)
    })()
  })
  const port = await listen(server)
  rp.served = { server, port, origin: `http://localhost:${String(port)}` }
  return rp
}

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

async function suggestRows(app: ElectronApplication): Promise<string[]> {
  const overlay = await overlayOf(app)
  return overlay.locator('.safe-suggest .safe-row').allInnerTexts()
}

async function waitRows(app: ElectronApplication): Promise<string[]> {
  await expect
    .poll(async () => (await suggestRows(app)).length, { timeout: 10_000 })
    .toBeGreaterThan(0)
  return suggestRows(app)
}

async function sheet(app: ElectronApplication) {
  const overlay = await overlayOf(app)
  const card = overlay.locator('.safe-sheet')
  await expect(card).toBeVisible({ timeout: 10_000 })
  await overlay.waitForTimeout(GUARD_MS)
  return card
}

function overlayState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const views = (win?.contentView.children ?? []).filter(
      (v): v is Electron.WebContentsView => v instanceof WebContentsView,
    )
    const overlay = views.find((v) => v.webContents.getURL().includes('/ui/overlay/'))
    const page = views.find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
    return {
      visible: overlay?.getVisible() ?? false,
      focused: overlay?.webContents.isFocused() ?? false,
      bounds: overlay?.getBounds() ?? null,
      page: page?.getBounds() ?? null,
      zoom: page?.webContents.getZoomFactor() ?? 1,
    }
  })
}

const activeId = (page: Page | Frame) => page.evaluate(() => document.activeElement?.id ?? '')

test.describe('Safe inline suggestions and passkeys', () => {
  test.describe.configure({ mode: 'serial' })
  let dir: string
  let fake: FakeSafe
  let rp: Rp
  let app: ElectronApplication
  let shell: Page

  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ewe-b1-'))
    fake = await startFakeSafe(join(dir, 's.sock'))
    rp = await startRp()
    fake.addLogin('Test RP', 'sam', rp.served.origin, 'pw-sam')
    fake.addLogin('Test RP', 'bob', rp.served.origin, 'pw-bob')
    const cli = join(dir, 'ewe-safe')
    writeFileSync(
      cli,
      `#!/usr/bin/env node
const s = require('node:net').createConnection(process.env.EWE_SAFE_SOCKET)
s.on('connect', () => s.write(JSON.stringify({ v: 1, id: 1, verb: 'unlock', args: { password: ${JSON.stringify(FAKE_MASTER)} } }) + '\\n'))
let b = ''
s.setEncoding('utf8')
s.on('data', (d) => { b += d; const i = b.indexOf('\\n'); if (i >= 0) { process.stdout.write(b.slice(0, i) + '\\n'); s.end() } })
`,
    )
    chmodSync(cli, 0o755)
    app = await electron.launch({
      args: [MAIN],
      env: {
        ...process.env,
        EWE_USER_DATA: join(dir, 'profile'),
        EWE_SAFE_SOCKET: fake.path,
        EWE_SAFE_BIN: cli,
        EWE_SAFE_APP: '/nonexistent',
      },
    })
    shell = await windowWith(app, '/ui/shell/')
    await shell.waitForFunction(() => typeof window.ewe === 'object')
  })

  test.afterAll(async () => {
    await app.close()
    await fake.close()
    rp.served.server.close()
    rp.frame.server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('the passkey script is in place before the page runs its first script', async () => {
    const page = await open(app, shell, `${rp.served.origin}/early`)
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __early: unknown }).__early))
      .toEqual({ createSrc: false, uvpaa: true, cma: true })
    const caps = await page.evaluate(() =>
      (
        PublicKeyCredential as unknown as {
          getClientCapabilities(): Promise<Record<string, boolean>>
        }
      ).getClientCapabilities(),
    )
    expect(caps).toMatchObject({ passkeyPlatformAuthenticator: true, conditionalGet: true })
  })

  test('a site saves a passkey in Safe and its server verifies the attestation', async () => {
    const page = await open(app, shell, `${rp.served.origin}/register`)
    const result = page.evaluate(() =>
      (window as unknown as { register(): Promise<unknown> }).register(),
    )
    const card = await sheet(app)
    await expect(card).toContainText('Save a passkey for localhost in ewe Safe?')
    await expect(card).toContainText('Sam')
    expect((await overlayState(app)).focused).toBe(true)
    await card.locator('.safe-sheet-primary').click()
    expect(await result).toEqual({
      verdict: { ok: true },
      isCredential: true,
      isAttestation: true,
      transports: ['internal', 'hybrid'],
      alg: -7,
      spki: 91,
      rawIdMatches: true,
      attachment: 'platform',
      ext: { credProps: { rk: true } },
    })
    expect(fake.items.filter((i) => i.passkey?.rpId === 'localhost')).toHaveLength(1)
    expect(rp.stored).toHaveLength(1)
  })

  test('the same passkey again is refused with InvalidStateError', async () => {
    const page = await open(app, shell, `${rp.served.origin}/register`)
    const result = page.evaluate(() =>
      (window as unknown as { register(o: unknown): Promise<unknown> }).register({ exclude: true }),
    )
    const card = await sheet(app)
    await card.locator('.safe-sheet-primary').click()
    expect(await result).toMatchObject({ error: 'InvalidStateError' })
  })

  test('signing in with a passkey: pick it in the sheet, the server checks the signature', async () => {
    const page = await open(app, shell, `${rp.served.origin}/register`)
    const result = page.evaluate(() =>
      (window as unknown as { signIn(): Promise<unknown> }).signIn(),
    )
    const card = await sheet(app)
    await expect(card).toContainText('Sign in to localhost with a passkey')
    await expect(card.locator('.safe-row')).toHaveCount(1)
    await expect(card.locator('.safe-row')).toContainText('sam@example.com')
    await card.locator('.safe-row').first().click()
    expect(await result).toEqual({ verdict: { ok: true, user: 'sam' }, isAssertion: true })
  })

  test('Enter in the sheet does nothing until a passkey is chosen with the keyboard', async () => {
    const page = await open(app, shell, `${rp.served.origin}/register`)
    const before = fake.calls.filter((c) => c.verb === 'passkey-get').length
    const result = page.evaluate(() =>
      (window as unknown as { signIn(): Promise<unknown> }).signIn(),
    )
    const card = await sheet(app)
    const overlay = await overlayOf(app)
    await overlay.keyboard.press('Enter')
    await overlay.waitForTimeout(400)
    await expect(card).toBeVisible()
    expect(fake.calls.filter((c) => c.verb === 'passkey-get').length).toBe(before)
    await overlay.keyboard.press('ArrowDown')
    await overlay.keyboard.press('Enter')
    expect(await result).toEqual({ verdict: { ok: true, user: 'sam' }, isAssertion: true })
  })

  test('Cancel answers NotAllowedError; an abort closes the sheet with AbortError', async () => {
    const page = await open(app, shell, `${rp.served.origin}/register`)
    const cancelled = page.evaluate(() =>
      (window as unknown as { signIn(): Promise<unknown> }).signIn(),
    )
    await (await sheet(app)).locator('.safe-sheet-cancel').click()
    expect(await cancelled).toMatchObject({ error: 'NotAllowedError' })

    await page.evaluate(() => {
      ;(window as unknown as { __abort: AbortController }).__abort = new AbortController()
    })
    const aborted = page.evaluate(() =>
      (window as unknown as { signIn(): Promise<unknown> }).signIn(),
    )
    await sheet(app)
    await page.evaluate(() => (window as unknown as { __abort: AbortController }).__abort.abort())
    expect(await aborted).toMatchObject({ error: 'AbortError' })
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
  })

  test('Use a security key instead hands the request to the browser itself', async () => {
    const page = await open(app, shell, `${rp.served.origin}/register`)
    await page.evaluate(() => {
      ;(window as unknown as { __abort: AbortController }).__abort = new AbortController()
    })
    const before = fake.calls.filter((c) => c.verb === 'passkey-get').length
    const result = page.evaluate(() =>
      (window as unknown as { signIn(): Promise<unknown> }).signIn(),
    )
    await (await sheet(app)).locator('.safe-sheet-native').click()
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    const settled = await Promise.race([
      result.then(() => 'settled'),
      page.waitForTimeout(800).then(() => 'pending'),
    ])
    expect(settled).toBe('pending')
    await page.evaluate(() => (window as unknown as { __abort: AbortController }).__abort.abort())
    expect(await result).toMatchObject({ error: 'AbortError' })
    expect(fake.calls.filter((c) => c.verb === 'passkey-get').length).toBe(before)
  })

  test('a locked Safe asks to unlock first, then saves', async () => {
    fake.lock()
    const page = await open(app, shell, `${rp.served.origin}/register`)
    const result = page.evaluate(() =>
      (window as unknown as { register(o: unknown): Promise<unknown> }).register({
        userId: 'user-2',
        name: 'bo',
      }),
    )
    let card = await sheet(app)
    await expect(card).toContainText('ewe Safe is locked')
    await card.locator('.safe-sheet-primary').click()
    await expect.poll(() => fake.locked, { timeout: 15_000 }).toBe(false)
    card = await sheet(app)
    await expect(card.locator('.safe-sheet-primary')).toHaveText('Save', { timeout: 10_000 })
    await card.locator('.safe-sheet-primary').click()
    expect(await result).toMatchObject({ verdict: { ok: true } })
  })

  test('a frame from another origin gets NotAllowedError', async () => {
    const page = await open(app, shell, `${rp.served.origin}/frame`)
    const frame = page.frames().find((f) => f.url().startsWith(rp.frame.origin))
    if (frame === undefined) throw new Error('no inner frame')
    expect(
      await frame.evaluate(() =>
        (window as unknown as { tryCreate(): Promise<string> }).tryCreate(),
      ),
    ).toBe('NotAllowedError')
  })

  test('the inline list opens under the field and keeps the focus in it', async () => {
    const page = await open(app, shell, `${rp.served.origin}/plain`)
    await page.click('#user')
    expect(await waitRows(app)).toEqual(['Test RP\nbob', 'Test RP\nsam', 'Open ewe Safe'])
    expect(await activeId(page)).toBe('user')
    const state = await overlayState(app)
    expect(state.visible).toBe(true)
    expect(state.focused).toBe(false)
    const field = await page.locator('#user').boundingBox()
    if (field === null || state.bounds === null || state.page === null)
      throw new Error('no geometry')
    const top = state.page.y + (field.y + field.height) * state.zoom
    expect(Math.abs(state.bounds.y + 12 - (top + 4))).toBeLessThanOrEqual(2)
    expect(
      Math.abs(state.bounds.x + 12 - (state.page.x + field.x * state.zoom)),
    ).toBeLessThanOrEqual(2)

    await page.keyboard.type('bo')
    expect(await page.inputValue('#user')).toBe('bo')
    await expect.poll(() => suggestRows(app)).toEqual(['Test RP\nbob', 'Open ewe Safe'])
    await page.keyboard.press('ArrowDown')
    await expect((await overlayOf(app)).locator('.safe-row.active')).toContainText('bob')
    expect(await activeId(page)).toBe('user')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.inputValue('#user')).toBe('bob')
    await expect.poll(() => page.inputValue('#pass')).toBe('pw-bob')
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
  })

  test('Escape closes the list; no match hides it; it follows the focus to the next field', async () => {
    const page = await open(app, shell, `${rp.served.origin}/plain`)
    await page.click('#user')
    await waitRows(app)
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    expect(await activeId(page)).toBe('user')
    await page.click('#user')
    await waitRows(app)
    await page.keyboard.type('zed')
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expect.poll(async () => (await overlayState(app)).visible).toBe(true)
    const under = (await overlayState(app)).bounds?.y ?? 0
    await page.click('#pass')
    await expect
      .poll(async () => (await overlayState(app)).bounds?.y ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(under + 20)
    expect((await overlayState(app)).visible).toBe(true)
    expect(await suggestRows(app)).toContain('Test RP\nsam')
    expect(await activeId(page)).toBe('pass')
  })

  test('Tab into a field opens the list; script focus and page load do not', async () => {
    const page = await open(app, shell, `${rp.served.origin}/autofocus`)
    await page.waitForTimeout(1200)
    expect(await activeId(page)).toBe('user')
    expect((await overlayState(app)).visible).toBe(false)
    await page.evaluate(() => document.getElementById('pass')?.focus())
    await page.waitForTimeout(800)
    expect((await overlayState(app)).visible).toBe(false)
    await page.evaluate(() => document.getElementById('user')?.focus())
    await page.keyboard.press('Tab')
    expect(await activeId(page)).toBe('pass')
    expect(await waitRows(app)).toContain('Test RP\nsam')
    await page.keyboard.type('x')
    await expect.poll(async () => (await overlayState(app)).visible).toBe(false)
  })

  test('conditional mediation: the passkey sits on top of the list and signs in', async () => {
    const page = await open(app, shell, `${rp.served.origin}/login`)
    await page.click('#user')
    const rows = await waitRows(app)
    expect(rows[0]).toContain('sam@example.com')
    expect(rows[0]).toContain('Passkey')
    expect(rows).toContain('Test RP\nsam')
    expect(await activeId(page)).toBe('user')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.locator('#status')).toHaveText('signed in as sam', { timeout: 10_000 })
    expect(await page.inputValue('#user')).toBe('')
  })
})
