import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { DownloadEntry, HistoryClear, ShellCommand } from '@ewe/shared'
import { davMock } from '../support/dav-mock'

const MAIN = join(__dirname, '../../out/main/index.js')
const DAY = 86_400_000

function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
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
  return shell
}

function send(shell: Page, command: ShellCommand): Promise<void> {
  return shell.evaluate((c) => window.ewe.send(c), command)
}

function activeUrl(shell: Page): Promise<string | undefined> {
  return shell.evaluate(async () => {
    const s = await window.ewe.getState()
    return s?.tabs.find((t) => t.id === s.activeTabId)?.url
  })
}

function shellKey(app: ElectronApplication, key: string, modifiers: string[]): Promise<void> {
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

function historyUrls(shell: Page): Promise<string[]> {
  return shell.evaluate(async () => (await window.ewe.history('', 1000)).map((v) => v.url).sort())
}

function seed(
  userData: string,
  entries: { url: string; title: string; last: number; count?: number }[],
): void {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'history.json'),
    JSON.stringify({
      version: 1,
      entries: entries.map((e) => ({
        url: e.url,
        title: e.title,
        host: new URL(e.url).hostname.replace(/^www\./, ''),
        count: e.count ?? 1,
        last: e.last,
      })),
    }),
  )
}

function download(id: string, started: number): DownloadEntry {
  return {
    id,
    url: `https://files.test/${id}.txt`,
    filename: `${id}.txt`,
    path: `/nonexistent/${id}.txt`,
    mime: 'text/plain',
    received: 4,
    total: 4,
    speed: 0,
    status: 'completed',
    started,
    ended: started + 10,
  }
}

function cookieServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html',
      'set-cookie': 'flock=1; Max-Age=86400; Path=/',
    })
    res.end(`<!doctype html><title>Cookie ${req.url ?? ''}</title><p>baa</p>`)
  })
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

