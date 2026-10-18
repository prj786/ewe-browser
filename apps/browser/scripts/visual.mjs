import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const out = resolve(process.argv[2] ?? 'docs/screenshots')
const visibleWorkspaces = () => {
  try {
    return new Set(
      JSON.parse(execFileSync('hyprctl', ['monitors', '-j'], { encoding: 'utf8' })).map((m) =>
        String(m.activeWorkspace.id),
      ),
    )
  } catch {
    return new Set()
  }
}
const pickWorkspace = (preferred) => {
  const visible = visibleWorkspaces()
  if (!visible.has(preferred)) return preferred
  for (let n = 9; n < 100; n++) if (!visible.has(String(n))) return String(n)
  return preferred
}
const targetWorkspace = pickWorkspace(process.env.EWE_VISUAL_WORKSPACE ?? '2')
const ruleBase = /^[A-Za-z_][A-Za-z0-9_]*$/.test(process.env.EWE_TEST_RULE ?? '')
  ? process.env.EWE_TEST_RULE
  : '__ewe_test_rule'
const ruleVar = `${ruleBase}_${targetWorkspace}`
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const userData = mkdtempSync(join(tmpdir(), 'ewe-visual-'))
const downloadsDir = mkdtempSync(join(tmpdir(), 'ewe-visual-dl-'))
const cacheDir = mkdtempSync(join(tmpdir(), 'ewe-visual-cache-'))
const filesDir = mkdtempSync(join(tmpdir(), 'ewe-visual-files-'))
const mockups = resolve('../../docs/mockups/step2')
for (const dir of [
  'Photos',
  'Projects/ewe-browser',
  'Music',
  'Documents',
  'A folder with a rather long name',
])
  mkdirSync(join(filesDir, dir), { recursive: true })
for (const png of readdirSync(mockups).filter((f) => f.endsWith('.png')))
  copyFileSync(join(mockups, png), join(filesDir, 'Photos', png.replace('.png', ' mockup.png')))
