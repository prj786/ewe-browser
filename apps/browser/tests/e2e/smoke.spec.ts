import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { BookmarkFolder, ShellCommand } from '@ewe/shared'

const MAIN = join(__dirname, '../../out/main/index.js')

async function launch(
  userData: string,
  env: Record<string, string> = {},
): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN],
    env: { ...process.env, EWE_USER_DATA: userData, ...env },
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
        const content = await app.evaluate(({ BrowserWindow }) => {
          const b = BrowserWindow.getAllWindows()[0]?.getContentBounds()
          return b === undefined ? '' : `${b.width}x${b.height}`
        })
        const stable = inner === last
        last = inner
        return stable && Math.abs(Number(inner.split('x')[0]) - Number(content.split('x')[0])) <= 1
      },
      { intervals: [500], timeout: 15_000 },
    )
    .toBe(true)
  return shell
}

function activeUrl(shell: Page): Promise<string | undefined> {
  return shell.evaluate(async () => {
    const s = await window.ewe.getState()
    return s?.tabs.find((t) => t.id === s.activeTabId)?.url
  })
}

function activeLoading(shell: Page): Promise<boolean | undefined> {
  return shell.evaluate(async () => {
    const s = await window.ewe.getState()
    return s?.tabs.find((t) => t.id === s.activeTabId)?.loading
  })
}

function pathOfActive(shell: Page): Promise<string | null> {
  return shell.evaluate(async () => {
    const s = await window.ewe.getState()
    const url = s?.tabs.find((t) => t.id === s.activeTabId)?.url ?? ''
    return url.startsWith('app://files/') ? new URL(url).searchParams.get('path') : null
  })
}

function tabCount(shell: Page): Promise<number> {
  return shell.evaluate(async () => (await window.ewe.getState())?.tabs.length ?? 0)
}

function sendKey(app: ElectronApplication, key: string, modifiers: string[]): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) return
      const page = win.contentView.children
        .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
        .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
      const wc = page?.webContents ?? win.webContents
      wc.sendInputEvent({ type: 'keyDown', keyCode: p.key, modifiers: p.modifiers as never })
      wc.sendInputEvent({ type: 'keyUp', keyCode: p.key, modifiers: p.modifiers as never })
    },
    { key, modifiers },
  )
}

function overlayVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) return false
    return win.contentView.children
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .some((v) => v.getVisible() && v.webContents.getURL().includes('/ui/overlay/'))
  })
}

function overlayHeight(app: ElectronApplication): Promise<{ overlay: number; window: number }> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) return { overlay: 0, window: 0 }
    const overlay = win.contentView.children
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .find((v) => v.webContents.getURL().includes('/ui/overlay/'))
    return { overlay: overlay?.getBounds().height ?? 0, window: win.getContentBounds().height }
  })
}

function rightClick(
  app: ElectronApplication,
  target: 'overlay' | 'shell',
  x: number,
  y: number,
): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) return
      const overlay = win.contentView.children
        .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
        .find((v) => v.webContents.getURL().includes('/ui/overlay/'))
      const wc = p.target === 'shell' ? win.webContents : overlay?.webContents
      if (wc === undefined) return
      wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
      wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'right', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'right', clickCount: 1 })
    },
    { target, x, y },
  )
}

async function openTabMenu(app: ElectronApplication, shell: Page, index: number): Promise<Page> {
  const box = await shell.locator('.rail-tab[data-tab]').nth(index).boundingBox()
  if (box === null) throw new Error(`tab ${index} not found`)
  await rightClick(
    app,
    'shell',
    Math.round(box.x + box.width / 2),
    Math.round(box.y + box.height / 2),
  )
  const overlay = await windowWith(app, '/ui/overlay/')
  await overlay.waitForSelector('.menu')
  return overlay
}

async function openWorkspaceMenu(
  app: ElectronApplication,
  shell: Page,
  overlay: Page,
  index: number,
): Promise<void> {
  await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
  const box = await shell.locator('.rail-ws-dot').nth(index).boundingBox()
  if (box === null) throw new Error(`workspace dot ${index} not found`)
  await rightClick(
    app,
    'shell',
    Math.round(box.x + box.width / 2),
    Math.round(box.y + box.height / 2),
  )
  await overlay.waitForSelector('.menu')
}

function pageBox(app: ElectronApplication): Promise<Electron.Rectangle | null> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const page = win?.contentView.children
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
    return page?.getBounds() ?? null
  })
}

function movePage(app: ElectronApplication, x: number, y: number): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      const page = win?.contentView.children
        .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
        .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
      page?.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    },
    { x, y },
  )
}

function workspaceNames(shell: Page): Promise<string[] | undefined> {
  return shell.evaluate(async () => (await window.ewe.getState())?.workspaces.map((w) => w.name))
}

function tabUrls(shell: Page): Promise<string[] | undefined> {
  return shell.evaluate(async () => (await window.ewe.getState())?.tabs.map((t) => t.url))
}

function tabPins(shell: Page): Promise<boolean[] | undefined> {
  return shell.evaluate(async () => (await window.ewe.getState())?.tabs.map((t) => t.pinned))
}

function tabIds(shell: Page): Promise<string[]> {
  return shell.evaluate(async () => (await window.ewe.getState())?.tabs.map((t) => t.id) ?? [])
}

function bookmarkUrls(shell: Page): Promise<string[]> {
  return shell.evaluate(async () => {
    const root = await window.ewe.getBookmarks()
    const walk = (folder: BookmarkFolder): string[] =>
      folder.children.flatMap((c) => (c.kind === 'bookmark' ? [c.url] : walk(c)))
    return root === null ? [] : walk(root)
  })
}

function sidebarSection(shell: Page): Promise<string | null | undefined> {
  return shell.evaluate(async () => (await window.ewe.getState())?.sidebar?.section ?? null)
}

function viewWidths(
  app: ElectronApplication,
): Promise<{ page: number; sidebar: number; rest: number }> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const views =
      win?.contentView.children.filter(
        (v): v is Electron.WebContentsView => v instanceof WebContentsView && v.getVisible(),
      ) ?? []
    const page = views.find((v) => !v.webContents.getURL().includes('/ui/'))
    const sidebar = views.find((v) => v.webContents.getURL().includes('/ui/sidebar/'))
    const box = page?.getBounds()
    const pageRight = box === undefined ? 0 : box.x + box.width
    const sidebarWidth = sidebar?.getBounds().width ?? 0
    const total = win?.getContentBounds().width ?? 0
    return { page: box?.width ?? 0, sidebar: sidebarWidth, rest: total - pageRight - sidebarWidth }
  })
}

function serve(files: Record<string, { body: string; type: string; attachment?: boolean }>) {
  const server = createServer((req, res) => {
    const file = files[req.url ?? '']
    if (file === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': file.type,
      'content-length': Buffer.byteLength(file.body),
      ...(file.attachment === true ? { 'content-disposition': 'attachment' } : {}),
    })
    res.end(file.body)
  })
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

