import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { Rect } from '@ewe/shared'
import { startFakeSafe, writeFakeCli, type FakeSafe } from '../fake-safed'

const MAIN = join(__dirname, '../../out/main/index.js')
const OUT = process.env.EWE_SAFE_SHOTS

const box = 'style="width:340px;height:36px;font:15px sans-serif;padding:0 8px"'
const html = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Shop</title><link rel="icon" href="data:,"></head><body style="font:16px sans-serif;margin:48px;background:#fafafa;color:#222">${body}</body></html>`

const PAGES: Record<string, string> = {
  '/signup': html(`<h2>Create your account</h2><form method="post" action="/welcome">
    <p><input id="email" type="email" placeholder="Email" ${box}></p>
    <p><input id="pass" type="password" placeholder="Password" ${box}></p>
    <p><input id="confirm" type="password" placeholder="Repeat password" ${box}></p>
    <p><button id="go" type="submit">Create account</button></p></form>`),
  '/card': html(`<h2>Payment</h2><form onsubmit="return false">
    <p><input id="cname" autocomplete="cc-name" placeholder="Name on card" ${box}></p>
    <p><input id="num" autocomplete="cc-number" placeholder="Card number" ${box}></p>
    <p><input id="exp" autocomplete="cc-exp" placeholder="MM / YY" ${box}></p></form>`),
  '/address': html(`<h2>Shipping address</h2><form onsubmit="return false">
    <p><input id="name" autocomplete="name" placeholder="Full name" ${box}></p>
    <p><input id="line1" autocomplete="address-line1" placeholder="Street" ${box}></p>
    <p><input id="city" autocomplete="address-level2" placeholder="City" ${box}></p></form>`),
  'POST /welcome': html('<h2>Welcome!</h2><p>Your account is ready.</p>'),
}

function serve(host: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const body = PAGES[`${req.method ?? 'GET'} ${path}`] ?? PAGES[path]
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
  return new Promise((done) =>
    server.listen(0, host, () => {
      const a = server.address()
      const port = typeof a === 'object' && a !== null ? a.port : 0
      done({ server, origin: `http://${host}:${String(port)}` })
    }),
  )
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

function capture(app: ElectronApplication, crop: Rect | null): Promise<string> {
  return app.evaluate(async ({ BrowserWindow, WebContentsView, nativeImage }, p) => {
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
    let out = nativeImage.createFromBitmap(pixels, { width, height })
    if (p !== null)
      out = out.crop({
        x: Math.max(0, Math.round(p.x * scale)),
        y: Math.max(0, Math.round(p.y * scale)),
        width: Math.min(width, Math.round(p.width * scale)),
        height: Math.min(height, Math.round(p.height * scale)),
      })
    return out.toPNG().toString('base64')
  }, crop)
}

function views(app: ElectronApplication): Promise<{ overlay: Rect | null; page: Rect | null }> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const list = (win?.contentView.children ?? []).filter(
      (v): v is Electron.WebContentsView => v instanceof WebContentsView,
    )
    const overlay = list.find((v) => v.webContents.getURL().includes('/ui/overlay/'))
    const page = list.find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
    return {
      overlay: overlay?.getVisible() === true ? overlay.getBounds() : null,
      page: page?.getBounds() ?? null,
    }
  })
}