copyFileSync(join(mockups, 'A1.png'), join(filesDir, 'wallpaper.png'))
writeFileSync(
  join(filesDir, 'notes.md'),
  '# Flock notes\n\nShear on **Tuesday**, move the ewes to the [north pasture](https://example.org).\n\n## Checklist\n\n- Water troughs\n- Hay for 40 sheep\n- Call the vet\n\n> Count twice, shear once.\n\n```ts\nconst flock = 40\n```\n',
)
writeFileSync(
  join(filesDir, 'shear.ts'),
  [
    "import { readFile } from 'node:fs/promises'",
    '',
    'interface Ewe {',
    '  name: string',
    '  fleeceKg: number',
    '}',
    '',
    '// heaviest fleece first',
    'export async function plan(path: string): Promise<Ewe[]> {',
    "  const flock = JSON.parse(await readFile(path, 'utf8')) as Ewe[]",
    '  return flock.sort((a, b) => b.fleeceKg - a.fleeceKg).slice(0, 12)',
    '}',
    '',
  ].join('\n'),
)
copyFileSync('/usr/share/doc/xmlstarlet/xmlstarlet-ug.pdf', join(filesDir, 'manual.pdf'))
const musicDir = mkdtempSync(join(tmpdir(), 'ewe-visual-music-'))
const song = (dir, file, tags, cover) => {
  mkdirSync(join(musicDir, dir), { recursive: true })
  const args = ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']
  if (cover) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'png')
  for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`)
  args.push('-t', String(tags.seconds ?? 90), '-id3v2_version', '3', join(musicDir, dir, file))
  execFileSync('ffmpeg', args)
}
const covers = readdirSync(mockups)
  .filter((f) => f.endsWith('.png'))
  .map((f) => join(mockups, f))
const albumsSeed = [
  ['The Flock', 'Pasture', 2024, ['Morning', 'Shearing Day', 'Hay Bales', 'North Field']],
  ['Woolgatherers', 'Spindle', 2021, ['Carding', 'Long Draw', 'Skein']],
  ['Ewe & I', 'Lambing Season', 2023, ['April', 'First Steps']],
  ['Hillside', 'Drystone', 2019, ['Wall', 'Gate', 'Stile', 'Cairn', 'Ridge']],
]
albumsSeed.forEach(([artist, album, year, titles], a) => {
  titles.forEach((title, i) =>
    song(
      join(artist, album),
      `${i + 1} ${title}.mp3`,
      {
        title,
        artist,
        album,
        date: String(year),
        track: String(i + 1),
        seconds: 60 + i * 37,
      },
      covers[a % covers.length],
    ),
  )
})
writeFileSync(join(filesDir, 'budget.ods'), '')
writeFileSync(join(filesDir, 'report.pdf'), '%PDF-1.4\n')
writeFileSync(join(filesDir, 'backup.tar.gz'), Buffer.alloc(2_400_000))
writeFileSync(join(filesDir, '.hidden-config'), '')
mkdirSync(join(filesDir, 'Empty folder'))
writeFileSync(join(filesDir, 'Obsidian-1.9.AppImage'), Buffer.alloc(1_200_000))
execFileSync('bsdtar', ['-a', '-cf', join(filesDir, 'mockups.zip'), '-C', mockups, '.'])
writeFileSync(join(filesDir, 'Music', 'shepherd.flac'), Buffer.alloc(31_000_000))
try {
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=2:size=640x360:rate=10',
    join(filesDir, 'Photos', 'lambs.mp4'),
  ])
} catch {
  console.log('no ffmpeg, skipping the sample video')
}
const dataHome = mkdtempSync(join(tmpdir(), 'ewe-visual-data-'))
const recentNow = Date.now()
writeFileSync(
  join(dataHome, 'recently-used.xbel'),
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xbel version="1.0">',
    ...[
      [join(filesDir, 'manual.pdf'), 20 * 60_000],
      [join(filesDir, 'notes.md'), 45 * 60_000],
      [join(filesDir, 'Photos', 'lambs.mp4'), 3 * 3_600_000],
      [join(musicDir, 'The Flock', 'Pasture', '2 Shearing Day.mp3'), 26 * 3_600_000],
      [join(filesDir, 'budget.ods'), 4 * 86_400_000],
    ].map(([path, ago]) => {
      const t = new Date(recentNow - ago).toISOString()
      return `  <bookmark href="${pathToFileURL(path).href}" added="${t}" modified="${t}" visited="${t}"></bookmark>`
    }),
    '</xbel>',
    '',
  ].join('\n'),
)
const { startFakeSafe } = await import(resolve('tests/fake-safed.ts'))
const safeDir = mkdtempSync(join(tmpdir(), 'ewe-visual-safe-'))
const fakeSafe = await startFakeSafe(join(safeDir, 's.sock'))
process.on('exit', () => void fakeSafe.close())
const LOGIN_PAGE = `<!doctype html><meta charset="utf-8"><title>Flock Co-op · Sign in</title>
<style>body{font:15px system-ui;background:#f3efe6;display:grid;place-items:center;height:100vh;margin:0}
form{background:#fff;padding:32px;border-radius:14px;box-shadow:0 8px 30px #0002;display:grid;gap:12px;width:300px}
input{padding:10px;border:1px solid #ccc;border-radius:8px}button{padding:10px;border:0;border-radius:8px;background:#3b6e4a;color:#fff}</style>
<form onsubmit="return false"><h2>Flock Co-op</h2><input name="email" autocomplete="username" placeholder="Email"><input type="password" autocomplete="current-password" placeholder="Password"><button>Sign in</button></form>`
const ARTICLE_PAGE = `<!doctype html><meta charset="utf-8"><title>Shearing day</title>
<style>body{font:16px/1.6 Georgia,serif;margin:48px auto;max-width:640px;color:#2a2620;background:#fbf8f1}h1{font:600 30px system-ui}a{color:#3b6e4a}img{border-radius:10px;display:block;margin:16px 0}</style>
<h1>Shearing day on the north pasture</h1><p id="lede">Every spring the flock gathers by the stone wall. The sheep wait in the shade while the shearers sharpen their blades, and the sheep dogs keep watch.</p>
<p>Read the <a id="guide" href="/page.html">shearing guide</a> before you start, and count the sheep twice.</p>
<img id="photo" src="/photo.png" width="320" height="180" alt="The flock">
<p id="tail">Wool is rolled, tied and stacked in the barn. The sheep go back to the pasture lighter and happier.</p>`
const SWIPE_PAGE = (title, tone) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:${tone};color:#2a2620}</style><h1>${title}</h1>`
const CHAT_PAGE = `<!doctype html><meta charset="utf-8"><title>Flock chat</title>
<style>body{font:14px system-ui;margin:0;background:#17181c;color:#e8e6e3}header{padding:12px 16px;border-bottom:1px solid #2a2c31;font-weight:600}
.m{padding:10px 16px}.m b{display:block;color:#8ab4f8;font-size:12px}</style>
<header># shearing-day</header><div class="m"><b>Dolly</b>Shearing starts at 8, bring coffee.</div>
<div class="m"><b>Shaun</b>The north pasture gate is fixed.</div><div class="m"><b>Timmy</b>Can someone check the weather?</div>
<div class="m"><b>Dolly</b>Rain after 3pm. Keep the wool dry.</div>`
const chunk = Buffer.alloc(64 * 1024, 120)
const server = createServer((req, res) => {
  if (req.url === '/login.html' || req.url === '/chat.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(req.url === '/login.html' ? LOGIN_PAGE : CHAT_PAGE)
    return
  }
  if (req.url === '/article.html' || req.url === '/meadow.html' || req.url === '/barn.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      req.url === '/article.html'
        ? ARTICLE_PAGE
        : req.url === '/meadow.html'
          ? SWIPE_PAGE('The meadow', '#e8efd9')
          : SWIPE_PAGE('The barn', '#efe2d2'),
    )
    return
  }
  if (req.url === '/photo.png') {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(readFileSync(join(mockups, 'A1.png')))
    return
  }
  if (req.url === '/page.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Flock notes</title><h1>Flock notes</h1>')
    return
  }
  const slow = req.url === '/flock-photos.zip'
  const size = slow ? 48 * chunk.length : 6 * chunk.length
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-length': size,
    'content-disposition': 'attachment',
  })
  let sent = 0
  const tick = () => {
    if (res.destroyed) return
    if (sent >= size) {
      res.end()
      return
    }
    res.write(chunk)
    sent += chunk.length
    setTimeout(tick, slow ? 250 : 0)
  }
  tick()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
fakeSafe.addLogin('Flock Co-op', 'shepherd@flock.coop', origin, 'pw-1')
fakeSafe.addLogin('Flock Co-op (admin)', 'admin', origin, 'pw-2')
process.on('exit', () => server.close())
const lua = (code) => execFileSync('hyprctl', ['repl', code], { encoding: 'utf8' }).trim()
console.log(
  'rule',
  lua(`return (function()
  if _G.${ruleVar} then _G.${ruleVar}:set_enabled(true) return 'reused' end
  _G.${ruleVar} = hl.window_rule({
    name = 'ewe-test-${targetWorkspace}',
    match = { class = '(?i)^(ewe-browser|electron)$' },
    workspace = '${targetWorkspace} silent',
  })
  return 'created'
end)()`),
)
const dropRule = () => {
  try {
    lua(`if _G.${ruleVar} then _G.${ruleVar}:set_enabled(false) end return "off"`)
  } catch {
    return
  }
}
process.on('exit', dropRule)
const app = await electron.launch({
  args: [resolve('out/main/index.js')],
  env: {
    ...process.env,
    EWE_USER_DATA: userData,
    EWE_CHROME_BOOKMARKS: resolve('tests/fixtures/chrome-bookmarks.json'),
    EWE_DOWNLOADS: downloadsDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_DATA_HOME: dataHome,
    EWE_MUSIC_DIR: musicDir,
    EWE_SAFE_SOCKET: fakeSafe.path,
    EWE_SAFE_APP: '/nonexistent',
  },
})

const find = async (part) => {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((p) => p.url().includes(part))
    if (w) return w
    await sleep(200)
  }
  throw new Error(`no window ${part}`)
}
const shell = await find('/ui/shell/')
const overlay = await find('/ui/overlay/')
await shell.waitForFunction(() => typeof window.ewe === 'object')
const pid = await app.evaluate(() => process.pid)

const client = () =>
  JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' })).find(
    (c) => c.pid === pid,
  )