test.describe('browser', () => {
  let app: ElectronApplication
  let shell: Page
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-'))

  test.beforeAll(async () => {
    app = await launch(userData)
    shell = await shellOf(app)
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('opens one window on the home page and a hidden overlay', async () => {
    const views = await app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return (
        win?.contentView.children
          .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
          .map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible() })) ?? []
      )
    })
    expect(views.some((v) => v.url === 'app://home/' && v.visible)).toBe(true)
    expect(views.some((v) => v.url.includes('/ui/overlay/') && !v.visible)).toBe(true)
  })

  test('creates, activates and closes tabs through the shell api', async () => {
    const before = await tabCount(shell)
    await shell.evaluate(() => window.ewe.send({ type: 'tab.create', url: 'app://settings/' }))
    await expect.poll(() => tabCount(shell)).toBe(before + 1)
    await expect.poll(() => activeUrl(shell)).toBe('app://settings/')
    const state = await shell.evaluate(() => window.ewe.getState())
    const id = state?.activeTabId
    if (id === null || id === undefined) throw new Error('no active tab')
    await shell.evaluate((tabId) => window.ewe.send({ type: 'tab.close', id: tabId }), id)
    await expect.poll(() => tabCount(shell)).toBe(before)
  })

  test('ctrl+t opens the new-tab palette over the page and enter creates the tab', async () => {
    const before = await tabCount(shell)
    await sendKey(app, 't', ['control'])
    await expect.poll(() => overlayVisible(app)).toBe(true)
    const overlay = await windowWith(app, '/ui/overlay/')
    await overlay.waitForSelector('.palette-chip')
    await overlay.keyboard.type('example.com')
    await overlay.keyboard.press('Enter')
    await expect.poll(() => tabCount(shell)).toBe(before + 1)
    await expect.poll(() => activeUrl(shell)).toBe('https://example.com/')
    await expect.poll(() => overlayVisible(app)).toBe(false)
    await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
    await sendKey(app, 'w', ['control'])
    await expect.poll(() => tabCount(shell)).toBe(before)
  })

  test('ctrl+l focuses the address field in the rail', async () => {
    await shell.evaluate(() => window.ewe.send({ type: 'tab.create', url: 'https://example.com/' }))
    await expect.poll(() => activeUrl(shell)).toBe('https://example.com/')
    await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
    await expect(shell.locator('.rail-host')).toHaveText('example.com')
    await sendKey(app, 'l', ['control'])
    await expect(shell.locator('.rail-address-input')).toBeFocused()
    expect(await shell.locator('.rail-address-input').inputValue()).toBe('https://example.com/')
    await shell.keyboard.type('example.org')
    await shell.keyboard.press('Enter')
    await expect.poll(() => activeUrl(shell), { timeout: 15_000 }).toBe('https://example.org/')
    await expect(shell.locator('.rail-address-input')).toHaveCount(0)
    expect(await overlayVisible(app)).toBe(false)
  })

  test('the page is a card next to the rail, which collapses and peeks on hover', async () => {
    await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
    await expect.poll(() => pageBox(app).then((b) => [b?.x, b?.y])).toEqual([264, 8])
    await shell.evaluate(() =>
      window.ewe.send({ type: 'settings.update', patch: { rail: 'collapsed' } }),
    )
    await expect(shell.locator('.rail.collapsed')).toHaveCount(1)
    await expect.poll(() => pageBox(app).then((b) => b?.x)).toBe(56)
    await shell.locator('.rail-ws-head, .rail-sep').first().hover()
    await expect.poll(() => overlayVisible(app)).toBe(true)
    const overlay = await windowWith(app, '/ui/overlay/')
    await expect(overlay.locator('.rail.peek')).toHaveCount(1)
    await expect(overlay.locator('.rail.peek .rail-tab[data-tab]')).toHaveCount(2)
    await expect
      .poll(async () => {
        await movePage(app, 700, 300)
        return overlayVisible(app)
      })
      .toBe(false)
    await sendKey(app, 's', ['control', 'shift'])
    await expect(shell.locator('.rail.collapsed')).toHaveCount(0)
    await expect.poll(() => pageBox(app).then((b) => b?.x)).toBe(264)
  })

  test('pages see a chrome-like identity', async () => {
    const page = await windowWith(app, 'example.org')
    const identity = await page.evaluate(() => ({
      ua: navigator.userAgent,
      chrome: Object.keys((window as unknown as { chrome?: object }).chrome ?? {}),
    }))
    expect(identity.ua).not.toContain('Electron')
    expect(identity.ua).not.toContain('ewe')
    expect(identity.ua).toContain('Chrome/')
    expect(identity.chrome).toEqual(expect.arrayContaining(['app', 'runtime', 'csi', 'loadTimes']))
  })

  test('the palette filters open tabs with t:', async () => {
    await shell.evaluate(() => window.ewe.send({ type: 'overlay.request', part: 'palette' }))
    const overlay = await windowWith(app, '/ui/overlay/')
    await overlay.waitForSelector('.palette input')
    await overlay.keyboard.type('t: example')
    await expect.poll(() => overlay.locator('.palette-row').count()).toBeGreaterThanOrEqual(1)
    await overlay.keyboard.press('Enter')
    await expect.poll(() => activeUrl(shell)).toContain('example')
    await expect.poll(() => overlayVisible(app)).toBe(false)
  })

  test('right-click on a rail tab opens the context menu over the page', async () => {
    const overlay = await openTabMenu(app, shell, 0)
    const grown = await overlayHeight(app)
    expect(grown.overlay).toBe(grown.window)
    const labels = await overlay.locator('.menu-item .menu-label').allTextContents()
    expect(labels).toEqual([
      'Reload',
      'Duplicate',
      'Pin',
      'Mute',
      'Move to workspace',
      'Copy url',
      'Close',
      'Close others',
      'Close to the right',
    ])
    await overlay.keyboard.press('Escape')
    await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
    await expect.poll(() => overlayVisible(app)).toBe(false)
  })

  test('the tab menu duplicates, closes others and moves a tab to a new workspace', async () => {
    expect(await tabUrls(shell)).toEqual(['app://home/', 'https://example.org/'])
    const overlay = await openTabMenu(app, shell, 1)
    await overlay.locator('.menu-item', { hasText: 'Duplicate' }).click()
    await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
    await expect
      .poll(() => tabUrls(shell))
      .toEqual(['app://home/', 'https://example.org/', 'https://example.org/'])
    const afterDuplicate = await shell.evaluate(() => window.ewe.getState())
    expect(afterDuplicate?.activeTabId).toBe(afterDuplicate?.tabs[2]?.id)
    await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)

    await openTabMenu(app, shell, 2)
    await overlay.locator('.menu-item', { hasText: 'Close others' }).click()
    await expect.poll(() => tabUrls(shell)).toEqual(['https://example.org/'])
    await expect.poll(() => overlay.locator('.menu').count()).toBe(0)

    await openTabMenu(app, shell, 0)
    expect(await overlay.locator('.menu-item.disabled .menu-label').allTextContents()).toEqual([
      'Close others',
      'Close to the right',
    ])
    await overlay.locator('.menu-item', { hasText: 'Move to workspace' }).hover()
    await overlay.waitForSelector('.menu.submenu')
    await overlay.locator('.menu.submenu .menu-item', { hasText: 'New workspace' }).click()
    await expect
      .poll(() => shell.evaluate(async () => (await window.ewe.getState())?.workspaces.length))
      .toBe(2)
    const moved = await shell.evaluate(() => window.ewe.getState())
    const target = moved?.workspaces[1]
    expect(moved?.tabs[0]?.workspaceId).toBe(target?.id)
    expect(moved?.activeWorkspaceId).toBe(target?.id)
    expect(moved?.activeTabId).toBe(moved?.tabs[0]?.id)
    await shell.evaluate(() => window.ewe.send({ type: 'overlay.request', part: 'none' }))
    await expect.poll(() => overlayVisible(app)).toBe(false)
  })
})

test('workspaces group tabs, persist, and history suggests visited pages', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-ws-'))
  const first = await launch(userData)
  const shell = await shellOf(first)
  await shell.evaluate(() => window.ewe.send({ type: 'tab.create', url: 'https://example.com/' }))
  await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
  await shell.evaluate(() =>
    window.ewe.send({ type: 'workspace.create', name: 'Work', color: 'sky' }),
  )
  await expect
    .poll(() => shell.evaluate(async () => (await window.ewe.getState())?.workspaces.length))
    .toBe(2)
  const snapshot = await shell.evaluate(() => window.ewe.getState())
  const work = snapshot?.workspaces.find((w) => w.name === 'Work')
  expect(work).toMatchObject({ color: 'sky' })
  expect(snapshot?.activeWorkspaceId).toBe(work?.id)
  expect(snapshot?.tabs.filter((t) => t.workspaceId === work?.id).map((t) => t.url)).toEqual([
    'app://newtab/',
  ])
  await shell.evaluate(
    (id) => window.ewe.send({ type: 'workspace.update', id, name: 'Deep work' }),
    work?.id ?? '',
  )
  await expect
    .poll(() => shell.evaluate(async () => (await window.ewe.getState())?.workspaces[1]?.name))
    .toBe('Deep work')
  const suggestions = await shell.evaluate(() => window.ewe.suggest('exam'))
  expect(suggestions.map((s) => s.host)).toContain('example.com')
  await new Promise((r) => setTimeout(r, 1500))
  await first.close()

  const second = await launch(userData)
  const shell2 = await shellOf(second)
  await expect
    .poll(() =>
      shell2.evaluate(async () => (await window.ewe.getState())?.workspaces.map((w) => w.name)),
    )
    .toEqual(['Home', 'Deep work'])
  const restored = await shell2.evaluate(() => window.ewe.getState())
  expect(restored?.workspaces[1]?.id).toBe(restored?.activeWorkspaceId)
  const again = await shell2.evaluate(() => window.ewe.suggest('exam'))
  expect(again.map((s) => s.host)).toContain('example.com')
  await second.close()
})