test('history page: migration, days, search, site filter, select and delete, a whole site', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-history-'))
  const now = Date.now()
  seed(userData, [
    { url: 'https://en.wikipedia.org/wiki/Sheep', title: 'Sheep - Wikipedia', last: now - 60_000 },
    { url: 'https://www.youtube.com/watch?v=wool', title: 'Shearing wool', last: now - 120_000 },
    { url: 'https://music.youtube.com/', title: 'YouTube Music', last: now - DAY - 3_600_000 },
    { url: 'https://github.com/prj786/ewe', title: 'prj786/ewe', last: now - 3 * DAY },
    { url: 'https://example.com/', title: 'Example Domain', last: now - 3 * DAY - 1000 },
  ])
  const app = await launch(userData)
  try {
    const shell = await shellOf(app)
    expect(existsSync(join(userData, 'history.json.bak'))).toBe(true)
    expect(existsSync(join(userData, 'history.json'))).toBe(false)
    expect(existsSync(join(userData, 'history.db'))).toBe(true)
    expect(await shell.evaluate(() => window.ewe.suggest('wiki'))).toEqual([
      expect.objectContaining({ url: 'https://en.wikipedia.org/wiki/Sheep' }),
    ])

    await shellKey(app, 'H', ['control', 'shift'])
    await expect.poll(() => activeUrl(shell)).toBe('app://history/')
    const page = await windowWith(app, 'app://history')
    await expect(page.locator('.hp-day .section-header').first()).toHaveText('Today')
    await expect(page.locator('.hp-day .section-header').nth(1)).toHaveText('Yesterday')
    await expect(page.locator('.hp-visit')).toHaveCount(5)
    await expect(page.locator('.hp-summary')).toContainText('5 pages')
    await expect(page.locator('.hp-sync-off')).toBeVisible()

    await page.locator('.hp-search input').fill('shee')
    await expect(page.locator('.hp-visit .hp-title')).toHaveText(['Sheep - Wikipedia'])
    await page.locator('.hp-search input').fill('wool sh')
    await expect(page.locator('.hp-visit .hp-title')).toHaveText(['Shearing wool'])
    await page.locator('.hp-search input').fill('nothing like this')
    await expect(page.locator('.empty-title')).toHaveText('No matching pages')
    await page.locator('.hp-search input').fill('')
    await expect(page.locator('.hp-visit')).toHaveCount(5)

    await page.locator('.hp-visit', { hasText: 'Shearing wool' }).locator('.hp-host').click()
    await expect(page.locator('.hp-chip')).toContainText('youtube.com')
    await expect(page.locator('.hp-visit .hp-title')).toHaveText(['Shearing wool', 'YouTube Music'])
    await page.locator('.hp-chip button').click()
    await expect(page.locator('.hp-visit')).toHaveCount(5)

    const github = page.locator('.hp-visit', { hasText: 'prj786/ewe' })
    const example = page.locator('.hp-visit', { hasText: 'Example Domain' })
    await github.hover()
    await github.locator('.hp-check').click()
    await example.locator('.hp-check').click()
    await expect(page.locator('.hp-selection-count')).toHaveText('2 items selected')
    await page.locator('.hp-delete-selected').click()
    await expect(page.locator('.hp-dialog-title')).toHaveText('Remove 2 items from history?')
    await page.locator('.hp-selection-confirm').click()
    await expect(page.locator('.hp-visit')).toHaveCount(3)
    await expect(page.locator('.hp-notice')).toContainText('Removed 2 items')
    await expect
      .poll(() => historyUrls(shell))
      .toEqual([
        'https://en.wikipedia.org/wiki/Sheep',
        'https://music.youtube.com/',
        'https://www.youtube.com/watch?v=wool',
      ])

    await page.locator('.hp-visit', { hasText: 'Shearing wool' }).click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Delete everything from youtube.com' }).click()
    await expect(page.locator('.hp-dialog-title')).toHaveText('Delete everything from youtube.com?')
    await expect(page.locator('.hp-dialog-text')).toContainText(
      'This deletes 2 pages of youtube.com',
    )
    await page.locator('.hp-site-confirm').click()
    await expect(page.locator('.hp-visit .hp-title')).toHaveText(['Sheep - Wikipedia'])
    await expect.poll(() => historyUrls(shell)).toEqual(['https://en.wikipedia.org/wiki/Sheep'])

    await page.locator('.hp-visit').first().hover()
    await page.locator('.hp-visit .hp-remove').first().click()
    await expect(page.locator('.empty-title')).toHaveText('No history yet')
    expect(await shell.evaluate(() => window.ewe.suggest('wiki'))).toEqual([])
  } finally {
    await app.close()
  }

  const again = await launch(userData)
  try {
    const shell = await shellOf(again)
    expect(await historyUrls(shell)).toEqual([])
  } finally {
    await again.close()
  }
})