const geometry = () => {
  const c = client()
  if (!c) throw new Error('window not found in hyprctl clients')
  return { x: c.at[0], y: c.at[1], w: c.size[0], h: c.size[1], workspace: c.workspace.id }
}
for (let i = 0; i < 100 && !client(); i++) await sleep(50)
console.log('window', client()?.class, geometry())
if (String(geometry().workspace) !== targetWorkspace) {
  console.error(`window is on workspace ${geometry().workspace}, not ${targetWorkspace}; aborting`)
  await Promise.race([app.close(), sleep(3000)])
  process.exit(2)
}

const PAGE_RADIUS = 10
const capture = (crop) =>
  app.evaluate(
    async ({ BrowserWindow, WebContentsView, nativeImage }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
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
        const round = view.webContents.getURL().includes('/ui/') ? 0 : p.radius * scale
        const outside = (x, y) => {
          if (round === 0) return false
          const cx = x < round ? round : x > size.width - round ? size.width - round : x
          const cy = y < round ? round : y > size.height - round ? size.height - round : y
          return (x - cx) ** 2 + (y - cy) ** 2 > round ** 2
        }
        for (let y = 0; y < size.height; y++) {
          const ty = oy + y
          if (ty < 0 || ty >= height) continue
          for (let x = 0; x < size.width; x++) {
            const tx = ox + x
            if (tx < 0 || tx >= width || outside(x, y)) continue
            const si = (y * size.width + x) * 4
            const ti = (ty * width + tx) * 4
            const a = src[si + 3] / 255
            if (a === 0) continue
            for (let c = 0; c < 3; c++)
              pixels[ti + c] = Math.round(src[si + c] + pixels[ti + c] * (1 - a))
            pixels[ti + 3] = 255
          }
        }
      }
      let out = nativeImage.createFromBitmap(pixels, { width, height })
      if (p.crop !== null)
        out = out.crop({
          x: Math.round(p.crop.x * scale),
          y: Math.round(p.crop.y * scale),
          width: Math.round(p.crop.width * scale),
          height: Math.round(p.crop.height * scale),
        })
      return out.toPNG().toString('base64')
    },
    { crop: crop ?? null, radius: PAGE_RADIUS },
  )
