import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { ShellCommand } from '@ewe/shared'
import { davMock } from '../support/dav-mock'

const MAIN = join(__dirname, '../../out/main/index.js')

async function windowWith(app: ElectronApplication, part: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((w) => w.url().includes(part)), { timeout: 20_000 })
    .toBe(true)
  const page = app.windows().find((w) => w.url().includes(part))
  if (page === undefined) throw new Error(`window ${part} not found`)
  await page.waitForLoadState('domcontentloaded')
  return page
}

const SHOTS = process.env.EWE_SYNC_SHOTS

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

function snapshot(folders: Record<string, unknown>[]): string {
  return JSON.stringify({
    version: 1,
    updated_at: Math.floor(Date.now() / 1000),
    signed_in: true,
    account: 'sam on cloud.example.test',
    auto: true,
    state: 'idle',
    folders,
  })
}

test('under ewe: sync follows the account, ewe-sync gets the buttons, files know synced folders', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ewe-e2e-sync-'))
  const home = join(root, 'home')
  const config = join(root, 'config')
  const state = join(root, 'state')
  const bin = join(root, 'bin')
  const log = join(root, 'ewe-sync.log')
  for (const dir of [
    join(home, 'Documents'),
    join(home, 'Work'),
    join(home, 'Fresh'),
    join(config, 'ewe'),
    join(state, 'ewe'),
    bin,
  ])
    mkdirSync(dir, { recursive: true })
  writeFileSync(join(config, 'user-dirs.dirs'), 'XDG_DOCUMENTS_DIR="$HOME/Documents"\n')
  writeFileSync(
    join(config, 'ewe', 'cloud.json'),
    JSON.stringify({ server: 'https://cloud.example.test', login_name: 'sam', user: 'sam' }),
  )
  writeFileSync(
    join(bin, 'ewe-conf'),
    '#!/bin/sh\n[ "$1 $2" = "get sync.browser" ] && { echo true; exit 0; }\nexit 1\n',
  )
  writeFileSync(join(bin, 'ewe-sync'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`)
  chmodSync(join(bin, 'ewe-conf'), 0o755)
  chmodSync(join(bin, 'ewe-sync'), 0o755)
  const documents = { local: join(home, 'Documents'), name: 'Documents', state: 'synced' }
  const work = { local: join(home, 'Work'), name: 'Work', state: 'syncing' }
  const snapshotPath = join(state, 'ewe', 'sync-folders.json')
  writeFileSync(snapshotPath, snapshot([documents, work]))
  const logged = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')

  const dav = await davMock()
  const app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      EWE_USER_DATA: join(root, 'profile'),
      HOME: home,
      XDG_CONFIG_HOME: config,
      XDG_STATE_HOME: state,
      XDG_DATA_HOME: join(root, 'data'),
      EWE_BIN: bin,
      EWE_SYNC_URL: dav.url,
      EWE_SYNC_MANAGED: '1',
    },
  })
  try {
    const shell = await windowWith(app, '/ui/shell/')
    await shell.waitForFunction(() => typeof window.ewe === 'object')
    const send = (command: ShellCommand) => shell.evaluate((c) => window.ewe.send(c), command)

    await send({ type: 'open.internal', page: 'settings' })
    const settings = await windowWith(app, 'app://settings')
    const account = settings.locator('.settings-sync-account')
    await expect(account).toContainText('Sync with your ewe account')
    await expect(account).toContainText('sync with your ewe account')
    await expect(settings.locator('select.settings-sync')).toHaveCount(0)
    await expect(settings.locator('.settings-sync-now')).toHaveCount(0)
    await expect(settings.locator('.settings-sync-status')).toContainText(/Synced \d/, {
      timeout: 15_000,
    })
    await account.scrollIntoViewIfNeeded()
    await shot(app, 'sync-01-settings-managed')
    await expect.poll(() => dav.read('bookmarks.json')).not.toBeNull()
    await settings.getByRole('button', { name: 'Manage in ewe-sync' }).click()
    await expect.poll(logged).toContain('--pane overview')

    const before = dav.requests.length
    writeFileSync(join(state, 'ewe', 'sync-now'), String(Date.now()))
    await expect.poll(() => dav.requests.length, { timeout: 10_000 }).toBeGreaterThan(before)

    await send({ type: 'tab.navigate', input: join(home, 'Documents') })
    const files = await windowWith(app, 'app://files/')
    await expect(files.locator('.fm-group')).toContainText(['Places', 'Synced'])
    await expect(files.locator('[data-place="xdg-documents"] .fm-place-sync')).toHaveCount(1)
    await expect(
      files.locator(`[data-place="synced-${join(home, 'Work')}"] .fm-place-sync.syncing`),
    ).toHaveCount(1)
    const chip = files.locator('.fm-sync-chip')
    await expect(chip).toHaveText('In your account')
    await shot(app, 'sync-02-files-synced')

    writeFileSync(snapshotPath, snapshot([{ ...documents, state: 'conflict', conflicts: 2 }, work]))
    await expect(chip).toHaveText('2 conflicts', { timeout: 10_000 })
    await shot(app, 'sync-03-files-conflict')
    await chip.click()
    await expect.poll(logged).toContain('--pane folders')

    await files.locator('.fm-crumb', { hasText: 'Home' }).click()
    await files.locator('.fm-tile', { hasText: 'Fresh' }).click({ button: 'right' })
    await expect(files.locator('.menu-item', { hasText: 'Keep in your account…' })).toBeVisible()
    await shot(app, 'sync-04-files-keep-menu')
    await files.locator('.menu-item', { hasText: 'Keep in your account…' }).click()
    await expect.poll(logged).toContain(`--add-folder ${join(home, 'Fresh')}`)
    await files.locator('.fm-tile', { hasText: 'Documents' }).click({ button: 'right' })
    await expect(files.locator('.menu-item', { hasText: 'Sync settings…' })).toBeVisible()
    await expect(files.locator('.menu-item', { hasText: 'Keep in your account…' })).toHaveCount(0)
    await shot(app, 'sync-05-files-settings-menu')
    if (SHOTS !== undefined) {
      await files.keyboard.press('Escape')
      await send({ type: 'settings.update', patch: { theme: 'dark' } })
      await expect
        .poll(() => files.evaluate(() => document.documentElement.dataset.theme))
        .toBe('dark')
      await shot(app, 'sync-06-files-grid-dark')
      await files.locator('.fm-tile', { hasText: 'Documents' }).dblclick()
      await expect(chip).toBeVisible()
      await shot(app, 'sync-07-files-dark')
      const opened = app.windows().length
      await send({ type: 'open.internal', page: 'settings' })
      await expect.poll(() => app.windows().length).toBeGreaterThan(opened)
      const dark = app
        .windows()
        .filter((w) => w.url().includes('app://settings'))
        .at(-1)
      if (dark === undefined) throw new Error('no settings page')
      await dark.locator('.settings-sync-account').scrollIntoViewIfNeeded()
      await shot(app, 'sync-08-settings-dark')
    }
  } finally {
    await app.close()
    await dav.close()
  }
})