test.describe('Safe screenshots', () => {
  test.skip(OUT === undefined, 'set EWE_SAFE_SHOTS to a folder')
  test.describe.configure({ mode: 'serial' })
  let dir: string
  let fake: FakeSafe
  let local: { server: Server; origin: string }
  let plain: { server: Server; origin: string }
  let app: ElectronApplication
  let shell: Page

  const save = async (name: string, crop: Rect | null) => {
    const folder = resolve(OUT ?? '.')
    mkdirSync(folder, { recursive: true })
    const overlay = await windowWith(app, '/ui/overlay/')
    await overlay.mouse.move(1, 1)
    await overlay.waitForTimeout(250)
    writeFileSync(join(folder, `${name}.png`), Buffer.from(await capture(app, crop), 'base64'))
  }

  const open = async (url: string): Promise<Page> => {
    await shell.evaluate((u) => window.ewe.send({ type: 'tab.navigate', input: u }), url)
    const page = await windowWith(app, url)
    await page.waitForLoadState('load')
    await page.waitForTimeout(500)
    return page
  }

  const around = async (): Promise<Rect | null> => {
    const v = await views(app)
    if (v.overlay === null || v.page === null) return null
    const x = Math.max(v.page.x, v.overlay.x - 60)
    const y = Math.max(v.page.y, v.overlay.y - 60)
    return { x, y, width: v.overlay.width + 120, height: v.overlay.height + 100 }
  }

  const list = async (page: Page, selector: string, name: string) => {
    const overlay = await windowWith(app, '/ui/overlay/')
    await overlay.mouse.move(1, 1)
    await page.click(selector)
    await expect(overlay.locator('.safe-suggest .safe-row').first()).toBeVisible()
    await page.waitForTimeout(400)
    await save(name, await around())
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  const signup = async (email: string, name: string) => {
    const page = await open(`${local.origin}/signup`)
    await page.fill('#email', email)
    await page.fill('#pass', 'Shot-pw-1')
    await page.fill('#confirm', 'Shot-pw-1')
    await page.click('#go')
    const overlay = await windowWith(app, '/ui/overlay/')
    const card = overlay.locator('.safe-prompt')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)
    await save(name, await around())
    await card.locator('.safe-prompt-later').click()
    await page.waitForTimeout(300)
  }

  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ewe-b3s-'))
    fake = await startFakeSafe(join(dir, 's.sock'))
    local = await serve('localhost')
    plain = await serve('127.0.0.1')
    fake.addCard('Visa •• 4242', {
      holder: 'Sam Moe',
      number: '4242424242424242',
      expiry: '08/2029',
      security_code: '123',
      pin: '',
      brand: 'visa',
    })
    fake.addCard('Work card', {
      holder: 'Sam Moe',
      number: '5555555555554444',
      expiry: '01/2031',
      security_code: '321',
      pin: '',
      brand: 'mastercard',
    })
    for (const [title, line1] of [
      ['Home', '12 Main St'],
      ['Office', '7 Rustaveli Ave'],
    ] as const)
      fake.addAddress(title, {
        full_name: 'Sam Moe',
        organization: '',
        line1,
        line2: '',
        city: 'Tbilisi',
        region: '',
        postal_code: '0105',
        country: 'GE',
        phone: '',
        email: '',
      })
    app = await electron.launch({
      args: [MAIN],
      env: {
        ...process.env,
        EWE_USER_DATA: join(dir, 'profile'),
        EWE_SAFE_SOCKET: fake.path,
        EWE_SAFE_BIN: writeFakeCli(dir),
        EWE_SAFE_APP: '/nonexistent',
      },
    })
    shell = await windowWith(app, '/ui/shell/')
    await shell.waitForFunction(() => typeof window.ewe === 'object')
    await shell.waitForTimeout(1500)
  })

  test.afterAll(async () => {
    await app.close()
    await fake.close()
    local.server.close()
    plain.server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  for (const theme of ['dark', 'light'] as const) {
    test(`prompt and lists, ${theme}`, async () => {
      await shell.evaluate(
        (t) => window.ewe.send({ type: 'settings.update', patch: { theme: t } }),
        theme,
      )
      await shell.waitForTimeout(500)
      await signup('sam@new.test', `safe-prompt-save-${theme}`)
      fake.lock()
      await signup('bo@new.test', `safe-prompt-locked-${theme}`)
      fake.locked = false
      await list(await open(`${local.origin}/card`), '#num', `safe-cards-${theme}`)
      await list(await open(`${local.origin}/address`), '#line1', `safe-addresses-${theme}`)
      const insecure = await open(`${plain.origin}/card`)
      await insecure.click('#num')
      await insecure.keyboard.press('ArrowDown')
      const overlay = await windowWith(app, '/ui/overlay/')
      await expect(overlay.locator('.safe-suggest .safe-row').first()).toBeVisible()
      await insecure.waitForTimeout(400)
      await save(`safe-cards-insecure-${theme}`, await around())
      await insecure.keyboard.press('Escape')
    })
  }
})