const save = async (name, crop) => {
  writeFileSync(join(out, `${name}.png`), Buffer.from(await capture(crop), 'base64'))
  console.log('shot', name)
}
const contentSize = () =>
  app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0].getContentBounds()
    return { w: b.width, h: b.height }
  })
const shot = (name) => save(name)
const send = (cmd) => shell.evaluate((c) => window.ewe.send(c), cmd)
const state = () => shell.evaluate(() => window.ewe.getState())
const pageView = `(win) => win.contentView.children
  .filter((v) => v instanceof WebContentsView)
  .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))`
const hoverPage = (x, y) =>
  app.evaluate(
    ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      const view = win.contentView.children
        .filter((v) => v instanceof WebContentsView)
        .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
      view?.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    },
    { x, y },
  )
const key = (keyCode, modifiers) =>
  app.evaluate(
    ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      const view = win.contentView.children
        .filter((v) => v instanceof WebContentsView)
        .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
      const wc = view?.webContents ?? win.webContents
      wc.sendInputEvent({ type: 'keyDown', keyCode: p.keyCode, modifiers: p.modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode: p.keyCode, modifiers: p.modifiers })
    },
    { keyCode, modifiers },
  )
const edgeHover = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({
      type: 'mouseMove',
      x: 3,
      y: 400,
    }),
  )
const closeOverlay = async () => {
  await send({ type: 'overlay.request', part: 'none' })
  await sleep(350)
}
void pageView
void hoverPage

const railShot = async (name, h) => {
  const size = await contentSize()
  await save(name, { x: 0, y: 0, width: 300, height: h ?? size.h })
}
const rightShot = async (name, w = 520) => {
  const size = await contentSize()
  await save(name, { x: size.w - w, y: 0, width: w, height: size.h })
}
const barShot = async (name, w = 900, h = 72) => {
  const size = await contentSize()
  await save(name, { x: 0, y: size.h - h, width: Math.min(w, size.w), height: h })
}
const barEndShot = async (name, w = 520, h = 72) => {
  const size = await contentSize()
  await save(name, { x: size.w - w, y: size.h - h, width: w, height: h })
}
const bottomShot = async (name, w = 720, h = 140) => {
  const size = await contentSize()
  await save(name, { x: Math.round((size.w - w) / 2), y: size.h - h, width: w, height: h })
}
const settle = async (ms = 2500) => {
  for (let i = 0; i < 60; i++) {
    const s = await state()
    if (!s.tabs.find((t) => t.id === s.activeTabId)?.loading) break
    await sleep(250)
  }
  await sleep(ms)
}