test('workspaces in the rail: dot menu, inline rename, move tabs here, remove', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-wsmenu-'))
  const app = await launch(userData)
  const shell = await shellOf(app)
  await shell.evaluate(() =>
    window.ewe.send({ type: 'workspace.create', name: 'Work', color: 'sky' }),
  )
  await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'settings' }))
  await expect
    .poll(() => shell.evaluate(async () => (await window.ewe.getState())?.tabs.length))
    .toBe(3)
  await expect(shell.locator('.rail-ws-dot')).toHaveCount(2)
  await expect(shell.locator('.rail-ws-head-name')).toHaveText('Work')
  const overlay = await windowWith(app, '/ui/overlay/')

  await openWorkspaceMenu(app, shell, overlay, 1)
  const grown = await overlayHeight(app)
  expect(grown.overlay).toBe(grown.window)
  expect(await overlay.locator('.menu-item .menu-label').allTextContents()).toEqual([
    'Rename',
    'Move tabs here',
    'Remove',
  ])
  expect(await overlay.locator('.menu-swatch').count()).toBe(8)
  expect(await overlay.locator('.menu-swatch.selected').getAttribute('aria-label')).toBe('sky')
  await overlay.locator('.menu-swatch[aria-label="rose"]').click()
  await expect
    .poll(() => shell.evaluate(async () => (await window.ewe.getState())?.workspaces[1]?.color))
    .toBe('rose')
  await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
  await expect.poll(() => overlayVisible(app)).toBe(false)

  await shell.locator('.rail-ws-dot').nth(0).click()
  await expect(shell.locator('.rail-ws-head-name')).toHaveText('Home')
  await openWorkspaceMenu(app, shell, overlay, 1)
  await overlay.locator('.menu-item', { hasText: 'Rename' }).click()
  await expect(shell.locator('.rail-ws-input')).toBeFocused()
  expect(await shell.locator('.rail-ws-input').inputValue()).toBe('Work')
  await shell.keyboard.type('Deep work')
  await shell.keyboard.press('Enter')
  await expect.poll(() => workspaceNames(shell)).toEqual(['Home', 'Deep work'])
  await expect(shell.locator('.rail-ws-input')).toHaveCount(0)
  await expect.poll(() => overlayVisible(app)).toBe(false)

  await shell.locator('.rail-ws-dot').nth(0).click()
  await shell.locator('.rail-ws-head').dblclick()
  await expect(shell.locator('.rail-ws-input')).toBeFocused()
  await shell.keyboard.type('Scratch')
  expect(await shell.locator('.rail-ws-input').inputValue()).toBe('Scratch')
  await shell.keyboard.press('Escape')
  await expect(shell.locator('.rail-ws-input')).toHaveCount(0)
  expect(await workspaceNames(shell)).toEqual(['Home', 'Deep work'])

  await shell.locator('.rail-ws-head').dblclick()
  await shell.keyboard.press('Control+a')
  await shell.keyboard.press('Backspace')
  await shell.keyboard.press('Enter')
  await expect(shell.locator('.rail-ws-input')).toHaveCount(0)
  expect(await workspaceNames(shell)).toEqual(['Home', 'Deep work'])

  await shell.locator('.rail-ws-head').dblclick()
  await shell.keyboard.press('Control+a')
  await shell.keyboard.type('x'.repeat(60))
  expect(await shell.locator('.rail-ws-input').inputValue()).toBe('x'.repeat(40))
  await shell.keyboard.press('Enter')
  await expect.poll(() => workspaceNames(shell).then((n) => n?.[0]?.length)).toBe(40)
  await shell.locator('.rail-ws-head').dblclick()
  await shell.keyboard.press('Control+a')
  await shell.keyboard.type('Home')
  await shell.keyboard.press('Enter')
  await expect.poll(() => workspaceNames(shell)).toEqual(['Home', 'Deep work'])

  await openWorkspaceMenu(app, shell, overlay, 0)
  await overlay.locator('.menu-item', { hasText: 'Move tabs here' }).hover()
  await overlay.waitForSelector('.menu.submenu')
  await overlay.locator('.menu.submenu .menu-item', { hasText: 'Deep work' }).click()
  await expect
    .poll(() =>
      shell.evaluate(async () => {
        const s = await window.ewe.getState()
        return s?.tabs.filter((t) => t.workspaceId === s.workspaces[0]?.id).length
      }),
    )
    .toBe(3)
  const merged = await shell.evaluate(() => window.ewe.getState())
  expect(merged?.workspaces).toHaveLength(2)
  expect(merged?.activeWorkspaceId).toBe(merged?.workspaces[0]?.id)
  expect(merged?.tabs.every((t) => t.workspaceId === merged.workspaces[0]?.id)).toBe(true)
  await expect(shell.locator('.rail-tab[data-tab]')).toHaveCount(3)

  await openWorkspaceMenu(app, shell, overlay, 1)
  await overlay.locator('.menu-item.danger').click()
  await expect.poll(() => workspaceNames(shell)).toEqual(['Home'])
  expect(await shell.evaluate(async () => (await window.ewe.getState())?.tabs.length)).toBe(3)

  await openWorkspaceMenu(app, shell, overlay, 0)
  expect(await overlay.locator('.menu-item.disabled .menu-label').allTextContents()).toEqual([
    'Move tabs here',
    'Remove',
  ])
  await overlay.keyboard.press('Escape')
  await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
  await expect.poll(() => overlayVisible(app)).toBe(false)
  await app.close()
})

test('opens the home page from open.internal', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-home-'))
  const app = await launch(userData)
  const shell = await shellOf(app)
  const first = await shell.evaluate(async () => (await window.ewe.getState())?.tabs[0]?.kind)
  expect(first).toBe('home')
  await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'settings' }))
  await expect.poll(() => activeUrl(shell)).toBe('app://settings/')
  await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'home' }))
  await expect.poll(() => activeUrl(shell)).toBe('app://home/')
  const active = await shell.evaluate(async () => {
    const s = await window.ewe.getState()
    return s?.tabs.find((t) => t.id === s.activeTabId)?.kind
  })
  expect(active).toBe('home')
  await app.close()
})

test('keyboard movement selects tabs and workspaces, opens home and follows remaps', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-keys-'))
  const app = await launch(userData)
  const shell = await shellOf(app)
  const send = (command: ShellCommand) => shell.evaluate((c) => window.ewe.send(c), command)
  const settle = async () => {
    await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
    await new Promise((r) => setTimeout(r, 300))
  }
  await send({ type: 'tab.create', url: 'app://settings/', activate: false })
  await send({ type: 'tab.create', url: 'app://newtab/', activate: false })
  await expect.poll(() => tabCount(shell)).toBe(3)
  await settle()

  await sendKey(app, '2', ['alt'])
  await expect.poll(() => activeUrl(shell)).toBe('app://settings/')
  await settle()
  await sendKey(app, '3', ['control'])
  await expect.poll(() => activeUrl(shell)).toBe('app://newtab/')
  await settle()
  await sendKey(app, '1', ['alt'])
  await expect.poll(() => activeUrl(shell)).toBe('app://home/')
  await settle()
  await sendKey(app, '9', ['alt'])
  await expect.poll(() => activeUrl(shell)).toBe('app://newtab/')

  await send({ type: 'workspace.create', name: 'Second' })
  await expect
    .poll(() => shell.evaluate(async () => (await window.ewe.getState())?.workspaces.length))
    .toBe(2)
  const workspaceIndex = () =>
    shell.evaluate(async () => {
      const s = await window.ewe.getState()
      return s?.workspaces.findIndex((w) => w.id === s.activeWorkspaceId)
    })
  await expect.poll(workspaceIndex).toBe(1)
  await settle()
  await sendKey(app, '1', ['alt', 'shift'])
  await expect.poll(workspaceIndex).toBe(0)
  await settle()
  await sendKey(app, '2', ['alt', 'shift'])
  await expect.poll(workspaceIndex).toBe(1)
  await settle()
  await sendKey(app, 'Left', ['control', 'alt'])
  await expect.poll(workspaceIndex).toBe(0)
  expect(await tabCount(shell)).toBe(4)
  await settle()
  await sendKey(app, 'Right', ['control', 'alt'])
  await expect.poll(workspaceIndex).toBe(1)
  await settle()
  await sendKey(app, '9', ['alt', 'shift'])
  await expect.poll(workspaceIndex).toBe(1)
  await sendKey(app, '1', ['alt', 'shift'])
  await expect.poll(workspaceIndex).toBe(0)
  await settle()

  const before = await tabCount(shell)
  await sendKey(app, 'Home', ['alt'])
  await expect.poll(() => tabCount(shell)).toBe(before + 1)
  await expect.poll(() => activeUrl(shell)).toBe('app://home/')
  await settle()

  await send({ type: 'settings.update', patch: { shortcuts: { home: ['Ctrl+J'] } } })
  await expect
    .poll(() => shell.evaluate(async () => (await window.ewe.getSettings())?.shortcuts.home))
    .toEqual(['Ctrl+J'])
  await sendKey(app, 'Home', ['alt'])
  await new Promise((r) => setTimeout(r, 500))
  expect(await tabCount(shell)).toBe(before + 1)
  await sendKey(app, 'j', ['control'])
  await expect.poll(() => tabCount(shell)).toBe(before + 2)

  await send({ type: 'settings.update', patch: { shortcuts: {} } })
  await expect
    .poll(() =>
      shell.evaluate(
        async () => Object.keys((await window.ewe.getSettings())?.shortcuts ?? {}).length,
      ),
    )
    .toBe(0)
  await settle()
  await sendKey(app, 'Home', ['alt'])
  await expect.poll(() => tabCount(shell)).toBe(before + 3)
  await app.close()
})