test('history page: clear browsing data by range, cookies only for all time, keep history', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-clear-'))
  const now = Date.now()
  seed(userData, [
    { url: 'https://recent.test/', title: 'Recent', last: now - 10 * 60_000 },
    { url: 'https://older.test/', title: 'Older', last: now - 3 * DAY },
    { url: 'https://ancient.test/', title: 'Ancient', last: now - 60 * DAY },
  ])
  writeFileSync(
    join(userData, 'downloads.json'),
    JSON.stringify({
      version: 1,
      entries: [download('fresh', now - 5 * 60_000), download('stale', now - 3 * DAY)],
    }),
  )
  const server = await cookieServer()
  const app = await launch(userData)
  try {
    const shell = await shellOf(app)
    const cookies = () =>
      app.evaluate(async ({ session }) =>
        (await session.fromPartition('persist:default').cookies.get({})).map((c) => c.name),
      )
    await send(shell, { type: 'tab.create', url: `${server.url}/page` })
    await expect.poll(cookies, { timeout: 15_000 }).toContain('flock')
    const downloads = () =>
      shell.evaluate(async () => (await window.ewe.getDownloads()).map((d) => d.id))

    await send(shell, { type: 'tab.create', url: 'app://history/?clear=1' })
    const page = await windowWith(app, 'app://history')
    await expect(page.locator('.hp-dialog-title')).toHaveText('Clear browsing data')
    await expect(page.locator('.hp-range')).toHaveValue('hour')
    await expect(page.locator('.hp-opt-cookies')).toBeDisabled()
    await expect(page.locator('.hp-opt-cache')).toBeDisabled()
    await expect(page.locator('.hp-badge').first()).toHaveText('All time only')
    await expect(page.locator('.hp-note')).toContainText('only be cleared for all time')
    await page.locator('.hp-clear-confirm').click()
    await expect(page.locator('.hp-notice')).toContainText('Cleared history, the downloads list')
    await expect(page.locator('.hp-dialog')).toHaveCount(0)
    await expect.poll(() => historyUrls(shell)).not.toContain('https://recent.test/')
    expect(await historyUrls(shell)).toContain('https://older.test/')
    expect(await historyUrls(shell)).not.toContain(`${server.url}/page`)
    await expect.poll(downloads).toEqual(['stale'])
    expect(await cookies()).toContain('flock')

    await page.locator('.hp-keep').selectOption('30')
    await expect.poll(() => historyUrls(shell)).not.toContain('https://ancient.test/')
    expect(await shell.evaluate(async () => (await window.ewe.getSettings())?.historyDays)).toBe(30)

    await page.locator('.hp-clear-open').click()
    await page.locator('.hp-range').selectOption('all')
    await expect(page.locator('.hp-opt-cookies')).toBeEnabled()
    await expect(page.locator('.hp-note')).toHaveCount(0)
    await page.locator('.hp-opt-cookies').check()
    await page.locator('.hp-opt-cache').check()
    await page.locator('.hp-clear-confirm').click()
    await expect(page.locator('.hp-notice')).toContainText(
      'Cleared history, cookies and site data, cached files, the downloads list',
    )
    await expect.poll(cookies).not.toContain('flock')
    await expect.poll(() => historyUrls(shell)).toEqual([])
    await expect.poll(downloads).toEqual([])
    await expect(page.locator('.empty-title')).toHaveText('No history yet')
  } finally {
    await app.close()
    server.close()
  }
})

test('opening history: sidebar button, palette row, Ctrl+H stays the sidebar', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-open-history-'))
  const app = await launch(userData)
  try {
    const shell = await shellOf(app)
    await shellKey(app, 'H', ['control'])
    await expect
      .poll(() => shell.evaluate(async () => (await window.ewe.getState())?.sidebar?.section))
      .toBe('history')
    const sidebar = await windowWith(app, '/ui/sidebar/')
    await sidebar.locator('.sb-all-history').click()
    await expect.poll(() => activeUrl(shell)).toBe('app://history/')
    const tabs = () => shell.evaluate(async () => (await window.ewe.getState())?.tabs.length ?? 0)
    const count = await tabs()
    await send(shell, { type: 'open.internal', page: 'history' })
    await new Promise((r) => setTimeout(r, 300))
    expect(await tabs()).toBe(count)

    await send(shell, { type: 'tab.create', url: 'app://newtab/' })
    await send(shell, { type: 'overlay.request', part: 'palette' })
    const overlay = await windowWith(app, '/ui/overlay/')
    await overlay.locator('.palette-search input').fill('histo')
    const row = overlay.locator('.palette-row', { hasText: 'Show all history' })
    await expect(row).toBeVisible()
    await row.click()
    await expect.poll(() => activeUrl(shell)).toBe('app://history/')
    expect(await tabs()).toBe(count + 1)
  } finally {
    await app.close()
  }
})