await sleep(1500)
await shot('01-home')
await send({ type: 'open.internal', page: 'newtab' })
await sleep(1200)
await shot('01-newtab')
const homeTab = (await state())?.tabs.find((t) => t.kind === 'home')
if (homeTab) await send({ type: 'tab.close', id: homeTab.id })
await sleep(300)
await send({ type: 'tab.navigate', input: 'https://en.wikipedia.org/wiki/Sheep' })
for (const url of [
  'https://wiki.hyprland.org/',
  'https://www.electronjs.org/',
  'https://www.solidjs.com/',
  'https://example.org/',
  'https://github.com/',
]) {
  await send({ type: 'tab.create', url, activate: false })
}
await settle(1500)
const ids = (await state()).tabs.map((t) => t.id)
for (const id of ids) {
  await send({ type: 'tab.activate', id })
  await sleep(700)
}
await send({ type: 'tab.activate', id: ids[0] })
await settle(1500)
await shot('02-rail')
await shell.locator('.rail-tab').nth(2).hover()
await sleep(300)
await railShot('02a-rail-hover')
await shell.locator('.rail-address').click()
await sleep(300)
await shell.keyboard.type('hypr')
await sleep(600)
await railShot('02b-address-edit', 140)
await shell.keyboard.press('Escape')
await sleep(200)
await key('d', ['control'])
await sleep(350)
await shot('02c-bookmark-toast')
await bottomShot('02c-bookmark-toast-detail')
await sleep(2200)
await railShot('02d-address-starred', 140)
const pinIds = (await state()).tabs.slice(4, 6).map((t) => t.id)
for (const id of pinIds) await send({ type: 'tab.pin', id, pinned: true })
await sleep(500)
await railShot('02e-pinned')
await send({ type: 'tab.activate', id: pinIds[0] })
await sleep(500)
await railShot('02e-pinned-active')
await send({ type: 'tab.activate', id: ids[0] })
await sleep(300)
await shell.locator('.rail-tab').nth(1).click({ button: 'right' })
await sleep(450)
await shot('02f-tab-menu')
await overlay.keyboard.press('ArrowDown')
await overlay.keyboard.press('ArrowDown')
await overlay.keyboard.press('ArrowDown')
await overlay.keyboard.press('ArrowDown')
await overlay.keyboard.press('ArrowDown')
await overlay.keyboard.press('ArrowRight')
await sleep(400)
await shot('02f-tab-menu-move')
await overlay.keyboard.press('Escape')
await overlay.keyboard.press('Escape')
await sleep(400)
await send({ type: 'workspace.create', name: 'Work', color: 'sky' })
await sleep(300)
await send({ type: 'tab.navigate', input: 'https://example.org/' })
await sleep(800)
await send({
  type: 'tab.create',
  url: 'https://www.electronjs.org/docs/latest/api/web-contents-view',
})
await sleep(800)
await send({ type: 'workspace.create', name: 'A really long workspace name', color: 'mint' })
await sleep(300)
await send({ type: 'workspace.activate', id: (await state()).workspaces[1].id })
await settle(800)
await shot('03-workspace-work')
await barShot('03-bar-workspaces')
await barEndShot('03-bar-actions')
await send({ type: 'workspace.activate', id: (await state()).workspaces[0].id })
await sleep(600)
await shell.locator('.bar-ws').nth(1).hover()
await sleep(700)
await barShot('03a-workspace-chip-hover')
await shell.locator('.bar-ws').nth(1).click({ button: 'right' })
await sleep(450)
await shot('03b-workspace-menu')
await overlay.keyboard.press('Escape')
await sleep(400)
await shell.locator('.bar-ws.on').dblclick()
await sleep(300)
await shell.keyboard.type('Flock')
await sleep(200)
await barShot('03c-workspace-rename')
await shell.keyboard.press('Escape')
await sleep(300)
await shell.locator('.bar-ws-add').click()
await settle(1500)
await shot('03d-new-workspace-home')
await send({ type: 'workspace.remove', id: (await state()).activeWorkspaceId })
await sleep(300)
await send({ type: 'workspace.activate', id: (await state()).workspaces[0].id })
await sleep(600)

await send({ type: 'settings.update', patch: { rail: 'collapsed' } })
await sleep(700)
await shot('04-collapsed')
await edgeHover()
await sleep(1000)
await shot('04a-collapsed-peek')
await overlay.locator('.rail-tab').nth(3).hover()
await sleep(300)
await railShot('04b-peek-hover')
await closeOverlay()
await sleep(300)
await send({ type: 'settings.update', patch: { rail: 'expanded' } })
await sleep(600)

await send({ type: 'bookmarks.importChrome' })
await sleep(400)
await shell.locator('.bar-action[data-section="bookmarks"]').click()
await sleep(700)
const sidebar = await find('/ui/sidebar/')
await sidebar.locator('.sb-row.folder', { hasText: 'Imported from Chrome' }).click()
await sleep(200)
await sidebar.locator('.sb-row.folder', { hasText: 'Bookmarks bar' }).click()
await sleep(200)
await sidebar.locator('.sb-row.folder', { hasText: 'Dev' }).click()
await sleep(400)
await shot('05-sidebar-bookmarks')
await sidebar.locator('.sb-row', { hasText: 'Sheep' }).first().click({ button: 'right' })
await sleep(450)
await rightShot('05a-sidebar-bookmark-menu')
await sidebar.keyboard.press('Escape')
await sleep(300)
await sidebar.locator('.sb-search input').fill('wiki')
await sleep(400)
await rightShot('05b-sidebar-search')
await sidebar.locator('.sb-search input').fill('')
await send({ type: 'tab.create', url: `${origin}/page.html` })
await sleep(1200)
await send({ type: 'tab.navigate', input: `${origin}/sheep-report.zip` })
await sleep(800)
await send({ type: 'tab.navigate', input: `${origin}/flock-photos.zip` })
await sleep(300)
await send({ type: 'sidebar.toggle', section: 'downloads' })
await sleep(1800)
await shot('05c-sidebar-downloads')
await sidebar.locator('.sb-download').first().locator('.sb-pause').click()
await sleep(700)
await sidebar.locator('.sb-download').first().locator('.sb-cancel').click()
await sleep(600)
await rightShot('05d-sidebar-downloads-done')
await sidebar.locator('.sb-tab[data-section="history"]').click()
await sleep(700)
await shot('05e-sidebar-history')
await send({ type: 'sidebar.close' })
await sleep(500)

