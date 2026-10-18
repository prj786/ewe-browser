import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  CLI,
  activeUrl,
  cliIn,
  launch,
  send,
  serve,
  serveTls,
  shellOf,
  trustAnyCertificate,
  visit,
} from './wave2-support'

test('the command line drives workspaces, history, downloads and site search', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ewe-e2e-cli2-'))
  const downloads = mkdtempSync(join(tmpdir(), 'ewe-e2e-cli2-dl-'))
  const cli = cliIn(userData)
  const descriptor = (scheme: string, host: string) => `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Wool</ShortName>
  <Url type="text/html" template="${scheme}://${host}/lookup?term={searchTerms}&amp;p={startPage?}"/>
</OpenSearchDescription>`
  const osPage =
    '<title>Wool shop</title><link rel="search" type="application/opensearchdescription+xml" href="/os.xml">'
  const tls = await serveTls({
    '/one.html': '<title>Flock</title>',
    '/find': '<title>Find</title><p>results</p>',
    '/os.html': osPage,
    '/os.xml': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/opensearchdescription+xml' })
      res.end(descriptor('https', 'wool.example'))
    },
    '/lookup': '<title>Lookup</title>',
  })
  const site = await serve({
    '/one.html': '<title>One</title>',
    '/two.html': '<title>Two</title>',
    '/os.html': osPage,
    '/os.xml': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/opensearchdescription+xml' })
      res.end(descriptor('http', 'plain.example'))
    },
    '/report.txt': (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="report.txt"',
      })
      res.end('twelve sheep\n')
    },
  })

  expect(cli('site', 'zara')).toMatchObject({
    ok: true,
    running: false,
    name: 'Zara',
    host: 'zara.com',
    template: expect.stringMatching(
      /^https:\/\/www\.zara\.com\/[a-z]{2}\/[a-z]{2}\/search\?searchTerm=\{q\}$/,
    ),
    via: 'table',
  })
  expect(cli('search', 'wool', '--site', 'nowhere')).toMatchObject({
    ok: false,
    error: 'unknown-site',
  })
  expect(cli('status')).toMatchObject({ running: false })
  expect(cli('workspace', 'next')).toMatchObject({ ok: false, error: 'not-running' })

  const app = await launch(userData, { EWE_DOWNLOADS: downloads }, [
    `--host-resolver-rules=MAP flock.example 127.0.0.1:${tls.port}, MAP wool.example 127.0.0.1:${tls.port}, MAP plain.example 127.0.0.1:${site.port}`,
  ])
  try {
    const shell = await shellOf(app)
    await trustAnyCertificate(app)
    await expect.poll(() => cli('status').running, { timeout: 15_000 }).toBe(true)
    const workspaces = () =>
      cli('workspaces').workspaces as {
        id: string
        name: string
        active: boolean
        index: number
        tabs: number
      }[]

    const created = cli('workspace', 'create', 'Wool', 'shop', '--color', 'sky') as {
      workspace: { id: string; name: string; color: string; index: number }
      undo: string[][]
    }
    expect(created).toMatchObject({
      ok: true,
      workspace: { name: 'Wool shop', color: 'sky', index: 2, active: true },
    })
    expect(created.undo).toEqual([['ewe-browser', 'workspace', 'remove', created.workspace.id]])
    expect(workspaces().map((w) => [w.name, w.index, w.active])).toEqual([
      ['Home', 1, false],
      ['Wool shop', 2, true],
    ])
    expect(cli('workspace', 'next')).toMatchObject({
      ok: true,
      workspace: { name: 'Home' },
      undo: [['ewe-browser', 'workspace', 'prev']],
    })
    expect(cli('workspace', 'prev')).toMatchObject({
      workspace: { name: 'Wool shop' },
      undo: [['ewe-browser', 'workspace', 'next']],
    })
    const home = workspaces()[0]?.id ?? ''
    expect(cli('workspace', 'activate', '1')).toMatchObject({
      workspace: { id: home, name: 'Home' },
      undo: [['ewe-browser', 'workspace', 'activate', created.workspace.id]],
    })
    expect(cli('workspace', 'activate', 'WOOL SHOP')).toMatchObject({
      workspace: { name: 'Wool shop' },
    })
    expect(cli('workspace', 'activate', 'Barn')).toMatchObject({ ok: false, error: 'not-found' })
    await expect
      .poll(() =>
        shell.evaluate(async () => {
          const s = await window.ewe.getState()
          return s?.workspaces.find((w) => w.id === s.activeWorkspaceId)?.name
        }),
      )
      .toBe('Wool shop')
    const times: number[] = []
    for (let i = 0; i < 10; i++) {
      const started = process.hrtime.bigint()
      execFileSync(process.execPath, [CLI, 'workspace', i % 2 === 0 ? 'next' : 'prev'], {
        env: { ...process.env, EWE_USER_DATA: userData },
      })
      times.push(Number(process.hrtime.bigint() - started) / 1e6)
    }
    times.sort((a, b) => a - b)
    test.info().annotations.push({
      type: 'workspace next round trip',
      description: `median ${times[5]?.toFixed(1)} ms, max ${times[9]?.toFixed(1)} ms`,
    })
    expect(times[5]).toBeLessThan(150)

    expect(cli('workspace', 'rename', 'Wool shop', 'Barn')).toMatchObject({
      workspace: { name: 'Barn' },
      undo: [['ewe-browser', 'workspace', 'rename', created.workspace.id, 'Wool shop']],
    })
    const opened = cli('open', `${site.url}/one.html`, '--workspace', 'home') as {
      tabs: { id: string }[]
    }
    expect(opened).toMatchObject({ ok: true })
    const tabWorkspace = await shell.evaluate(
      async (id) => (await window.ewe.getState())?.tabs.find((t) => t.id === id)?.workspaceId,
      opened.tabs[0]?.id ?? '',
    )
    expect(tabWorkspace).toBe(home)
    expect(cli('open', 'x.org', '--workspace', 'Nope')).toMatchObject({
      ok: false,
      error: 'not-found',
    })

    await expect.poll(() => activeUrl(shell)).toBe(`${site.url}/one.html`)
    await expect
      .poll(() =>
        shell.evaluate(async () => {
          const s = await window.ewe.getState()
          return s?.tabs.find((t) => t.id === s.activeTabId)?.title
        }),
      )
      .toBe('One')
    await visit(shell, `${site.url}/two.html`)
    expect(cli('back')).toMatchObject({
      ok: true,
      tab: { url: `${site.url}/two.html` },
      undo: [['ewe-browser', 'forward']],
    })
    await expect.poll(() => activeUrl(shell)).toBe(`${site.url}/one.html`)
    expect(cli('forward')).toMatchObject({ ok: true, undo: [['ewe-browser', 'back']] })
    await expect.poll(() => activeUrl(shell)).toBe(`${site.url}/two.html`)
    expect(cli('forward')).toMatchObject({ ok: false, error: 'no-history' })

    await visit(shell, 'https://flock.example/find?q=old+socks&page=2')
    expect(cli('site', 'flock')).toMatchObject({ host: 'flock.example', via: 'filter' })
    await visit(shell, 'https://flock.example/one.html')
    expect(cli('site', 'flock')).toMatchObject({
      ok: true,
      running: true,
      host: 'flock.example',
      template: 'https://flock.example/find?q={q}',
      via: 'history',
    })
    const searched = cli('search', 'wool', 'hats', '--site', 'flock') as { tab: { id: string } }
    expect(searched).toMatchObject({
      ok: true,
      url: 'https://flock.example/find?q=wool%20hats',
      site: { name: 'flock.example', host: 'flock.example', via: 'history' },
    })
    await expect.poll(() => activeUrl(shell)).toBe('https://flock.example/find?q=wool%20hats')

    await visit(shell, 'http://plain.example/os.html')
    await visit(shell, 'https://wool.example/os.html')
    await expect
      .poll(() => cli('site', 'wool.example'), { timeout: 15_000 })
      .toMatchObject({ via: 'opensearch', template: 'https://wool.example/lookup?term={q}' })
    expect(cli('site', 'plain.example')).toMatchObject({ via: 'filter' })
    expect(site.requests.some((r) => r.path === '/os.xml')).toBe(false)
    const stored = join(userData, 'site-search.json')
    await expect.poll(() => existsSync(stored), { timeout: 5000 }).toBe(true)
    expect(JSON.parse(readFileSync(stored, 'utf8'))).toMatchObject({
      hosts: { 'wool.example': { descriptor: 'https://wool.example/os.xml' } },
    })
    await send(shell, { type: 'tab.navigate', input: '@wool merino', newTab: true })
    await expect.poll(() => activeUrl(shell)).toBe('https://wool.example/lookup?term=merino')

    await send(shell, { type: 'tab.create', url: `${site.url}/report.txt` })
    await expect
      .poll(() => existsSync(join(downloads, 'report.txt')), { timeout: 15_000 })
      .toBe(true)
    const list = () => cli('downloads').downloads as { id: string; status: string }[]
    await expect.poll(() => list()[0]?.status, { timeout: 15_000 }).toBe('completed')
    const id = list()[0]?.id ?? ''
    expect(cli('download', 'show', id.slice(0, 8))).toMatchObject({
      ok: true,
      download: { id, filename: 'report.txt', path: join(downloads, 'report.txt') },
    })
    await expect.poll(() => activeUrl(shell)).toContain('app://files/')
    await app.evaluate(({ shell: desktop }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      desktop.openPath = (path: string) => {
        opened.push(path)
        return Promise.resolve('')
      }
    })
    expect(cli('download', 'open', id)).toMatchObject({ ok: true })
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual([join(downloads, 'report.txt')])
    expect(cli('download', 'open', 'zzzz')).toMatchObject({ ok: false, error: 'not-found' })

    const removed = cli('workspace', 'remove', 'Barn') as { undo: string[][] }
    expect(removed).toMatchObject({ ok: true, workspace: { name: 'Barn' }, closedTabs: 1 })
    expect(removed.undo[0]).toEqual([
      'ewe-browser',
      'workspace',
      'create',
      'Barn',
      '--color',
      'sky',
    ])
    expect(cli('workspace', 'remove', 'Home')).toMatchObject({
      ok: false,
      error: 'last-workspace',
    })
  } finally {
    await app.close()
    site.close()
    tls.close()
  }
  await expect.poll(() => cli('status').running).toBe(false)
  expect(cli('workspaces')).toMatchObject({
    ok: true,
    running: false,
    workspaces: [{ name: 'Home', index: 1, active: true }],
  })
  expect(cli('site', 'flock')).toMatchObject({ running: false, via: 'history' })
})
