import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inPage, launch, serve, shellOf, visit, windowWith } from './wave2-support'

// Spelling as ewe sets it ([desktop.language] in ewe.conf through a fake ewe-conf) and
// "Play in ewe Player" (a fake ewe-player on $EWE_PLAYER_BIN logging its argv).
// Chromium checks with its own en-US .bdic: `EWE_TEST_BDIC_DIR` (a folder holding
// en-US-*.bdic) is copied into the profile, else Chromium downloads it on first use.

const html = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="data:,"></head><body style="font:20px sans-serif;margin:40px">${body}</body></html>`

function fakeTools(dir: string, language: object): { bin: string; log: string; player: string } {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const log = join(dir, 'calls.log')
  const conf = join(dir, 'language.json')
  writeFileSync(conf, JSON.stringify(language))
  writeFileSync(
    join(bin, 'ewe-conf'),
    `#!/bin/sh\necho "ewe-conf $*" >> '${log}'\nif [ "$1 $2" = "get desktop.language" ]; then cat '${conf}'; exit 0; fi\n[ "$1" = get ] && exit 1\nexit 0\n`,
  )
  const player = join(bin, 'ewe-player')
  writeFileSync(player, `#!/bin/sh\necho "ewe-player $*" >> '${log}'\n`)
  for (const f of ['ewe-conf', 'ewe-player']) chmodSync(join(bin, f), 0o755)
  return { bin, log, player }
}

function seedDictionary(profile: string): void {
  const from = process.env.EWE_TEST_BDIC_DIR
  if (from === undefined || !existsSync(from)) return
  const to = join(profile, 'Dictionaries')
  mkdirSync(to, { recursive: true })
  for (const f of readdirSync(from))
    if (f.endsWith('.bdic')) copyFileSync(join(from, f), join(to, f))
}

function events(app: ElectronApplication, list: Electron.MouseInputEvent[]): Promise<void> {
  return app.evaluate(({ BrowserWindow, WebContentsView }, l) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    const view = (win?.contentView.children ?? [])
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
    for (const e of l) view?.webContents.sendInputEvent(e)
  }, list)
}

async function rightClickAt(app: ElectronApplication, at: { x: number; y: number }) {
  await events(app, [
    { type: 'mouseMove', x: at.x, y: at.y },
    { type: 'mouseDown', x: at.x, y: at.y, button: 'right', clickCount: 1 },
    { type: 'mouseUp', x: at.x, y: at.y, button: 'right', clickCount: 1 },
  ])
}

// the middle of a word inside the textarea, in view coordinates
function wordAt(page: Page, word: string): Promise<{ x: number; y: number }> {
  return page.evaluate((w) => {
    const ta = document.getElementById('ta') as HTMLTextAreaElement
    const i = ta.value.indexOf(w)
    const mirror = document.createElement('div')
    const cs = getComputedStyle(ta)
    for (const p of ['font', 'padding', 'border', 'width', 'lineHeight', 'letterSpacing'] as const)
      mirror.style[p] = cs[p]
    mirror.style.position = 'absolute'
    mirror.style.whiteSpace = 'pre-wrap'
    const r = ta.getBoundingClientRect()
    mirror.style.left = `${String(r.left)}px`
    mirror.style.top = `${String(r.top)}px`
    const span = document.createElement('span')
    mirror.append(ta.value.slice(0, i), span)
    span.textContent = w
    document.body.append(mirror)
    const b = span.getBoundingClientRect()
    mirror.remove()
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
  }, word)
}

async function menuFor(app: ElectronApplication, at: { x: number; y: number }): Promise<Page> {
  const overlay = await windowWith(app, '/ui/overlay/')
  await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
  await rightClickAt(app, at)
  await expect(overlay.locator('.menu')).toBeVisible()
  return overlay
}

const labels = (overlay: Page) => overlay.locator('.menu .menu-item .menu-label').allInnerTexts()

async function pick(overlay: Page, label: string): Promise<void> {
  await overlay.locator('.menu .menu-item', { hasText: label }).first().click()
  await expect.poll(() => overlay.locator('.menu').count()).toBe(0)
}

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox()
  if (box === null) throw new Error(`${selector} has no box`)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