await send({ type: 'overlay.request', part: 'palette', newTab: true })
await sleep(500)
await shot('06-new-tab-palette')
await overlay.keyboard.type('t: wiki')
await sleep(400)
await shot('06a-palette-tabs')
await overlay.keyboard.press('Control+a')
await overlay.keyboard.type('b: sheep')
await sleep(400)
await shot('06b-palette-bookmarks')
await closeOverlay()
await key('l', ['control'])
await sleep(400)
await railShot('06c-ctrl-l', 140)
await shell.keyboard.press('Escape')
await sleep(300)

const pageWindow = (part) => find(part)
const pagePoint = async (page, selector, dx = 0.5, dy = 0.5) => {
  const box = await page.locator(selector).boundingBox()
  return { x: Math.round(box.x + box.width * dx), y: Math.round(box.y + box.height * dy) }
}
const rightClickPage = (at) =>
  app.evaluate(({ BrowserWindow, WebContentsView }, p) => {
    const win = BrowserWindow.getAllWindows()[0]
    const view = win.contentView.children
      .filter((v) => v instanceof WebContentsView)
      .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
    const wc = view?.webContents
    if (!wc) return
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'right', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'right', clickCount: 1 })
  }, at)
const closeMenu = async () => {
  await overlay.keyboard.press('Escape')
  await sleep(400)
}

await send({ type: 'tab.create', url: `${origin}/login.html` })
await sleep(1200)
await key('l', ['control', 'shift'])
await sleep(1200)
await shot('11-safe-key')
const loginPage = await pageWindow('/login.html')
await loginPage.keyboard.press('ArrowDown')
await sleep(300)
await shot('11a-safe-key-row')
await loginPage.keyboard.press('Escape')
await sleep(300)
await rightClickPage(await pagePoint(loginPage, 'input[type=password]', 0.3))
await sleep(500)
await shot('11c-page-menu-safe')
await closeMenu()

await send({ type: 'tab.navigate', input: `${origin}/article.html` })
await settle(800)
const article = await pageWindow('/article.html')
await rightClickPage(await pagePoint(article, '#guide'))
await sleep(500)
await shot('13-page-menu-link')
await closeMenu()
await rightClickPage(await pagePoint(article, '#photo', 0.4, 0.4))
await sleep(500)
await shot('13a-page-menu-image')
await closeMenu()
await article.evaluate(() => {
  const range = document.createRange()
  const text = document.getElementById('lede').firstChild
  range.setStart(text, 6)
  range.setEnd(text, 48)
  getSelection().removeAllRanges()
  getSelection().addRange(range)
})
await rightClickPage(await pagePoint(article, '#lede', 0.25, 0.2))
await sleep(500)
await shot('13b-page-menu-selection')
await closeMenu()
await article.evaluate(() => getSelection().removeAllRanges())
await rightClickPage(await pagePoint(article, '#tail', 0.5, 1.8))
await sleep(500)
await shot('13c-page-menu-page')
await closeMenu()

await key('f', ['control'])
await sleep(500)
await overlay.keyboard.type('sheep')
await sleep(500)
await shot('14-find-bar')
await rightShot('14a-find-bar-detail', 460)
await overlay.keyboard.press('Enter')
await overlay.keyboard.type('x')
await sleep(400)
await rightShot('14b-find-none', 460)
await overlay.keyboard.press('Escape')
await sleep(400)

await send({ type: 'tab.navigate', input: `${origin}/meadow.html` })
await settle(600)
await send({ type: 'tab.navigate', input: `${origin}/barn.html` })
await settle(600)
const holdSwipe = (dx, count) =>
  app.evaluate(
    async ({ BrowserWindow, WebContentsView }, p) => {
      const win = BrowserWindow.getAllWindows()[0]
      const view = win.contentView.children
        .filter((v) => v instanceof WebContentsView)
        .find((v) => v.getVisible() && !v.webContents.getURL().includes('/ui/'))
      const wc = view.webContents
      const wheel = (deltaX) =>
        wc.sendInputEvent({
          type: 'mouseWheel',
          x: 400,
          y: 300,
          deltaX,
          deltaY: 0,
          hasPreciseScrollingDeltas: true,
          canScroll: true,
        })
      for (let i = 0; i < p.count; i++) {
        wheel(p.dx)
        await new Promise((r) => setTimeout(r, 16))
      }
      let flip = 1
      globalThis.__holdSwipe = setInterval(() => {
        flip = -flip
        wheel(flip)
      }, 40)
    },
    { dx, count },
  )
