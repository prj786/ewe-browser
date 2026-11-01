import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import type { ShellCommand, TabState, WindowSnapshot } from '@ewe/shared'
import { startFakeSafe, type FakeSafe } from '../fake-safed'

const MAIN = join(__dirname, '../../out/main/index.js')
const PIXEL = readFileSync(join(__dirname, 'pixel.png'))
const BITWARDEN = 'nngceckbapebfimnlniiiahkandclblb'
const BITWARDEN_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmqKbvreshyXRuN2gikeR1idqR6KL0Di89JZcMyD4bjJRZVmQO7aznSGSALIHzSAUGYocUYBNDOP5QAhImxXyQ1qG8+goXs93v9GzrNJETdVuCEhqBggC4/DFabryJZDiKvZ2Jl0DM7MsWdoybZPwrj70V3aJ/nVNOMkf868scNTMliwitCqqjT5baTANsG0DkZWQExD4lSXzSZHH9MEO8q0iZ7RRlNuGRBAkZgNV8FwZRsPKm/rwQ9dy3VpgLcmLp5GiMt+kAEncqKAkuRYnhVXXBsKqIyYTMjHSLkLnpfFySyOPLBdS617i/PGNiP/MT6Xy6z//v5NozUgaAZ4gJQIDAQAB'
const GUARD_MS = 650

type Target = 'page' | 'overlay' | 'shell'
type AnyInput =
  Electron.KeyboardInputEvent | Electron.MouseInputEvent | Electron.MouseWheelInputEvent

interface Site {
  server: Server
  origin: string
}

const html = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="data:,"></head><body style="font:16px sans-serif;margin:40px">${body}</body></html>`

function serve(pages: (origin: string) => Record<string, string>): Promise<Site> {
  let table: Record<string, string> = {}
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    if (path === '/pixel.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PIXEL)
      return
    }
    const body = table[path]
    if (body === undefined) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const origin = `http://127.0.0.1:${String(port)}`
      table = pages(origin)
      resolve({ server, origin })
    }),
  )
}

function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      EWE_USER_DATA: userData,
      EWE_DOWNLOADS: join(userData, '..', 'downloads'),
      EWE_SAFE_SOCKET: join(userData, '..', 'no-safe.sock'),
      ...env,
    },
  })
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

async function shellOf(app: ElectronApplication): Promise<Page> {
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

const state = (shell: Page): Promise<WindowSnapshot> =>
  shell.evaluate(async () => {
    const s = await window.ewe.getState()
    if (s === null) throw new Error('no state')
    return s
  })

async function active(shell: Page): Promise<TabState> {
  const s = await state(shell)
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  if (tab === undefined) throw new Error('no active tab')
  return tab
}

const send = (shell: Page, command: ShellCommand) =>
  shell.evaluate((c) => window.ewe.send(c), command)

async function open(app: ElectronApplication, shell: Page, url: string): Promise<Page> {
  await send(shell, { type: 'tab.navigate', input: url })
  await expect.poll(async () => (await active(shell)).url, { timeout: 20_000 }).toBe(url)
  await expect.poll(async () => (await active(shell)).loading).toBe(false)
  const page = app.windows().find((w) => w.url() === url)
  if (page === undefined) throw new Error(`no page ${url}`)
  await page.waitForLoadState('load')
  await page.waitForTimeout(300)
  return page
}

function events(
  app: ElectronApplication,
  target: Target,
  list: AnyInput[],
  gap = 0,
): Promise<void> {
  return app.evaluate(
    async ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      if (win === undefined) return
      const views = win.contentView.children.filter(
        (v): v is Electron.WebContentsView => v instanceof WebContentsView,
      )
      const wc =
        p.target === 'shell'
          ? win.webContents
          : p.target === 'overlay'
            ? views.find((v) => v.webContents.getURL().includes('/ui/overlay/'))?.webContents
            : views.find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
                ?.webContents
      if (wc === undefined) return
      for (const e of p.list) {
        wc.sendInputEvent(e)
        if (p.gap > 0) await new Promise((r) => setTimeout(r, p.gap))
      }
    },
    { target, list, gap },
  )
}