test('recording on the settings page keeps shortcuts from firing', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-record-'))
  const app = await launch(userData)
  const shell = await shellOf(app)
  await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'settings' }))
  await expect.poll(() => activeUrl(shell)).toBe('app://settings/')
  await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
  const settings = await windowWith(app, 'app://settings')
  await settings.getByText('New tab', { exact: true }).first().waitFor()
  const row = settings.locator('.shortcut', { hasText: 'Reopen closed tab' })
  await row.getByRole('button', { name: 'Edit' }).click()
  await expect(row.locator('.recording-hint')).toBeVisible()
  const count = await tabCount(shell)
  await sendKey(app, 'j', ['control', 'shift'])
  await expect(row.locator('.kbd').first()).toHaveText('Ctrl')
  await expect(row.locator('.recording-hint')).toHaveCount(0)
  await expect
    .poll(() => shell.evaluate(async () => (await window.ewe.getSettings())?.shortcuts))
    .toEqual({ 'tab.reopen': ['Ctrl+Shift+J'] })
  expect(await tabCount(shell)).toBe(count)
  await sendKey(app, 't', ['control'])
  await expect.poll(() => overlayVisible(app)).toBe(true)
  await app.close()
})

test('pinned tabs sit first, survive close others and a restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-pin-'))
  const first = await launch(userData)
  const shell = await shellOf(first)
  const send = (command: Parameters<typeof window.ewe.send>[0]) =>
    shell.evaluate((c) => window.ewe.send(c), command)
  await send({ type: 'tab.create', url: 'https://example.com/' })
  await send({ type: 'tab.create', url: 'app://settings/', activate: false })
  await expect
    .poll(() => tabUrls(shell))
    .toEqual(['app://home/', 'https://example.com/', 'app://settings/'])
  await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
  const [home = '', example = '', settings = ''] = await tabIds(shell)

  await send({ type: 'tab.pin', id: settings, pinned: true })
  await expect
    .poll(() => tabUrls(shell))
    .toEqual(['app://settings/', 'app://home/', 'https://example.com/'])
  expect(await tabPins(shell)).toEqual([true, false, false])
  await send({ type: 'tab.pin', id: example, pinned: true })
  await expect
    .poll(() => tabUrls(shell))
    .toEqual(['app://settings/', 'https://example.com/', 'app://home/'])
  expect(await tabPins(shell)).toEqual([true, true, false])

  await send({ type: 'tab.move', id: home, index: 0 })
  await send({ type: 'tab.move', id: settings, index: 5 })
  await expect
    .poll(() => tabUrls(shell))
    .toEqual(['https://example.com/', 'app://settings/', 'app://home/'])

  await send({ type: 'tab.closeOthers', id: home })
  await expect.poll(() => activeUrl(shell)).toBe('app://home/')
  expect(await tabUrls(shell)).toEqual(['https://example.com/', 'app://settings/', 'app://home/'])

  await send({ type: 'tab.duplicate', id: example })
  await expect
    .poll(() => tabUrls(shell))
    .toEqual(['https://example.com/', 'app://settings/', 'https://example.com/', 'app://home/'])
  expect(await tabPins(shell)).toEqual([true, true, false, false])
  await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)

  await send({ type: 'tab.closeRight', id: example })
  await expect.poll(() => tabUrls(shell)).toEqual(['https://example.com/', 'app://settings/'])
  await expect.poll(() => activeUrl(shell)).toBe('https://example.com/')

  await send({ type: 'tab.pin', id: settings, pinned: false })
  await expect.poll(() => tabPins(shell)).toEqual([true, false])
  expect(await tabUrls(shell)).toEqual(['https://example.com/', 'app://settings/'])
  await new Promise((r) => setTimeout(r, 1500))
  await first.close()

  const second = await launch(userData)
  const shell2 = await shellOf(second)
  await expect.poll(() => tabUrls(shell2)).toEqual(['https://example.com/', 'app://settings/'])
  expect(await tabPins(shell2)).toEqual([true, false])
  await expect.poll(() => activeUrl(shell2)).toBe('https://example.com/')
  await second.close()
})

test('restores tabs after a restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-restore-'))
  const first = await launch(userData)
  const shell = await shellOf(first)
  await shell.evaluate(() => window.ewe.send({ type: 'tab.create', url: 'https://example.com/' }))
  await shell.evaluate(() =>
    window.ewe.send({ type: 'tab.create', url: 'app://settings/', activate: false }),
  )
  await expect.poll(() => tabCount(shell)).toBe(3)
  await expect.poll(() => activeUrl(shell)).toBe('https://example.com/')
  await new Promise((r) => setTimeout(r, 1500))
  await first.close()

  const second = await launch(userData)
  const shell2 = await shellOf(second)
  await expect.poll(() => tabCount(shell2)).toBe(3)
  const urls = await shell2.evaluate(async () =>
    (await window.ewe.getState())?.tabs.map((t) => t.url),
  )
  expect(urls).toEqual(['app://home/', 'https://example.com/', 'app://settings/'])
  await expect.poll(() => activeUrl(shell2)).toBe('https://example.com/')
  await second.close()
})