test('sync: a deletion and the open tabs travel between two computers', async () => {
  const dav = await davMock()
  const dir = mkdtempSync(join(tmpdir(), 'ewe-e2e-sync-history-'))
  const now = Date.now()
  const pages = [
    { url: 'https://shared.test/keep', title: 'Keep me', last: now - 2 * 60_000 },
    { url: 'https://shared.test/drop', title: 'Drop me', last: now - 60_000 },
  ]
  seed(join(dir, 'a'), pages)
  const server = await cookieServer()
  const shared = async (shell: Page) =>
    (await historyUrls(shell)).filter((u) => u.startsWith('https://shared.test/'))
  const syncNow = async (app: ElectronApplication, shell: Page) => {
    await send(shell, { type: 'open.internal', page: 'settings' })
    const settings = await windowWith(app, 'app://settings')
    await expect(settings.locator('.settings-sync-now')).toBeEnabled()
    await settings.locator('.settings-sync-now').click()
    await expect(settings.locator('.settings-sync-status')).toContainText('Synced')
  }
  try {
    const a = await launch(join(dir, 'a'), { EWE_SYNC_URL: dav.url, EWE_SYNC_MACHINE: 'kosmos' })
    const shellA = await shellOf(a)
    await send(shellA, { type: 'settings.update', patch: { sync: true } })
    await send(shellA, { type: 'tab.create', url: `${server.url}/sweater` })
    await expect.poll(() => activeUrl(shellA), { timeout: 15_000 }).toBe(`${server.url}/sweater`)
    await syncNow(a, shellA)
    const tabFiles = [...dav.files.entries()]
      .filter(([path]) => /\/tabs-[0-9a-f]{16}\.json$/.test(path))
      .map(([, file]) => JSON.parse(file.body) as { machine: string; windows: unknown })
    expect(tabFiles).toEqual([
      expect.objectContaining({
        machine: 'kosmos',
        windows: [
          {
            workspaces: [
              expect.objectContaining({
                tabs: [expect.objectContaining({ url: `${server.url}/sweater` })],
              }),
            ],
          },
        ],
      }),
    ])
    await a.close()

    const b = await launch(join(dir, 'b'), { EWE_SYNC_URL: dav.url, EWE_SYNC_MACHINE: 'ewebook' })
    const shellB = await shellOf(b)
    await send(shellB, { type: 'settings.update', patch: { sync: true } })
    await syncNow(b, shellB)
    await expect
      .poll(() => shared(shellB))
      .toEqual(['https://shared.test/drop', 'https://shared.test/keep'])

    await send(shellB, { type: 'open.internal', page: 'history' })
    const page = await windowWith(b, 'app://history')
    const machine = page.locator('.hp-machine', { hasText: 'kosmos' })
    await expect(machine).toBeVisible()
    await expect(machine.locator('.hp-remote-tab')).toHaveCount(1)
    await expect(machine.locator('.hp-remote-tab')).toContainText('Cookie /sweater')
    await send(shellB, { type: 'overlay.request', part: 'palette' })
    const overlay = await windowWith(b, '/ui/overlay/')
    await overlay.locator('.palette-search input').fill('t:sweater')
    await expect(overlay.locator('.palette-row')).toHaveCount(1)
    await expect(overlay.locator('.palette-row .palette-hint')).toContainText('kosmos · 127.0.0.1')
    await overlay.locator('.palette-search input').press('Escape')
    await overlay.locator('.palette-search input').press('Escape')

    await page.locator('.hp-visit', { hasText: 'Drop me' }).click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Remove from history' }).click()
    await expect(page.locator('.hp-visit', { hasText: 'Drop me' })).toHaveCount(0)
    await syncNow(b, shellB)
    const remote = dav.read('history.json') as { data: object; clears: HistoryClear[] }
    expect(Object.keys(remote.data).filter((u) => u.includes('shared.test'))).toEqual([
      'https://shared.test/keep',
    ])
    expect(remote.clears.map((c) => c.url)).toEqual(['https://shared.test/drop'])
    await b.close()

    const a2 = await launch(join(dir, 'a'), { EWE_SYNC_URL: dav.url, EWE_SYNC_MACHINE: 'kosmos' })
    const shellA2 = await shellOf(a2)
    await syncNow(a2, shellA2)
    await expect.poll(() => shared(shellA2)).toEqual(['https://shared.test/keep'])
    const statusPath = join(dir, 'a', 'sync', 'status.json')
    await expect.poll(() => existsSync(statusPath)).toBe(true)
    const status = JSON.parse(readFileSync(statusPath, 'utf8')) as { machine: string }
    expect(status).toMatchObject({ machine: 'kosmos' })
    await a2.close()
  } finally {
    await dav.close()
    server.close()
  }
})