test('spelling follows ewe: suggestions, Add to dictionary, Ignore, the settings group', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-spell-'))
  const tools = fakeTools(dir, { spellcheck: ['en_US', 'ka_GE'], check_spelling: true })
  const profile = join(dir, 'profile')
  mkdirSync(profile, { recursive: true })
  seedDictionary(profile)
  const site = await serve({
    '/write': html(
      'Write',
      '<textarea id="ta" spellcheck="true" rows="3" cols="40">I shear sheeep and woool today</textarea>',
    ),
  })
  const app = await launch(profile, { EWE_BIN: tools.bin, EWE_PLAYER_BIN: tools.player })
  try {
    const languages = await app.evaluate(({ session }) =>
      session.fromPartition('persist:default').getSpellCheckerLanguages(),
    )
    expect(languages).toEqual(['en-US'])
    const shell = await shellOf(app)
    await visit(shell, `${site.url}/write`)
    const page = app.windows().find((w) => w.url().endsWith('/write'))
    if (page === undefined) throw new Error('no page')
    await page.click('#ta')
    await page.keyboard.press('End')
    await page.keyboard.type(' ')

    // Chromium marks the word once its dictionary is loaded
    const opened: { menu: Page | null } = { menu: null }
    await expect
      .poll(
        async () => {
          const menu = await menuFor(app, await wordAt(page, 'sheeep'))
          opened.menu = menu
          const items = await labels(menu)
          if (!items.includes('Add to dictionary')) await menu.keyboard.press('Escape')
          return items.includes('Add to dictionary')
        },
        { timeout: 45_000, intervals: [1500] },
      )
      .toBe(true)
    const overlay = opened.menu
    if (overlay === null) throw new Error('no menu')
    const items = await labels(overlay)
    expect(items).toContain('sheep')
    if ((process.env.EWE_SPELL_SHOTS ?? '') !== '') {
      mkdirSync(process.env.EWE_SPELL_SHOTS ?? '', { recursive: true })
      await overlay.waitForTimeout(400)
      await overlay
        .locator('.menu')
        .screenshot({ path: join(process.env.EWE_SPELL_SHOTS ?? '', 'menu-spelling.png') })
    }
    expect(
      items.slice(items.indexOf('Add to dictionary'), items.indexOf('Add to dictionary') + 2),
    ).toEqual(['Add to dictionary', 'Ignore'])
    await pick(overlay, 'Ignore')
    await expect
      .poll(() => inPage<string>(app, `document.getElementById('ta').value`))
      .toContain('sheeep')
    await expect
      .poll(() => {
        try {
          return (
            JSON.parse(readFileSync(join(profile, 'spelling-ignored.json'), 'utf8')) as {
              words: string[]
            }
          ).words
        } catch {
          return []
        }
      })
      .toEqual(['sheeep'])
    const again = await menuFor(app, await wordAt(page, 'sheeep'))
    expect(await labels(again)).not.toContain('Add to dictionary')
    await again.keyboard.press('Escape')
    await expect.poll(() => again.locator('.menu').count()).toBe(0)

    const wool = await menuFor(app, await wordAt(page, 'woool'))
    expect(await labels(wool)).toContain('wool')
    await pick(wool, 'wool')
    await expect
      .poll(() => inPage<string>(app, `document.getElementById('ta').value`))
      .toContain('I shear sheeep and wool today')

    // Settings → Browsing → Spelling: the languages, Georgian marked, the switch writes ewe.conf
    await visit(shell, 'app://settings/#browsing')
    const settings = await windowWith(app, 'app://settings')
    await expect(settings.locator('.settings-spelling-languages')).toHaveText(
      'English (United States), Georgian (Georgia)',
    )
    await expect(settings.locator('.settings-spelling-missing')).toHaveText(
      "Georgian (Georgia) isn't checked in ewe Browser yet",
    )
    const shots = process.env.EWE_SPELL_SHOTS ?? ''
    if (shots !== '') {
      mkdirSync(shots, { recursive: true })
      await settings.waitForTimeout(400)
      await settings
        .locator('.settings-group', { hasText: 'Spelling' })
        .screenshot({ path: join(shots, 'settings-spelling-on.png') })
    }
    await settings.locator('.settings-spelling').click()
    await expect
      .poll(() => (existsSync(tools.log) ? readFileSync(tools.log, 'utf8') : ''))
      .toContain('ewe-conf set desktop.language.check_spelling false')
    await expect
      .poll(() =>
        app.evaluate(({ session }) =>
          session.fromPartition('persist:default').isSpellCheckerEnabled(),
        ),
      )
      .toBe(false)
    if (shots !== '') {
      await settings.waitForTimeout(400)
      await settings
        .locator('.settings-group', { hasText: 'Spelling' })
        .screenshot({ path: join(shots, 'settings-spelling-off.png') })
    }
  } finally {
    site.close()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Play in ewe Player: a video link, a media file and a video page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-play-'))
  const tools = fakeTools(dir, {})
  const site = await serve({
    '/links': html(
      'Links',
      `<p><a id="yt" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">A video</a></p>
       <p><a id="file" href="/clip.mp4">A clip</a></p>
       <p><a id="plain" href="/other">Not a video</a></p>`,
    ),
  })
  const app = await launch(join(dir, 'profile'), {
    EWE_BIN: tools.bin,
    EWE_PLAYER_BIN: tools.player,
  })
  try {
    const shell = await shellOf(app)
    await visit(shell, `${site.url}/links`)
    const page = app.windows().find((w) => w.url().endsWith('/links'))
    if (page === undefined) throw new Error('no page')
    let overlay = await menuFor(app, await center(page, '#plain'))
    expect(await labels(overlay)).not.toContain('Play in ewe Player')
    await overlay.keyboard.press('Escape')
    await expect.poll(() => overlay.locator('.menu').count()).toBe(0)

    overlay = await menuFor(app, await center(page, '#yt'))
    expect((await labels(overlay)).slice(0, 4)).toEqual([
      'Open link in new tab',
      'Open link in new workspace',
      'Open link in new window',
      'Play in ewe Player',
    ])
    if ((process.env.EWE_SPELL_SHOTS ?? '') !== '') {
      mkdirSync(process.env.EWE_SPELL_SHOTS ?? '', { recursive: true })
      await overlay.waitForTimeout(400)
      await overlay
        .locator('.menu')
        .screenshot({ path: join(process.env.EWE_SPELL_SHOTS ?? '', 'menu-play.png') })
    }
    await pick(overlay, 'Play in ewe Player')
    await expect
      .poll(() => (existsSync(tools.log) ? readFileSync(tools.log, 'utf8') : ''))
      .toContain('ewe-player https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    overlay = await menuFor(app, await center(page, '#file'))
    await pick(overlay, 'Play in ewe Player')
    await expect
      .poll(() => readFileSync(tools.log, 'utf8'))
      .toContain(`ewe-player ${site.url}/clip.mp4`)
  } finally {
    site.close()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