test('bookmarks: Ctrl+D, the star, b: in the palette, Chrome import, the sidebar, a restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-bm-'))
  const fixture = join(__dirname, '../fixtures/chrome-bookmarks.json')
  const first = await launch(userData, { EWE_CHROME_BOOKMARKS: fixture })
  const shell = await shellOf(first)
  const send = (command: ShellCommand) => shell.evaluate((c) => window.ewe.send(c), command)
  const settle = async () => {
    await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
    await new Promise((r) => setTimeout(r, 300))
  }
  await send({ type: 'tab.create', url: 'https://example.com/' })
  await expect.poll(() => activeUrl(shell)).toBe('https://example.com/')
  await settle()
  expect(await bookmarkUrls(shell)).toEqual([])

  await sendKey(first, 'd', ['control'])
  await expect.poll(() => bookmarkUrls(shell)).toEqual(['https://example.com/'])
  await expect.poll(() => overlayVisible(first)).toBe(true)
  const overlay = await windowWith(first, '/ui/overlay/')
  await expect(overlay.locator('.toast')).toHaveText('Bookmark added')
  await expect.poll(() => overlayVisible(first), { timeout: 5_000 }).toBe(false)
  await sendKey(first, 'd', ['control'])
  await expect.poll(() => bookmarkUrls(shell)).toEqual([])
  await expect(overlay.locator('.toast')).toHaveText('Bookmark removed')
  await expect.poll(() => overlayVisible(first), { timeout: 5_000 }).toBe(false)

  expect(await shell.locator('.rail-star.on').count()).toBe(0)
  await shell.locator('.rail-star').click()
  await expect.poll(() => bookmarkUrls(shell)).toEqual(['https://example.com/'])
  await expect(shell.locator('.rail-star.on')).toHaveCount(1)
  await expect.poll(() => overlayVisible(first), { timeout: 5_000 }).toBe(false)

  await send({ type: 'open.internal', page: 'settings' })
  await expect.poll(() => activeUrl(shell)).toBe('app://settings/')
  await settle()
  await send({ type: 'overlay.request', part: 'palette' })
  await overlay.waitForSelector('.palette input')
  await overlay.keyboard.type('b: exam')
  await expect(overlay.locator('.palette-row .palette-label')).toHaveText(['Example Domain'])
  await overlay.keyboard.press('Enter')
  await expect.poll(() => activeUrl(shell), { timeout: 15_000 }).toBe('https://example.com/')
  await expect.poll(() => overlayVisible(first)).toBe(false)
  await settle()
  const ids = await tabIds(shell)
  const openUrls = (await tabUrls(shell)) ?? []
  for (const [i, url] of openUrls.entries()) {
    const id = ids[i]
    if (url === 'https://example.com/' && id !== undefined) await send({ type: 'tab.close', id })
  }
  await expect.poll(() => tabUrls(shell)).toEqual(['app://home/'])
  await settle()
  await send({ type: 'overlay.request', part: 'palette' })
  await overlay.waitForSelector('.palette input')
  await overlay.keyboard.type('exam')
  await expect(overlay.locator('.palette-row .palette-label')).toHaveText([
    'exam',
    'Example Domain',
  ])
  await expect(overlay.locator('.palette-row').nth(1).locator('.palette-hint')).toHaveText(
    'example.com',
  )
  await overlay.keyboard.press('Escape')
  await overlay.keyboard.press('Escape')
  await expect.poll(() => overlayVisible(first)).toBe(false)

  await send({ type: 'open.internal', page: 'settings' })
  await expect.poll(() => activeUrl(shell)).toBe('app://settings/')
  await settle()
  const settings = await windowWith(first, 'app://settings')
  await settings.getByRole('button', { name: 'Import' }).click()
  await expect(settings.locator('.row-desc', { hasText: 'Imported 6 bookmarks' })).toBeVisible()
  await expect.poll(() => bookmarkUrls(shell).then((u) => u.length)).toBe(7)
  await settings.getByRole('button', { name: 'Import' }).click()
  await expect(settings.locator('.row-desc', { hasText: 'Imported 6 bookmarks' })).toBeVisible()
  await new Promise((r) => setTimeout(r, 500))
  expect(await bookmarkUrls(shell)).toHaveLength(7)

  await shell.locator('.rail-sidebar-btn[data-section="bookmarks"]').click()
  await expect.poll(() => sidebarSection(shell)).toBe('bookmarks')
  const sidebar = await windowWith(first, '/ui/sidebar/')
  await expect.poll(() => viewWidths(first)).toMatchObject({ sidebar: 360, rest: 8 })
  await expect(sidebar.locator('.sb-search input')).toBeFocused()
  const today = new Date().toISOString().slice(0, 10)
  const labels = () => sidebar.locator('.sb-row .sb-label').allTextContents()
  await expect.poll(labels).toEqual(['Example Domain', `Imported from Chrome (${today})`])
  await sidebar.locator('.sb-row.folder', { hasText: 'Imported from Chrome' }).click()
  await expect
    .poll(labels)
    .toEqual([
      'Example Domain',
      `Imported from Chrome (${today})`,
      'Bookmarks bar',
      'Other bookmarks',
    ])
  await sidebar.locator('.sb-row.folder', { hasText: 'Other bookmarks' }).click()
  await sidebar.locator('.sb-row', { hasText: 'Hyprland Wiki' }).click({ button: 'right' })
  await sidebar.waitForSelector('.sb-menu-backdrop .menu')
  expect(await sidebar.locator('.menu-item .menu-label').allTextContents()).toEqual([
    'Open',
    'Open in new tab',
    'Edit',
    'Delete',
  ])
  await sidebar.locator('.menu-item', { hasText: 'Delete' }).click()
  await expect.poll(() => bookmarkUrls(shell).then((u) => u.length)).toBe(6)
  await expect(sidebar.locator('.sb-menu-backdrop')).toHaveCount(0)
  await sidebar.locator('.sb-row', { hasText: 'geist' }).click({ button: 'right' })
  await sidebar.locator('.menu-item', { hasText: 'Edit' }).click()
  await expect(sidebar.locator('.sb-input').first()).toBeFocused()
  await sidebar.keyboard.type('Geist')
  await sidebar.keyboard.press('Enter')
  await expect(sidebar.locator('.sb-row', { hasText: 'Geist' })).toHaveCount(1)
  await sidebar.locator('.sb-new-folder').click()
  await expect(sidebar.locator('.sb-input').first()).toBeFocused()
  await sidebar.keyboard.type('Reading')
  await sidebar.keyboard.press('Enter')
  await expect(sidebar.locator('.sb-row.folder', { hasText: 'Reading' })).toHaveCount(1)
  await sidebar.locator('.sb-search input').fill('sheep')
  await expect(sidebar.locator('.sb-row .sb-label')).toHaveText(['Sheep - Wikipedia'])
  await expect(sidebar.locator('.sb-row .sb-hint')).toHaveText([
    `Imported from Chrome (${today}) / Bookmarks bar`,
  ])
  await sidebar.locator('.sb-row', { hasText: 'Sheep' }).click()
  await expect
    .poll(() => activeUrl(shell), { timeout: 15_000 })
    .toBe('https://en.wikipedia.org/wiki/Sheep')
  expect(await sidebarSection(shell)).toBe('bookmarks')
  await settle()
  await sendKey(first, 'b', ['control', 'shift'])
  await expect.poll(() => sidebarSection(shell)).toBeNull()
  await expect.poll(() => viewWidths(first)).toMatchObject({ sidebar: 0, rest: 8 })
  await sendKey(first, 'j', ['control'])
  await expect.poll(() => sidebarSection(shell)).toBe('downloads')
  await new Promise((r) => setTimeout(r, 1000))
  await first.close()

  const second = await launch(userData)
  const shell2 = await shellOf(second)
  await expect.poll(() => bookmarkUrls(shell2).then((u) => u.length)).toBe(6)
  await expect.poll(() => sidebarSection(shell2)).toBe('downloads')
  const urls = await bookmarkUrls(shell2)
  expect(urls).toContain('https://example.com/')
  expect(urls).toContain('https://geist.vercel.app/')
  expect(urls).not.toContain('https://wiki.hyprland.org/')
  await second.close()
})

test('downloads and history live in the sidebar', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-dl-'))
  const downloadsDir = mkdtempSync(join(tmpdir(), 'ewe-e2e-dl-files-'))
  const server = await serve({
    '/page.html': {
      body: '<!doctype html><title>Sheep page</title><a href="/report.txt">get</a>',
      type: 'text/html',
    },
    '/report.txt': { body: 'baa '.repeat(1000), type: 'text/plain', attachment: true },
  })
  const app = await launch(userData, { EWE_DOWNLOADS: downloadsDir })
  try {
    const shell = await shellOf(app)
    const send = (command: ShellCommand) => shell.evaluate((c) => window.ewe.send(c), command)
    const downloads = () =>
      shell.evaluate(async () =>
        (await window.ewe.getDownloads()).map((d) => [d.filename, d.status]),
      )
    await send({ type: 'tab.create', url: `${server.url}/page.html` })
    await expect.poll(() => activeLoading(shell), { timeout: 15_000 }).toBe(false)
    await send({ type: 'tab.navigate', input: `${server.url}/report.txt` })
    await expect.poll(downloads, { timeout: 15_000 }).toEqual([['report.txt', 'completed']])
    expect(readFileSync(join(downloadsDir, 'report.txt'), 'utf8')).toBe('baa '.repeat(1000))
    const overlay = await windowWith(app, '/ui/overlay/')
    await expect(overlay.locator('.toast')).toContainText('report.txt')
    await send({ type: 'tab.navigate', input: `${server.url}/report.txt` })
    await expect.poll(downloads, { timeout: 15_000 }).toEqual([
      ['report (1).txt', 'completed'],
      ['report.txt', 'completed'],
    ])
    expect(existsSync(join(downloadsDir, 'report (1).txt'))).toBe(true)
    const firstId = await shell.evaluate(async () => (await window.ewe.getDownloads())[1]?.id ?? '')
    await send({ type: 'download', id: firstId, action: 'show' })
    await expect
      .poll(() => activeUrl(shell))
      .toBe(`app://files/?path=${encodeURIComponent(downloadsDir)}&select=report.txt`)
    const filesTab = await windowWith(app, 'app://files/')
    await expect(filesTab.locator('.fm-tile.selected .fm-name')).toHaveText('report.txt')
    await send({ type: 'tab.navigate', input: `${server.url}/page.html` })

    await send({ type: 'sidebar.toggle', section: 'downloads' })
    const sidebar = await windowWith(app, '/ui/sidebar/')
    await expect(sidebar.locator('.sb-download-name')).toHaveText(['report (1).txt', 'report.txt'])
    await expect(sidebar.locator('.sb-download-status').first()).toContainText('4.0 KB')
    await sidebar.locator('.sb-download').first().hover()
    await sidebar.locator('.sb-download').first().locator('.sb-remove').click()
    await expect(sidebar.locator('.sb-download-name')).toHaveText(['report.txt'])
    expect(existsSync(join(downloadsDir, 'report (1).txt'))).toBe(true)
    await sidebar.locator('.sb-clear').click()
    await expect(sidebar.locator('.sb-download')).toHaveCount(0)
    await expect(sidebar.locator('.sb-empty-title')).toHaveText('No downloads yet')

    await sidebar.locator('.sb-tab[data-section="history"]').click()
    await expect.poll(() => sidebarSection(shell)).toBe('history')
    await expect(sidebar.locator('.sb-visit .sb-label')).toHaveText(['Sheep page'])
    await expect(sidebar.locator('.sb-group')).toHaveText(['Today'])
    await sidebar.locator('.sb-search input').fill('nothing here')
    await expect(sidebar.locator('.sb-empty-title')).toHaveText('No matching pages')
    await sidebar.locator('.sb-search input').fill('')
    await sidebar.locator('.sb-visit').first().hover()
    await sidebar.locator('.sb-visit .sb-remove').click()
    await expect(sidebar.locator('.sb-empty-title')).toHaveText('No history yet')
    expect(await shell.evaluate(() => window.ewe.suggest('sheep'))).toEqual([])

    await sidebar.keyboard.press('Escape')
    await expect.poll(() => sidebarSection(shell)).toBeNull()
  } finally {
    await app.close()
    server.close()
  }
})