function key(
  app: ElectronApplication,
  keyCode: string,
  modifiers: string[] = [],
  target: Target = 'page',
) {
  const mods = modifiers as Electron.InputEvent['modifiers']
  return events(app, target, [
    { type: 'keyDown', keyCode, modifiers: mods } as Electron.KeyboardInputEvent,
    { type: 'keyUp', keyCode, modifiers: mods } as Electron.KeyboardInputEvent,
  ])
}

async function center(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox()
  if (box === null) throw new Error(`${selector} has no box`)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

function rightClick(app: ElectronApplication, at: { x: number; y: number }): Promise<void> {
  return events(app, 'page', [
    { type: 'mouseMove', x: at.x, y: at.y },
    { type: 'mouseDown', x: at.x, y: at.y, button: 'right', clickCount: 1 },
    { type: 'mouseUp', x: at.x, y: at.y, button: 'right', clickCount: 1 },
  ] as Electron.MouseInputEvent[])
}

async function menuAt(app: ElectronApplication, page: Page, selector: string): Promise<Page> {
  const overlay = await windowWith(app, '/ui/overlay/')
  await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
  await rightClick(app, await center(page, selector))
  await expect(overlay.locator('.menu')).toBeVisible()
  return overlay
}

const labels = (overlay: Page) => overlay.locator('.menu .menu-item .menu-label').allInnerTexts()

async function pick(overlay: Page, label: string): Promise<void> {
  await overlay.locator('.menu .menu-item', { hasText: label }).first().click()
  await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
}

function stubClipboard(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ clipboard }) => {
    const g = globalThis as { __clip?: string }
    Object.assign(clipboard, {
      writeText: (text: string) => {
        g.__clip = text
        return Promise.resolve()
      },
    })
  })
}

const clip = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __clip?: string }).__clip ?? '')

function overlayView(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const view = (win?.contentView.children ?? [])
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .find((v) => v.webContents.getURL().includes('/ui/overlay/'))
    return { visible: view?.getVisible() ?? false, bounds: view?.getBounds() ?? null }
  })
}

function swipe(app: ElectronApplication, dx: number, count: number, at = { x: 400, y: 300 }) {
  return events(
    app,
    'page',
    Array.from({ length: count }, () => ({
      type: 'mouseWheel',
      x: at.x,
      y: at.y,
      deltaX: dx,
      deltaY: 0,
      hasPreciseScrollingDeltas: true,
      canScroll: true,
    })),
    16,
  )
}

function observedSwipe(app: ElectronApplication, dx: number, count: number) {
  return app.evaluate(
    async ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      const views = (win?.contentView.children ?? []).filter(
        (v): v is Electron.WebContentsView => v instanceof WebContentsView,
      )
      const page = views.find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
      const overlay = views.find((v) => v.webContents.getURL().includes('/ui/overlay/'))
      if (page === undefined || overlay === undefined) return []
      const seen: { disc: boolean; ready: boolean; x: number; width: number; page: number }[] = []
      for (let i = 0; i <= p.count; i++) {
        if (i < p.count)
          page.webContents.sendInputEvent({
            type: 'mouseWheel',
            x: 400,
            y: 300,
            deltaX: p.dx,
            deltaY: 0,
            hasPreciseScrollingDeltas: true,
            canScroll: true,
          })
        await new Promise((r) => setTimeout(r, i < p.count ? 16 : 70))
        const dom = (await overlay.webContents.executeJavaScript(
          `[!!document.querySelector('.swipe-disc'), !!document.querySelector('.swipe-disc.ready')]`,
        )) as [boolean, boolean]
        const b = overlay.getBounds()
        seen.push({
          disc: dom[0] && overlay.getVisible(),
          ready: dom[1],
          x: b.x,
          width: b.width,
          page: page.getBounds().x,
        })
      }
      return seen
    },
    { dx, count },
  )
}