const releaseSwipe = () => app.evaluate(() => clearInterval(globalThis.__holdSwipe))
await holdSwipe(18, 5)
await sleep(300)
await shot('15-swipe-back')
await releaseSwipe()
await sleep(600)
await holdSwipe(20, 9)
await sleep(300)
await shot('15a-swipe-back-ready')
await releaseSwipe()
await sleep(900)
await holdSwipe(-18, 6)
await sleep(300)
await shot('15b-swipe-forward')
await releaseSwipe()
await sleep(600)
await send({ type: 'tab.create', url: `${origin}/chat.html` })
await sleep(1000)
await send({ type: 'sidebar.toggle', section: 'bookmarks' })
await sleep(600)
await sidebar.locator('.sb-add-panel').click()
await sleep(400)
await send({ type: 'tab.navigate', input: `${origin}/login.html` })
await sleep(1200)
await shot('11b-web-panel')
await send({ type: 'sidebar.close' })
await sleep(400)

const extensionId = await app.evaluate(async ({ session }, path) => {
  const ext = await session.fromPartition('persist:default').extensions.loadExtension(path)
  return ext.id
}, resolve('tests/fixtures/extension'))
await sleep(1500)
const extButton = shell.locator(`.ext-action[data-extension="${extensionId}"]`)
await extButton.hover()
await sleep(300)
await railShot('12-extension-button')
await extButton.click()
await sleep(1200)
await shot('12a-extension-popup')
await extButton.click()
await sleep(400)
await extButton.click({ button: 'right' })
await sleep(450)
await shot('12b-extension-menu')
await overlay.keyboard.press('Escape')
await sleep(400)

for (let i = 0; i < 24; i++)
  await send({ type: 'tab.create', url: `${origin}/page.html?n=${i}`, activate: false })
await sleep(2500)
await shot('07-many-tabs')

await send({ type: 'tab.navigate', input: filesDir })
await sleep(1500)
const filesPage = await find('app://files')
await shot('07a-files-grid')
await filesPage.locator('.fm-tile', { hasText: 'Photos' }).dblclick()
await sleep(2500)
await shot('07b-files-photos')
await filesPage.locator('.fm-tile', { hasText: 'A1 mockup.png' }).dblclick()
await sleep(700)
await shot('07j-viewer-image')
await filesPage.keyboard.press('ArrowRight')
await sleep(600)
await shot('07j-viewer-next')
await filesPage.keyboard.press('End')
await sleep(1200)
await shot('07k-viewer-video')
await filesPage.keyboard.press('Escape')
await sleep(300)
await filesPage.locator('.fm-tile').nth(1).click()
await filesPage
  .locator('.fm-tile')
  .nth(3)
  .click({ modifiers: ['Shift'] })
await sleep(300)
await shot('07c-files-selection')
await filesPage.keyboard.press('Backspace')
await sleep(800)
await filesPage.locator('.fm-tile', { hasText: 'notes.md' }).dblclick()
await sleep(700)
await shot('07n-viewer-markdown')
await filesPage.locator('.mv-close').click()
await filesPage.locator('.fm-tile', { hasText: 'shear.ts' }).dblclick()
await sleep(700)
await shot('07o-viewer-code')
await filesPage.locator('.mv-close').click()
await filesPage.locator('.fm-tile', { hasText: 'manual.pdf' }).dblclick()
await sleep(2500)
await shot('07p-viewer-pdf')
await filesPage.locator('.mv-close').click()
await sleep(300)
await filesPage.locator('.fm-tile', { hasText: 'mockups.zip' }).dblclick()
await sleep(800)
await shot('07l-archive-dialog')
await filesPage.keyboard.press('Escape')
await sleep(300)
await filesPage.locator('.fm-tile', { hasText: 'Obsidian' }).click({ button: 'right' })
await filesPage.locator('.menu-item', { hasText: 'Compress' }).hover()
await sleep(450)
await shot('07m-compress-menu')
await filesPage.keyboard.press('Escape')
await filesPage.keyboard.press('Escape')
await sleep(300)
await filesPage.locator('.fm-view[title="List"]').click()
await sleep(500)
await shot('07d-files-list')
await filesPage.locator('.fm-row', { hasText: 'notes.md' }).click({ button: 'right' })
await sleep(450)
await shot('07e-files-menu')
await filesPage.keyboard.press('Escape')
await sleep(300)
await filesPage.locator('.fm-view[title="Grid"]').click()
await filesPage.locator('.fm-tile', { hasText: 'notes.md' }).click()
await filesPage.keyboard.press('F2')
await sleep(300)
await shot('07f-files-rename')
await filesPage.keyboard.press('Escape')
const contentBox = await filesPage.locator('.fm-content').boundingBox()
await filesPage.locator('.fm-content').click({
  button: 'right',
  position: { x: Math.min(600, contentBox.width - 60), y: Math.min(420, contentBox.height - 60) },
})
await sleep(450)
await shot('07g-files-background-menu')
await filesPage.keyboard.press('Escape')
await sleep(300)
const crumbsBox = await filesPage.locator('.fm-crumbs').boundingBox()
await filesPage.locator('.fm-crumbs').click({
  position: { x: (crumbsBox?.width ?? 100) - 12, y: (crumbsBox?.height ?? 20) / 2 },
})
await sleep(300)
await shot('07h-files-path-edit')
await filesPage.keyboard.press('Escape')
await sleep(300)
await railShot('07i-rail-files-tab', 260)