test('follows ewe theme tokens live, including radius, fonts and motion', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-theme-'))
  const config = mkdtempSync(join(tmpdir(), 'ewe-e2e-xdg-'))
  const dir = join(config, 'quickshell')
  mkdirSync(dir, { recursive: true })
  const tokens = (accent: string, primary: number, durBase: number) =>
    JSON.stringify({
      version: 3,
      input: { variant: 'dark' },
      scheme: { name: 'Test', variant: 'dark' },
      color: { accent, 'surface-base': '#101418' },
      shape: { primary },
      motion: { durFast: 100, durBase, durSlow: 300, speed: 1 },
      type: { css: { sans: '"Geist", sans-serif', mono: '"Geist Mono", monospace' } },
    })
  const file = join(dir, 'theme-tokens.json')
  writeFileSync(file, tokens('#62a8f5', 14, 220))
  const app = await launch(userData, { XDG_CONFIG_HOME: config })
  try {
    const shell = await shellOf(app)
    const css = (name: string) =>
      shell.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name)
    await expect.poll(() => css('--accent')).toBe('#62a8f5')
    expect(await css('--primary')).toBe('14px')
    expect(await css('--dur-base')).toBe('220ms')
    const background = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor())
    await expect.poll(background).toMatch(/^#(ff)?101418$/i)
    writeFileSync(`${file}.tmp`, tokens('#e5675b', 6, 180))
    renameSync(`${file}.tmp`, file)
    await expect.poll(() => css('--accent'), { timeout: 5_000 }).toBe('#e5675b')
    expect(await css('--primary')).toBe('6px')
    expect(await css('--dur-base')).toBe('180ms')
    await shell.evaluate(() =>
      window.ewe.send({ type: 'settings.update', patch: { theme: 'light' } }),
    )
    await expect.poll(() => css('--accent')).not.toBe('#e5675b')
    expect(await css('--primary')).toBe('6px')
  } finally {
    await app.close()
  }
})

test('files: browse, create, rename, copy and paste, trash, address bar and guards', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-files-'))
  const root = mkdtempSync(join(tmpdir(), 'ewe-e2e-tree-'))
  const trashDir = mkdtempSync(join(tmpdir(), 'ewe-e2e-trash-'))
  const cache = mkdtempSync(join(tmpdir(), 'ewe-e2e-cache-'))
  mkdirSync(join(root, 'Photos'))
  mkdirSync(join(root, 'Inbox'))
  writeFileSync(join(root, 'notes.md'), '# hi\n')
  writeFileSync(join(root, 'readme.markdown'), '# Flock\n\nShear **Tuesday**.\n')
  writeFileSync(join(root, 'tool.ts'), 'const ewe: number = 1\nexport default ewe\n')
  writeFileSync(join(root, '.secret'), 'x')
  writeFileSync(join(root, 'Photos', 'pixel.png'), readFileSync(join(__dirname, 'pixel.png')))
  const app = await launch(userData, { EWE_TRASH_DIR: trashDir, XDG_CACHE_HOME: cache })
  try {
    const shell = await shellOf(app)
    const send = (command: ShellCommand) => shell.evaluate((c) => window.ewe.send(c), command)
    await send({ type: 'tab.navigate', input: root })
    await expect.poll(() => activeUrl(shell)).toContain('app://files/')
    const page = await windowWith(app, 'app://files/')
    const names = () => page.locator('.fm-tile .fm-name').allTextContents()
    await expect.poll(names).toEqual(['Inbox', 'Photos', 'notes.md', 'readme.markdown', 'tool.ts'])
    await page.locator('.fm-tile', { hasText: 'readme.markdown' }).dblclick()
    await expect(page.locator('.tv-markdown h1')).toHaveText('Flock')
    await expect(page.locator('.tv-markdown strong')).toHaveText('Tuesday')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.mv-name')).toHaveText('tool.ts')
    await expect(page.locator('.tv-source .hljs-keyword').first()).toHaveText('const')
    await expect(page.locator('.tv-gutter')).toHaveText('1\n2\n3')
    await page.keyboard.press('Escape')
    await expect(page.locator('.mv')).toHaveCount(0)
    await expect(page.locator('.fm-status-text')).toContainText('2 folders, 3 files')
    await expect.poll(() => page.title()).toBe(root.split('/').pop())
    await expect(shell.locator('.rail-tab.active .rail-tab-label')).toHaveText(
      root.split('/').pop() ?? '',
    )

    await page.locator('.fm-new-folder').click()
    await expect(page.locator('.fm-rename')).toBeFocused()
    await page.keyboard.type('Shearing')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(root, 'Shearing'))).toBe(true)
    await expect
      .poll(names)
      .toEqual(['Inbox', 'Photos', 'Shearing', 'notes.md', 'readme.markdown', 'tool.ts'])

    await page.locator('.fm-tile', { hasText: 'notes.md' }).click()
    await page.keyboard.press('F2')
    await expect(page.locator('.fm-rename')).toBeFocused()
    await page.keyboard.type('flock')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(root, 'flock.md'))).toBe(true)

    await page.locator('.fm-tile', { hasText: 'flock.md' }).click()
    await page.keyboard.press('Control+c')
    await page.locator('.fm-tile', { hasText: 'Inbox' }).dblclick()
    await expect.poll(() => pathOfActive(shell)).toBe(join(root, 'Inbox'))
    await expect(page.locator('.fm-empty-title')).toHaveText('This folder is empty')
    await page.keyboard.press('Control+v')
    await expect.poll(() => existsSync(join(root, 'Inbox', 'flock.md'))).toBe(true)
    expect(existsSync(join(root, 'flock.md'))).toBe(true)
    await page.locator('.fm-tile', { hasText: 'flock.md' }).click()
    await page.keyboard.press('Delete')
    await expect.poll(() => existsSync(join(root, 'Inbox', 'flock.md'))).toBe(false)
    expect(existsSync(join(trashDir, 'flock.md'))).toBe(true)

    await page.keyboard.press('Backspace')
    await expect.poll(() => pathOfActive(shell)).toBe(root)
    await page.locator('.fm-tile', { hasText: 'Photos' }).dblclick()
    await expect(page.locator('.fm-tile .fm-name')).toHaveText(['pixel.png'])
    await expect(page.locator('.fm-icon.has-thumb')).toHaveCount(1)
    await page.locator('.fm-tile', { hasText: 'pixel.png' }).dblclick()
    await expect(page.locator('.mv .mv-name')).toHaveText('pixel.png')
    await expect(page.locator('.mv-image')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.mv')).toHaveCount(0)

    await page.locator('.fm-tile', { hasText: 'pixel.png' }).click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Compress' }).hover()
    await page.locator('.menu.submenu .menu-item', { hasText: 'pixel.png.zip' }).click()
    await expect.poll(() => existsSync(join(root, 'Photos', 'pixel.png.zip'))).toBe(true)
    await page.locator('.fm-tile', { hasText: 'pixel.png.zip' }).dblclick()
    await expect(page.locator('.ad-summary')).toContainText('1 file')
    await page.locator('.ad-extract').click()
    await expect.poll(() => existsSync(join(root, 'Photos', 'pixel.png', 'pixel.png'))).toBe(false)
    await expect
      .poll(() => existsSync(join(root, 'Photos', 'pixel.png (1)', 'pixel.png')))
      .toBe(true)
    await expect(page.locator('.ad-backdrop')).toHaveCount(0)
    const guard = await page.evaluate(async () => {
      const raw = await fetch('app://files/raw?path=/etc/hostname')
      return raw.status
    })
    expect(guard).toBe(403)
    expect(await shell.evaluate(() => window.ewe.fs({ op: 'places' }))).toEqual({
      ok: false,
      error: 'Not allowed',
    })

    await send({ type: 'tab.navigate', input: `${root}/Photos/../` })
    await expect.poll(() => pathOfActive(shell)).toBe(root)
    await page.locator('.fm-content').click()
    await page.keyboard.press('.')
    await expect(page.locator('.fm-filter input')).toBeFocused()
    await expect(page.locator('.fm-filter input')).toHaveValue('.')
    await page.keyboard.press('Escape')
    await page.locator('[aria-label="Hidden files"]').click()
    await expect.poll(names).toContain('.secret')
    await send({ type: 'tab.navigate', input: join(root, 'Photos') })
    await expect.poll(() => pathOfActive(shell)).toBe(join(root, 'Photos'))
    await page
      .locator('.fm-tile')
      .filter({ has: page.locator('.fm-name', { hasText: /^pixel\.png$/ }) })
      .click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Open in new tab' }).click()
    await expect.poll(() => tabCount(shell)).toBeGreaterThan(1)
    await expect
      .poll(async () => {
        for (const w of app.windows()) {
          if (!w.url().startsWith('app://files/') || w === page) continue
          if ((await w.locator('.mv .mv-name').count()) > 0)
            return w.locator('.mv .mv-name').textContent()
        }
        return null
      })
      .toBe('pixel.png')
  } finally {
    await app.close()
  }
})