function sideButton(
  app: ElectronApplication,
  target: 'page' | 'shell',
  button: 'back' | 'forward',
) {
  return app.evaluate(
    async ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) return
      const wc =
        p.target === 'shell'
          ? win.webContents
          : win.contentView.children
              .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
              .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))?.webContents
      if (wc === undefined) return
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const buttons = p.button === 'back' ? 8 : 16
      const at = { x: 20, y: 20, button: p.button, clickCount: 1 }
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        buttons,
        ...at,
      })
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        buttons: 0,
        ...at,
      })
      wc.debugger.detach()
    },
    { target, button },
  )
}

test('right-click menus on a web page: link, image, selection, field, media, page, keyboard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-menu-'))
  const site = await serve((origin) => ({
    '/menu': html(
      'Menu page',
      `<p><a id="link" href="/next">Next page</a></p>
      <p><img id="img" src="/pixel.png" width="80" height="80"></p>
      <p id="text">shear the sheep before the rain</p>
      <p id="go">${origin.slice(7)}/next</p>
      <p><input id="field" value="wool" style="width:240px;height:28px"></p>
      <p><video id="vid" src="/clip.webm" width="160" height="90" style="background:#000"></video></p>
      <div id="empty" style="height:200px"></div>`,
    ),
    '/next': html('Next', '<h1>Next</h1>'),
  }))
  const app = await launch(join(dir, 'profile'))
  try {
    const shell = await shellOf(app)
    await stubClipboard(app)
    const page = await open(app, shell, `${site.origin}/menu`)
    const home = (await active(shell)).id

    let overlay = await menuAt(app, page, '#link')
    expect(await labels(overlay)).toEqual([
      'Open link in new tab',
      'Open link in new workspace',
      'Open link in new window',
      'Save link',
      'Copy link',
      'Inspect',
    ])
    const where = await overlay.locator('.menu').boundingBox()
    const view = await app.evaluate(({ BrowserWindow, WebContentsView }) =>
      BrowserWindow.getAllWindows()[0]
        ?.contentView.children.filter(
          (v): v is Electron.WebContentsView => v instanceof WebContentsView,
        )
        .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
        ?.getBounds(),
    )
    const link = await center(page, '#link')
    expect(Math.abs((where?.x ?? 0) - ((view?.x ?? 0) + link.x))).toBeLessThanOrEqual(2)
    await pick(overlay, 'Copy link')
    expect(await clip(app)).toBe(`${site.origin}/next`)

    overlay = await menuAt(app, page, '#link')
    await pick(overlay, 'Open link in new tab')
    await expect.poll(async () => (await state(shell)).tabs.length).toBe(2)
    expect((await state(shell)).tabs[1]?.url).toBe(`${site.origin}/next`)
    expect((await active(shell)).id).toBe(home)

    overlay = await menuAt(app, page, '#img')
    expect(await labels(overlay)).toEqual([
      'Open image in new tab',
      'Save image',
      'Copy image',
      'Copy image address',
      'Inspect',
    ])
    await pick(overlay, 'Copy image address')
    expect(await clip(app)).toBe(`${site.origin}/pixel.png`)

    await page.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('text') as Node)
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
    })
    overlay = await menuAt(app, page, '#text')
    expect(await labels(overlay)).toEqual([
      'Copy',
      'Search Google for “shear the sheep before the rain”',
      'Inspect',
    ])
    await overlay.keyboard.press('Escape')
    await expect.poll(() => overlay.locator('.menu').count()).toBe(0)

    await page.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('go') as Node)
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
    })
    overlay = await menuAt(app, page, '#go')
    await pick(overlay, `Go to ${site.origin.slice(7)}/next`)
    await expect.poll(async () => (await active(shell)).url).toBe(`${site.origin}/next`)
    await send(shell, { type: 'tab.activate', id: home })
    await expect.poll(async () => (await active(shell)).id).toBe(home)
    await page.waitForTimeout(300)

    await page.click('#field')
    overlay = await menuAt(app, page, '#field')
    const fieldItems = await labels(overlay)
    expect(fieldItems).toEqual(expect.arrayContaining(['Undo', 'Cut', 'Paste', 'Select all']))
    expect(fieldItems).not.toContain('Fill from ewe Safe')
    await pick(overlay, 'Select all')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.getElementById('field') as HTMLInputElement
          return `${String(el.selectionStart)}-${String(el.selectionEnd)}`
        }),
      )
      .toBe('0-4')

    overlay = await menuAt(app, page, '#vid')
    expect(await labels(overlay)).toEqual(
      expect.arrayContaining(['Play', 'Mute', 'Loop', 'Show controls', 'Copy video address']),
    )
    await pick(overlay, 'Show controls')
    await expect
      .poll(() =>
        page.evaluate(() => (document.getElementById('vid') as HTMLVideoElement).controls),
      )
      .toBe(true)

    await page.evaluate(() => getSelection()?.removeAllRanges())
    overlay = await menuAt(app, page, '#empty')
    expect(await labels(overlay)).toEqual([
      'Back',
      'Forward',
      'Reload',
      'Bookmark this page',
      'Save page',
      'Print…',
      'View page source',
      'Inspect',
    ])
    await pick(overlay, 'View page source')
    await expect.poll(async () => (await active(shell)).url).toBe(`view-source:${site.origin}/menu`)
    await send(shell, { type: 'tab.activate', id: home })
    await expect.poll(async () => (await active(shell)).id).toBe(home)
    await page.waitForTimeout(300)

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await key(app, 'F10', ['shift'])
    await expect(overlay.locator('.menu')).toBeVisible()
    expect(await labels(overlay)).toContain('Reload')
    await overlay.keyboard.press('Escape')
    await expect.poll(() => overlay.locator('.menu').count()).toBe(0)

    await menuAt(app, page, '#link')
    await send(shell, { type: 'tab.navigate', input: `${site.origin}/next` })
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)
    expect(await overlay.locator('.menu').count()).toBe(0)
    await expect.poll(async () => (await active(shell)).url).toBe(`${site.origin}/next`)
  } finally {
    site.server.close()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('find in page: Ctrl+F, the match count, next and previous, Esc, the selection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-find-'))
  mkdirSync(join(dir, 'folder'))
  const site = await serve(() => ({
    '/find': html(
      'Find page',
      '<p>sheep one</p><p>sheep two</p><p>sheep three</p><p id="goat">goat</p>',
    ),
  }))
  const app = await launch(join(dir, 'profile'))
  try {
    const shell = await shellOf(app)
    const page = await open(app, shell, `${site.origin}/find`)
    await key(app, 'F', ['control'])
    const overlay = await windowWith(app, '/ui/overlay/')
    const bar = overlay.locator('.find-bar')
    await expect(bar).toBeVisible()
    await expect
      .poll(() => overlay.evaluate(() => document.activeElement?.className ?? ''))
      .toContain('find-input')
    const { bounds } = await overlayView(app)
    expect(bounds?.height).toBe(72)
    await overlay.keyboard.type('sheep')
    const count = overlay.locator('.find-count')
    await expect(count).toHaveText('1/3')
    await overlay.keyboard.press('Enter')
    await expect(count).toHaveText('2/3')
    await overlay.keyboard.press('Shift+Enter')
    await expect(count).toHaveText('1/3')
    await key(app, 'F3', [], 'overlay')
    await expect(count).toHaveText('2/3')
    await key(app, 'G', ['control', 'shift'], 'overlay')
    await expect(count).toHaveText('1/3')
    await overlay.locator('.find-next').click()
    await expect(count).toHaveText('2/3')
    await overlay.keyboard.type('x')
    await expect(count).toHaveText('0/0')
    await expect(bar).toHaveClass(/none/)
    await overlay.keyboard.press('Backspace')
    await expect(count).toHaveText('1/3')
    await overlay.keyboard.press('Escape')
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)
    expect(await page.evaluate(() => String(getSelection()))).toBe('sheep')

    await page.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('goat') as Node)
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
    })
    await key(app, 'F', ['control'])
    await expect(bar).toBeVisible()
    await expect(overlay.locator('.find-input')).toHaveValue('goat')
    await expect(count).toHaveText('1/1')
    await overlay.locator('.find-close').click()
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)

    await key(app, 'G', ['control'])
    await expect(bar).toBeVisible()
    await expect(overlay.locator('.find-input')).toHaveValue('goat')
    await overlay.keyboard.press('Escape')
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)

    await send(shell, { type: 'tab.navigate', input: join(dir, 'folder') })
    await expect.poll(async () => (await active(shell)).kind).toBe('files')
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(600)
    await key(app, 'F', ['control'])
    await shell.waitForTimeout(500)
    expect((await overlayView(app)).visible).toBe(false)
  } finally {
    site.server.close()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the new shortcuts drive workspaces, tabs and pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-keys-'))
  const site = await serve(() => ({ '/one': html('One', '<h1>One</h1>') }))
  const app = await launch(join(dir, 'profile'))
  try {
    const shell = await shellOf(app)
    await stubClipboard(app)
    await open(app, shell, `${site.origin}/one`)
    const first = await active(shell)

    await key(app, 'N', ['alt', 'shift'])
    await expect.poll(async () => (await state(shell)).workspaces.length).toBe(2)
    const [ws0, ws1] = (await state(shell)).workspaces
    await expect.poll(async () => (await state(shell)).activeWorkspaceId).toBe(ws1?.id)
    await expect.poll(async () => (await active(shell)).kind).toBe('home')
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(300)
    await key(app, 'Left', ['alt', 'shift'])
    await expect.poll(async () => (await state(shell)).activeWorkspaceId).toBe(ws0?.id)
    await shell.waitForTimeout(300)
    await key(app, 'Right', ['control', 'alt', 'shift'])
    await expect.poll(async () => (await active(shell)).workspaceId).toBe(ws1?.id)
    expect((await active(shell)).id).toBe(first.id)
    await key(app, 'Left', ['control', 'alt', 'shift'])
    await expect.poll(async () => (await active(shell)).workspaceId).toBe(ws0?.id)
    await key(app, 'Right', ['alt', 'shift'])
    await expect.poll(async () => (await state(shell)).activeWorkspaceId).toBe(ws1?.id)
    await send(shell, { type: 'tab.activate', id: first.id })
    await shell.waitForTimeout(300)

    await key(app, 'P', ['alt', 'shift'])
    await expect.poll(async () => (await active(shell)).pinned).toBe(true)
    await key(app, 'P', ['alt', 'shift'])
    await expect.poll(async () => (await active(shell)).pinned).toBe(false)
    // Ctrl+M mutes the tab and nothing else. It is a page-first key, so it also
    // reaches native accelerators; Electron's default Linux menu bound it to
    // Window → Minimize (cage showed the window minimized after Ctrl+M). The
    // app sets no menu at all, and a minimize/close role would carry Ctrl+M /
    // Ctrl+W even without an explicit accelerator.
    expect(
      await app.evaluate(({ Menu }) => {
        const roles: string[] = []
        const walk = (items: Electron.MenuItem[]) => {
          for (const it of items) {
            if (it.role === 'minimize' || it.role === 'close' || it.role === 'windowMenu')
              roles.push(it.role)
            if (it.submenu) walk(it.submenu.items)
          }
        }
        walk(Menu.getApplicationMenu()?.items ?? [])
        return roles
      }),
    ).toEqual([])
    const minimizedBefore = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.isMinimized(),
    )
    await key(app, 'M', ['control'])
    await expect.poll(async () => (await active(shell)).muted).toBe(true)
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized()),
    ).toBe(minimizedBefore)
    await key(app, 'C', ['alt', 'shift'])
    await expect.poll(() => clip(app)).toBe(`${site.origin}/one`)
    const overlay = await windowWith(app, '/ui/overlay/')
    await expect(overlay.locator('.toast')).toContainText('Address copied')

    const before = (await state(shell)).tabs.length
    await key(app, 'D', ['alt', 'shift'])
    await expect.poll(async () => (await state(shell)).tabs.length).toBe(before + 1)
    await send(shell, { type: 'tab.activate', id: first.id })
    await shell.waitForTimeout(300)

    await key(app, 'A', ['control', 'shift'])
    await expect(overlay.locator('.palette input')).toHaveValue('t: ')
    await overlay.keyboard.press('Escape')
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)

    await app.evaluate(({ webContents }, url) => {
      for (const wc of webContents.getAllWebContents().filter((c) => c.getURL() === url))
        Object.assign(wc, {
          print: () => {
            ;(globalThis as { __printed?: number }).__printed = 1
          },
        })
    }, `${site.origin}/one`)
    await key(app, 'P', ['control'])
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __printed?: number }).__printed ?? 0))
      .toBe(1)

    await key(app, 'U', ['control'])
    await expect.poll(async () => (await active(shell)).url).toBe(`view-source:${site.origin}/one`)
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(300)
    await key(app, ',', ['control'])
    await expect.poll(async () => (await active(shell)).url).toBe('app://settings/')
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(400)
    await key(app, ',', ['control'])
    await shell.waitForTimeout(300)
    expect((await state(shell)).tabs.filter((t) => t.url === 'app://settings/')).toHaveLength(1)
    await key(app, 'M', ['alt', 'shift'])
    await expect.poll(async () => (await active(shell)).kind).toBe('music')
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(400)
    await key(app, 'H', ['alt', 'shift'])
    await expect.poll(async () => (await active(shell)).kind).toBe('home')
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(400)
    await key(app, 'R', ['alt', 'shift'])
    await expect(shell.locator('.bar input')).toBeVisible()
    await shell.keyboard.press('Escape')
  } finally {
    site.server.close()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('web pages keep the shortcuts they handle; plain pages get the browser ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-pagekeys-'))
  const site = await serve(() => ({
    '/editor': html(
      'Editor',
      `<div id="doc" contenteditable="true">sheep</div><script>
      window.got = []
      addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.code === 'KeyU' || e.code === 'KeyF' || e.code === 'KeyP')) {
          e.preventDefault()
          window.got.push(e.code)
        }
      })</script>`,
    ),
    '/plain': html('Plain', '<p>sheep and more sheep</p>'),
  }))
  const app = await launch(join(dir, 'profile'))
  try {
    const shell = await shellOf(app)
    const editor = await open(app, shell, `${site.origin}/editor`)
    await app.evaluate(({ webContents }, url) => {
      for (const wc of webContents.getAllWebContents().filter((c) => c.getURL() === url))
        Object.assign(wc, {
          print: () => {
            ;(globalThis as { __printed?: number }).__printed = 1
          },
        })
    }, `${site.origin}/editor`)
    await key(app, 'U', ['control'])
    await key(app, 'F', ['control'])
    await key(app, 'P', ['control'])
    await expect
      .poll(() => editor.evaluate(() => (window as unknown as { got: string[] }).got))
      .toEqual(['KeyU', 'KeyF', 'KeyP'])
    await shell.waitForTimeout(500)
    expect((await state(shell)).tabs).toHaveLength(1)
    expect((await overlayView(app)).visible).toBe(false)
    expect(await app.evaluate(() => (globalThis as { __printed?: number }).__printed ?? 0)).toBe(0)

    await open(app, shell, `${site.origin}/plain`)
    await key(app, 'F', ['control'])
    const overlay = await windowWith(app, '/ui/overlay/')
    await expect(overlay.locator('.find-bar')).toBeVisible()
    await overlay.keyboard.press('Escape')
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)
    await key(app, 'U', ['control'])
    await expect
      .poll(async () => (await active(shell)).url)
      .toBe(`view-source:${site.origin}/plain`)
  } finally {
    site.server.close()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two-finger swipe goes back and forward, side buttons too, and the setting turns swipe off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-swipe-'))
  const site = await serve(() => ({
    '/a': html('A', '<h1>A</h1>'),
    '/b': html('B', '<h1>B</h1>'),
    '/wide': html(
      'Wide',
      '<div id="strip" style="overflow-x:auto;width:600px;height:200px;margin:0"><div style="width:3000px;height:180px;background:linear-gradient(90deg,#ddd,#888)"></div></div><div style="height:400px"></div>',
    ),
  }))
  const app = await launch(join(dir, 'profile'))
  try {
    const shell = await shellOf(app)
    await open(app, shell, `${site.origin}/a`)
    await open(app, shell, `${site.origin}/b`)
    await windowWith(app, '/ui/overlay/')

    const seen = await observedSwipe(app, 20, 11)
    const halfway = seen[4]
    expect(halfway).toMatchObject({ disc: true, ready: false, width: 96 })
    expect(halfway?.x).toBe(halfway?.page)
    expect(seen.at(-1)).toMatchObject({ disc: true, ready: true })
    await expect.poll(async () => (await active(shell)).url).toBe(`${site.origin}/a`)
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(300)

    await swipe(app, -20, 12)
    await expect.poll(async () => (await active(shell)).url).toBe(`${site.origin}/b`)
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(300)

    await swipe(app, 10, 3)
    await shell.waitForTimeout(500)
    expect((await active(shell)).url).toBe(`${site.origin}/b`)
    expect((await overlayView(app)).visible).toBe(false)

    await events(
      app,
      'page',
      Array.from({ length: 10 }, () => ({
        type: 'mouseWheel',
        x: 400,
        y: 300,
        deltaX: 6,
        deltaY: -40,
        hasPreciseScrollingDeltas: true,
        canScroll: true,
      })),
      16,
    )
    await shell.waitForTimeout(500)
    expect((await active(shell)).url).toBe(`${site.origin}/b`)

    const wide = await open(app, shell, `${site.origin}/wide`)
    await wide.evaluate(() => {
      const strip = document.getElementById('strip')
      if (strip !== null) strip.scrollLeft = 1000
    })
    await swipe(app, 20, 12, await center(wide, '#strip'))
    await shell.waitForTimeout(500)
    expect((await active(shell)).url).toBe(`${site.origin}/wide`)
    expect(
      await wide.evaluate(() => document.getElementById('strip')?.scrollLeft ?? 0),
    ).toBeLessThan(1000)

    await sideButton(app, 'page', 'back')
    await expect.poll(async () => (await active(shell)).url).toBe(`${site.origin}/b`)
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await sideButton(app, 'shell', 'forward')
    await expect.poll(async () => (await active(shell)).url).toBe(`${site.origin}/wide`)
    await expect.poll(async () => (await active(shell)).loading).toBe(false)
    await shell.waitForTimeout(300)

    await send(shell, { type: 'settings.update', patch: { gestures: { swipe: false } } })
    await shell.waitForTimeout(200)
    await swipe(app, 20, 12, { x: 700, y: 500 })
    await shell.waitForTimeout(600)
    expect((await active(shell)).url).toBe(`${site.origin}/wide`)
    expect((await overlayView(app)).visible).toBe(false)
  } finally {
    site.server.close()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Safe only: Ctrl+Shift+L, the rail key and the right-click menu open Safe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-safeonly-'))
  const fake: FakeSafe = await startFakeSafe(join(dir, 's.sock'))
  const site = await serve(() => ({
    '/login': html(
      'Sign in',
      `<form onsubmit="return false"><p><input id="user" name="username" style="width:320px;height:32px"></p>
      <p><input id="pass" type="password" name="password" autocomplete="current-password" style="width:320px;height:32px"></p>
      <p><button>Sign in</button></p></form><p id="out">outside</p>`,
    ),
    '/signup': html(
      'Sign up',
      `<form onsubmit="return false"><p><input id="new" type="password" autocomplete="new-password" style="width:320px;height:32px"></p>
      <p><input id="again" type="password" autocomplete="new-password" style="width:320px;height:32px"></p>
      <p><button>Create account</button></p></form>`,
    ),
    '/plain': html('Plain', '<p>No form here</p>'),
  }))
  fake.addLogin('Flock', 'sam', site.origin, 'pw-sam')
  fake.addLogin('Flock', 'bob', site.origin, 'pw-bob')
  const app = await launch(join(dir, 'profile'), {
    EWE_SAFE_SOCKET: fake.path,
    EWE_SAFE_APP: '/nonexistent',
  })
  try {
    const shell = await shellOf(app)
    const overlay = await windowWith(app, '/ui/overlay/')
    const rows = () => overlay.locator('.safe-suggest .safe-row').allInnerTexts()

    const page = await open(app, shell, `${site.origin}/login`)
    await page.evaluate(() => document.getElementById('user')?.focus())
    await key(app, 'L', ['control', 'shift'])
    await expect
      .poll(rows, { timeout: 10_000 })
      .toEqual(['Flock\nbob', 'Flock\nsam', 'Open ewe Safe'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.inputValue('#user')).toBe('sam')
    await expect.poll(() => page.inputValue('#pass')).toBe('pw-sam')
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)

    await page.evaluate(() => {
      for (const id of ['user', 'pass'])
        (document.getElementById(id) as HTMLInputElement).value = ''
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    await shell.locator('.rail-key').click()
    await expect.poll(rows, { timeout: 10_000 }).toContain('Flock\nsam')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('user')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)

    let menu = await menuAt(app, page, '#pass')
    expect(await labels(menu)).toContain('Fill from ewe Safe')
    await menu.waitForTimeout(GUARD_MS)
    await pick(menu, 'Fill from ewe Safe')
    await expect.poll(rows, { timeout: 10_000 }).toContain('Flock\nbob')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)

    const signup = await open(app, shell, `${site.origin}/signup`)
    menu = await menuAt(app, signup, '#new')
    expect(await labels(menu)).toContain('Use a strong password')
    await menu.waitForTimeout(GUARD_MS)
    await pick(menu, 'Use a strong password')
    await expect.poll(() => signup.inputValue('#new')).toHaveLength(20)
    expect(await signup.inputValue('#again')).toBe(await signup.inputValue('#new'))
    expect(fake.calls.filter((c) => c.verb === 'generate')).toHaveLength(1)

    await open(app, shell, `${site.origin}/plain`)
    const offer = overlay.locator('.safe-prompt')
    await expect(offer).toContainText('Save this login to ewe Safe?', { timeout: 10_000 })
    await offer.locator('.safe-prompt-later').click()
    await expect.poll(async () => (await overlayView(app)).visible).toBe(false)
    await key(app, 'L', ['control', 'shift'])
    await expect(overlay.locator('.toast')).toContainText('No sign-in field on this page', {
      timeout: 5_000,
    })
  } finally {
    site.server.close()
    await app.close()
    await fake.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('password-manager extensions: an install is refused, an installed one is turned off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-pmext-'))
  const extensions = join(dir, 'extensions')
  const installed = join(extensions, BITWARDEN, '1.0.0_0')
  mkdirSync(installed, { recursive: true })
  writeFileSync(
    join(installed, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Bitwarden test',
      version: '1.0.0',
      key: BITWARDEN_KEY,
    }),
  )
  const app = await launch(join(dir, 'profile'), { EWE_EXTENSIONS: extensions })
  try {
    const shell = await shellOf(app)
    const overlay = await windowWith(app, '/ui/overlay/')
    await expect(overlay.locator('.toast')).toContainText(
      'Bitwarden is off: ewe Safe fills passwords',
      {
        timeout: 15_000,
      },
    )
    const loaded = () =>
      app.evaluate(({ session }) =>
        session
          .fromPartition('persist:default')
          .extensions.getAllExtensions()
          .map((e) => e.id),
      )
    expect(await loaded()).not.toContain(BITWARDEN)
    expect(existsSync(installed)).toBe(true)
    await expect.poll(async () => (await overlayView(app)).visible, { timeout: 5_000 }).toBe(false)

    await send(shell, {
      type: 'extension.install',
      source: 'https://chromewebstore.google.com/detail/1password/aeblfdkhhhdcdjpifhhbdiojplfjncoa',
    })
    await expect(overlay.locator('.toast')).toContainText(
      'ewe Browser fills passwords with ewe Safe',
    )
    expect(existsSync(join(extensions, 'aeblfdkhhhdcdjpifhhbdiojplfjncoa'))).toBe(false)
    expect(await loaded()).not.toContain('aeblfdkhhhdcdjpifhhbdiojplfjncoa')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