await send({ type: 'open.internal', page: 'music' })
await sleep(3000)
const musicPage = await find('app://music')
await shot('07q-music-albums')
await musicPage.locator('.mu-tile').first().click()
await sleep(600)
await musicPage.locator('.mu-play-all').click()
await sleep(1500)
await shot('07r-music-album-playing')
await musicPage.locator('.mu-nav-item[data-view="songs"]').click()
await sleep(500)
await shot('07s-music-songs')
await musicPage.locator('.mu-nav-item[data-view="artists"]').click()
await sleep(500)
await shot('07t-music-artists')
await musicPage.keyboard.press('Space')
await sleep(300)

await send({ type: 'open.internal', page: 'home' })
await sleep(2500)
await shot('01b-home-recent')
const homePage = await find('app://home')
await homePage.locator('.palette.hero input').fill('wiki')
await sleep(700)
await shot('01c-home-search')
await homePage.locator('.palette.hero input').fill('')
await homePage.locator('.palette.hero input').blur()
await homePage.locator('.rc-card').first().click({ button: 'right' })
await sleep(400)
await shot('01d-home-menu')
await homePage.keyboard.press('Escape')
await homePage.locator('.home-seg [data-filter="doc"]').click()
await sleep(1000)
await shot('01e-home-docs')
await homePage.locator('.home-seg [data-filter="all"]').click()
await sleep(500)

await send({ type: 'open.internal', page: 'settings' })
await sleep(1200)
await shot('08-settings')
const settingsPage = await find('app://settings')
await settingsPage.locator('.settings-startup').scrollIntoViewIfNeeded()
await sleep(400)
await shot('08a-settings-ewe')
await settingsPage.locator('.settings-ext-store').scrollIntoViewIfNeeded()
await sleep(400)
await shot('08b-settings-extensions-sync')
await settingsPage.locator('.settings-swipe').scrollIntoViewIfNeeded()
await sleep(400)
await shot('08c-settings-swipe')
await settingsPage.locator('.settings-safe-only').scrollIntoViewIfNeeded()
await sleep(400)
await shot('08d-settings-safe-only')
await settingsPage.locator('.shortcut').last().scrollIntoViewIfNeeded()
await sleep(400)
await shot('08e-settings-new-shortcuts')
await send({
  type: 'extension.install',
  source: 'https://chromewebstore.google.com/detail/bitwarden/nngceckbapebfimnlniiiahkandclblb',
})
await sleep(500)
await bottomShot('08f-extension-refused')
await sleep(1800)
await send({ type: 'settings.update', patch: { theme: 'light' } })
await sleep(800)
await shot('09-light')
await send({ type: 'tab.activate', id: ids[0] })
await sleep(800)
await shell.locator('.rail-tab').nth(1).hover()
await sleep(300)
await shot('09a-light-rail')
await shell.locator('.rail-tab').nth(2).click({ button: 'right' })
await sleep(450)
await shot('09b-light-tab-menu')
await overlay.keyboard.press('Escape')
await sleep(400)
await send({ type: 'sidebar.toggle', section: 'bookmarks' })
await sleep(700)
await shot('09c-light-sidebar')
await send({ type: 'sidebar.close' })
await sleep(300)
await send({ type: 'tab.navigate', input: join(filesDir, 'Photos') })
await sleep(2500)
await shot('09e-light-files')
await send({ type: 'open.internal', page: 'music' })
await sleep(1500)
await shot('09f-light-music')
await send({ type: 'open.internal', page: 'home' })
await sleep(2000)
await shot('09g-light-home')
await send({ type: 'settings.update', patch: { rail: 'collapsed' } })
await sleep(700)
await edgeHover()
await sleep(1000)
await shot('09d-light-peek')
await closeOverlay()
await send({ type: 'settings.update', patch: { rail: 'expanded', theme: 'dark' } })
await sleep(800)
await send({
  type: 'tab.navigate',
  input: 'app://sad/?url=https%3A%2F%2Fexample.com%2F&error=crashed',
})
await sleep(1000)
await shot('10-sad')
await Promise.race([app.close(), sleep(5000)])
process.exit(0)