test('settings can hand folders to ewe browser and give them back, in a temp XDG profile', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-mime-'))
  const config = mkdtempSync(join(tmpdir(), 'ewe-e2e-mime-config-'))
  const data = mkdtempSync(join(tmpdir(), 'ewe-e2e-mime-data-'))
  const realList = join(process.env.HOME ?? '', '.config', 'mimeapps.list')
  const before = existsSync(realList) ? readFileSync(realList, 'utf8') : null
  const app = await launch(userData, { XDG_CONFIG_HOME: config, XDG_DATA_HOME: data })
  try {
    const shell = await shellOf(app)
    await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'settings' }))
    const settings = await windowWith(app, 'app://settings')
    const button = settings.locator('.settings-default-folders')
    await expect(button).toHaveText('Use ewe browser')
    await button.click()
    await expect(button).toHaveText('Give back')
    expect(readFileSync(join(data, 'applications', 'ewe-browser.desktop'), 'utf8')).toContain(
      'MimeType=inode/directory;',
    )
    expect(readFileSync(join(config, 'mimeapps.list'), 'utf8')).toContain(
      'inode/directory=ewe-browser.desktop',
    )
    await button.click()
    await expect(button).toHaveText('Use ewe browser')
    const defaults = readFileSync(join(config, 'mimeapps.list'), 'utf8')
      .split('[Default Applications]')[1]
      ?.split('\n[')[0]
    expect(defaults).not.toContain('inode/directory=ewe-browser.desktop')
    expect(await shell.evaluate(() => window.ewe.defaultHandler(true))).toBeNull()
  } finally {
    await app.close()
  }
  expect(existsSync(realList) ? readFileSync(realList, 'utf8') : null).toBe(before)
})

function silentTrack(path: string, tags: Record<string, string>, cover?: string): void {
  const args = ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']
  if (cover !== undefined) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'copy')
  for (const [key, value] of Object.entries(tags)) args.push('-metadata', `${key}=${value}`)
  args.push('-t', '6', '-id3v2_version', '3', path)
  execFileSync('ffmpeg', args)
}

test('music: library views, playback, next track and MPRIS', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-music-'))
  const musicDir = mkdtempSync(join(tmpdir(), 'ewe-e2e-music-lib-'))
  const cache = mkdtempSync(join(tmpdir(), 'ewe-e2e-music-cache-'))
  mkdirSync(join(musicDir, 'Flock', 'Pasture'), { recursive: true })
  silentTrack(
    join(musicDir, 'Flock', 'Pasture', '01 Morning.mp3'),
    { title: 'Morning', artist: 'The Flock', album: 'Pasture', track: '1', date: '2024' },
    join(__dirname, 'pixel.png'),
  )
  silentTrack(join(musicDir, 'Flock', 'Pasture', '02 Shearing.mp3'), {
    title: 'Shearing',
    artist: 'The Flock',
    album: 'Pasture',
    track: '2',
  })
  silentTrack(join(musicDir, 'lone.mp3'), { title: 'Lone Ewe', artist: 'Solo', album: 'Hills' })
  const app = await launch(userData, { EWE_MUSIC_DIR: musicDir, XDG_CACHE_HOME: cache })
  try {
    const shell = await shellOf(app)
    await shell.locator('.rail-music').click()
    const page = await windowWith(app, 'app://music/')
    await expect(page.locator('.mu-tile-title')).toHaveText(['Hills', 'Pasture'])
    await page.locator('.mu-nav-item[data-view="artists"]').click()
    await expect(page.locator('.mu-artist .mu-title')).toHaveText(['Solo', 'The Flock'])
    await page.locator('.mu-nav-item[data-view="songs"]').click()
    await expect(page.locator('.mu-track .mu-title')).toHaveCount(3)
    await page.locator('.mu-nav-item[data-view="albums"]').click()
    await page.locator('.mu-tile', { hasText: 'Pasture' }).click()
    await expect(page.locator('.mu-hero h1')).toHaveText('Pasture')
    await expect(page.locator('.mu-hero .mu-sub')).toContainText('2024 · 2 songs')
    await expect(page.locator('.mu-hero .mu-cover img')).toHaveCount(1)
    await page.locator('.mu-play-all').click()
    await expect(page.locator('.mu-now .mu-title')).toHaveText('Morning')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0))
      .toBeGreaterThan(0.5)
    await expect.poll(() => page.title()).toBe('Morning · The Flock')
    const pid = await app.evaluate(() => process.pid)
    const players = await expect
      .poll(() => {
        try {
          return execFileSync('busctl', ['--user', 'list', '--no-pager'], { encoding: 'utf8' })
            .split('\n')
            .filter((l) => l.includes('org.mpris.MediaPlayer2') && l.includes(String(pid))).length
        } catch {
          return -1
        }
      })
      .toBeGreaterThan(0)
      .then(
        () => true,
        () => false,
      )
    console.log(`mpris player for pid ${pid}: ${players}`)
    await page.locator('[aria-label="Next"]').click()
    await expect(page.locator('.mu-now .mu-title')).toHaveText('Shearing')
    await page.keyboard.press('Space')
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.paused)).toBe(true)
    const before = await tabCount(shell)
    await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'home' }))
    await shell.locator('.rail-music').click()
    await expect.poll(() => activeUrl(shell)).toBe('app://music/')
    expect(await tabCount(shell)).toBe(before + 1)
    await page.locator('.mu-search input').fill('lone')
    await expect(page.locator('.mu-track .mu-title')).toHaveText(['Lone Ewe'])
  } finally {
    await app.close()
  }
})

test('ewe plugins: password picker through ewe-pass, web panels, background start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-e2e-plugins-'))
  const userData = join(dir, 'profile')
  const log = join(dir, 'pass.log')
  const tool = join(dir, 'ewe-pass')
  writeFileSync(
    tool,
    [
      '#!/bin/sh',
      `echo "$@" >> '${log}'`,
      'case "$1" in',
      `  status) echo '{"ok": true, "provider": "pass", "label": "pass", "ready": true}' ;;`,
      `  match) echo '{"ok": true, "items": [{"id": "gh", "title": "Sheep login", "username": "ewe", "host": "127.0.0.1", "score": 5}, {"id": "mail", "title": "Mail", "username": "ram", "host": "mail.example", "score": 1}]}' ;;`,
      `  *) echo '{"ok": true}' ;;`,
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  const server = await serve({
    '/login.html': {
      body: '<!doctype html><title>Sheep login</title><form><input name="user" id="user"><input type="password" id="pw"></form>',
      type: 'text/html',
    },
  })
  const env = { EWE_PASS: tool }
  const app = await launch(userData, env)
  const shell = await shellOf(app)
  await shell.evaluate(
    (url) => window.ewe.send({ type: 'tab.navigate', input: url }),
    `${server.url}/login.html`,
  )
  await expect.poll(() => activeUrl(shell)).toBe(`${server.url}/login.html`)
  await expect.poll(() => activeLoading(shell)).toBe(false)

  await sendKey(app, 'L', ['control', 'shift'])
  const overlay = await windowWith(app, '/ui/overlay/')
  await expect(overlay.locator('.passwords .pw-row')).toHaveCount(2)
  await expect(overlay.locator('.passwords .palette-chip')).toHaveText('127.0.0.1')
  expect(readFileSync(log, 'utf8')).toContain('match --class ewe-browser --title 127.0.0.1')
  await overlay.locator('.passwords input').press('Control+c')
  await expect.poll(() => readFileSync(log, 'utf8')).toContain('copy gh --what password')

  await shell.evaluate(() => window.ewe.send({ type: 'passwords.open' }))
  await expect(overlay.locator('.passwords .pw-row')).toHaveCount(2)
  await overlay.locator('.passwords input').press('Enter')
  const pid = await app.evaluate(() => process.pid)
  await expect.poll(() => readFileSync(log, 'utf8')).toContain(`fill gh --pid ${pid} --what login`)
  await expect.poll(() => overlayVisible(app)).toBe(false)
  const loginPage = await windowWith(app, '/login.html')
  expect(await loginPage.evaluate(() => document.activeElement?.id)).toBe('user')

  await shell.evaluate(() => window.ewe.send({ type: 'sidebar.toggle', section: 'bookmarks' }))
  const sidebar = await windowWith(app, '/ui/sidebar/')
  await sidebar.locator('.sb-add-panel').click()
  await expect.poll(() => sidebarSection(shell)).toBe('panel:127-0-0-1')
  const panelViews = () =>
    app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) return []
      return win.contentView.children
        .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
        .filter((v) => v.getVisible() && v.webContents.getURL().endsWith('/login.html'))
        .map((v) => v.getBounds())
    })
  await expect.poll(async () => (await panelViews()).length).toBe(2)
  const [, panel] = await panelViews()
  const width = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentBounds().width ?? 0,
  )
  expect(panel?.y).toBe(44)
  expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBe(width)
  await expect(sidebar.locator('.sb-panel-tab')).toHaveCount(1)
  await sidebar.locator('.sb-tab[data-section="history"]').click()
  await expect.poll(async () => (await panelViews()).length).toBe(1)
  await sidebar.locator('.sb-panel-tab').click()
  await expect.poll(async () => (await panelViews()).length).toBe(2)
  await sidebar.locator('.sb-panel-remove').click()
  await expect.poll(async () => (await panelViews()).length).toBe(1)
  expect(await shell.evaluate(async () => (await window.ewe.getSettings())?.panels.length)).toBe(0)

  await shell.evaluate(() =>
    window.ewe.send({ type: 'settings.update', patch: { background: true } }),
  )
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0)
  const electronPath = createRequire(__filename)('electron') as unknown as string
  const started = Date.now()
  execFileSync(electronPath, [MAIN], {
    env: { ...process.env, EWE_USER_DATA: userData, ...env },
    timeout: 20_000,
  })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1)
  console.log(`window back after ${Date.now() - started}ms`)
  const reopened = await shellOf(app)
  await expect.poll(() => activeUrl(reopened)).toBe(`${server.url}/login.html`)
  await app.close()

  const background = await electron.launch({
    args: [MAIN, '--background'],
    env: { ...process.env, EWE_USER_DATA: userData, ...env },
  })
  await new Promise((r) => setTimeout(r, 1500))
  expect(
    await background.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
  ).toBe(0)
  execFileSync(electronPath, [MAIN], {
    env: { ...process.env, EWE_USER_DATA: userData, ...env },
    timeout: 20_000,
  })
  await expect
    .poll(() => background.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1)
  await background.close()
  server.close()
})

test('extensions: load, rail button with badge, popup in the window, menu, settings, remove', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-e2e-ext-'))
  const fixture = join(__dirname, '../fixtures/extension')
  const app = await launch(join(dir, 'profile'), { EWE_EXTENSIONS: join(dir, 'Extensions') })
  const shell = await shellOf(app)
  const server = await serve({
    '/flock.html': { body: '<!doctype html><title>Flock</title><p>sheep</p>', type: 'text/html' },
  })
  await shell.evaluate(
    (url) => window.ewe.send({ type: 'tab.navigate', input: url }),
    `${server.url}/flock.html`,
  )
  await expect.poll(() => activeLoading(shell)).toBe(false)
  const id = await app.evaluate(async ({ session }, path) => {
    const ext = await session.fromPartition('persist:default').extensions.loadExtension(path)
    return ext.id
  }, fixture)
  const button = shell.locator(`.ext-action[data-extension="${id}"]`)
  await expect(button).toBeVisible()
  await expect(button.locator('img')).toHaveJSProperty('naturalWidth', 32)
  await expect(button.locator('.ext-badge')).toHaveText('3', { timeout: 15_000 })

  const views = () =>
    app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) return []
      return win.contentView.children
        .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
        .filter(
          (v) =>
            v.getVisible() &&
            v.getBounds().x >= 0 &&
            v.webContents.getURL().startsWith('chrome-extension://'),
        )
        .map((v) => ({ bounds: v.getBounds(), title: v.webContents.getTitle() }))
    })
  await button.click()
  await expect.poll(async () => (await views()).length).toBe(1)
  await expect.poll(async () => (await views())[0]?.title).toBe('popup:1')
  await expect.poll(async () => (await views())[0]?.bounds.width).toBe(260)
  const [popup] = await views()
  const box = await button.boundingBox()
  expect(popup?.bounds.x).toBe(Math.round(box?.x ?? 0))
  expect(popup?.bounds.y).toBeGreaterThan((box?.y ?? 0) + (box?.height ?? 0))
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await button.click()
  await expect.poll(async () => (await views()).length).toBe(0)

  await button.click({ button: 'right' })
  const overlay = await windowWith(app, '/ui/overlay/')
  await expect(overlay.locator('.menu-item', { hasText: 'Options' })).toBeVisible()
  await overlay.locator('.menu-item', { hasText: 'Options' }).click()
  await expect.poll(() => activeUrl(shell)).toBe(`chrome-extension://${id}/options.html`)

  await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'settings' }))
  const settings = await windowWith(app, 'app://settings')
  const row = settings.locator(`.settings-extension[data-extension="${id}"]`)
  await expect(row).toContainText('Flock Counter')
  await expect(row).toContainText('1.2.0')
  await row.locator('.settings-ext-remove').click()
  await expect(row).toHaveCount(0)
  await expect(shell.locator('.ext-action')).toHaveCount(0)
  await app.close()
  server.close()
})

function davServer() {
  const files = new Map<string, { body: string; etag: string }>()
  let n = 0
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    if (req.headers.authorization === undefined) {
      res.writeHead(401)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const file = files.get(path)
      if (req.method === 'MKCOL') {
        res.writeHead(201)
      } else if (req.method === 'GET') {
        if (file === undefined) res.writeHead(404)
        else {
          res.writeHead(200, { etag: file.etag, 'content-type': 'application/json' })
          res.end(file.body)
          return
        }
      } else if (req.method === 'PUT') {
        const ifMatch = req.headers['if-match']
        const ifNone = req.headers['if-none-match']
        if (
          (ifNone === '*' && file !== undefined) ||
          (ifMatch !== undefined && file?.etag !== ifMatch)
        ) {
          res.writeHead(412)
        } else {
          files.set(path, { body: Buffer.concat(chunks).toString('utf8'), etag: `"${++n}"` })
          res.writeHead(201)
        }
      } else res.writeHead(405)
      res.end()
    })
  })
  return new Promise<{ url: string; files: typeof files; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/dav/ewe/browser/`,
        files,
        close: () => server.close(),
      })
    })
  })
}

test('sync: two profiles merge bookmarks, history and settings through Nextcloud WebDAV', async () => {
  const dav = await davServer()
  const dir = mkdtempSync(join(tmpdir(), 'ewe-e2e-sync-'))
  const env = { EWE_SYNC_URL: dav.url }
  const remote = (name: string) => {
    const file = dav.files.get(`/dav/ewe/browser/${name}.json`)
    return file === undefined ? null : (JSON.parse(file.body) as { data: Record<string, unknown> })
  }
  const urls = (shell: Page) =>
    shell.evaluate(async () => {
      const root = await window.ewe.getBookmarks()
      const out: string[] = []
      const walk = (nodes: NonNullable<typeof root>['children']) => {
        for (const n of nodes) {
          if (n.kind === 'bookmark') out.push(n.url)
          else walk(n.children)
        }
      }
      walk(root?.children ?? [])
      return out.sort()
    })
  const syncNow = async (app: ElectronApplication, shell: Page) => {
    await shell.evaluate(() => window.ewe.send({ type: 'open.internal', page: 'settings' }))
    const settings = await windowWith(app, 'app://settings')
    await expect(settings.locator('.settings-sync-now')).toBeEnabled()
    await settings.locator('.settings-sync-now').click()
    await expect(settings.locator('.settings-sync-status')).toContainText('Synced')
    return settings
  }

  const a = await launch(join(dir, 'a'), env)
  const shellA = await shellOf(a)
  await shellA.evaluate(() => {
    void window.ewe.send({ type: 'bookmark.add', url: 'https://ewe.example/x', title: 'X' })
    void window.ewe.send({
      type: 'settings.update',
      patch: { sync: true, searchEngine: 'duckduckgo' },
    })
  })
  await syncNow(a, shellA)
  expect(
    Object.values(remote('bookmarks')?.data ?? {}).map((b) => (b as { url?: string }).url),
  ).toContain('https://ewe.example/x')
  expect(remote('settings')?.data.searchEngine).toBe('duckduckgo')
  await a.close()

  const b = await launch(join(dir, 'b'), env)
  const shellB = await shellOf(b)
  await shellB.evaluate(() => {
    void window.ewe.send({ type: 'bookmark.add', url: 'https://ewe.example/y', title: 'Y' })
    void window.ewe.send({ type: 'settings.update', patch: { sync: true } })
  })
  await syncNow(b, shellB)
  await expect.poll(() => urls(shellB)).toEqual(['https://ewe.example/x', 'https://ewe.example/y'])
  expect(await shellB.evaluate(async () => (await window.ewe.getSettings())?.searchEngine)).toBe(
    'duckduckgo',
  )
  const xId = await shellB.evaluate(async () => {
    const root = await window.ewe.getBookmarks()
    return root?.children.find((n) => n.kind === 'bookmark' && n.url.endsWith('/x'))?.id ?? ''
  })
  await shellB.evaluate((id) => window.ewe.send({ type: 'bookmark.remove', id }), xId)
  await syncNow(b, shellB)
  await expect
    .poll(() =>
      Object.values(remote('bookmarks')?.data ?? {}).map((x) => (x as { url?: string }).url),
    )
    .toEqual(['https://ewe.example/y'])
  await b.close()

  const a2 = await launch(join(dir, 'a'), env)
  const shellA2 = await shellOf(a2)
  await expect.poll(() => urls(shellA2), { timeout: 20_000 }).toEqual(['https://ewe.example/y'])
  await a2.close()
  dav.close()
})
