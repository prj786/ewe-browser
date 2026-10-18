import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BookmarkFolder, HistoryVisit, RecentItem, Track } from '@ewe/shared'
import { absolutePaths, parseArgv, VERBS } from '../../src/main/cli/argv'
import {
  bookmarkWrite,
  matchWorkspace,
  readTool,
  siteReply,
  type Sources,
} from '../../src/main/cli/data'
import { commandsReply, helpReply, listFolder, locate } from '../../src/main/cli/local'
import { answer, listenCli } from '../../src/main/cli/server'
import { PROTOCOL_VERSION, socketPath, userDataDir } from '../../src/main/cli/socket'
import { checkArgs, toolNamed, TOOLS } from '../../src/main/cli/tools'
import { BookmarksStore } from '../../src/main/storage/bookmarks-store'

const parsed = (argv: string[]) => {
  const p = parseArgv(argv)
  return p.ok ? { tool: p.tool, args: p.args } : { error: p.error }
}

describe('command line arguments', () => {
  it('maps verbs, words and options to a tool and its arguments', () => {
    expect(parsed([])).toEqual({ tool: 'help', args: {} })
    expect(parsed(['--version'])).toEqual({ tool: 'version', args: {} })
    expect(parsed(['history', 'sheep', 'wool', '--limit', '5'])).toEqual({
      tool: 'history',
      args: { query: 'sheep wool', limit: 5 },
    })
    expect(parsed(['locate', 'report', '--in=/srv', '--hidden'])).toEqual({
      tool: 'locate',
      args: { query: 'report', in: '/srv', hidden: true },
    })
    expect(parsed(['search', '--', '--help', 'me'])).toEqual({
      tool: 'search',
      args: { query: '--help me' },
    })
    expect(parsed(['ls'])).toEqual({ tool: 'ls', args: { path: '.' } })
    expect(parsed(['tab', 'close', 'abcd'])).toEqual({ tool: 'tab_close', args: { id: 'abcd' } })
    expect(parsed(['tab', 'reopen'])).toEqual({ tool: 'tab_reopen', args: {} })
    expect(parsed(['bookmark', 'add', 'https://x.org/', '--title', 'X'])).toEqual({
      tool: 'bookmark_add',
      args: { url: 'https://x.org/', title: 'X' },
    })
    expect(parseArgv(['tabs', '--pretty'])).toMatchObject({ ok: true, tool: 'tabs', pretty: true })
  })

  it('opens plain words as one search and urls or paths one by one', () => {
    expect(parsed(['open', 'sheep', 'breeds'])).toEqual({
      tool: 'open',
      args: { targets: ['sheep breeds'] },
    })
    expect(parsed(['open', '--new-window', 'github.com', '~/Music'])).toEqual({
      tool: 'open',
      args: { targets: ['github.com', '~/Music'], newWindow: true },
    })
  })

  it('takes JSON arguments through call', () => {
    expect(parsed(['call', 'ls', '{"path":"/","hidden":true}'])).toEqual({
      tool: 'ls',
      args: { path: '/', hidden: true },
    })
    expect(parsed(['call', 'nope'])).toEqual({ error: 'unknown-verb' })
    expect(parsed(['call', 'ls', '[1]'])).toEqual({ error: 'usage' })
    expect(parsed(['call', 'ls', '{'])).toEqual({ error: 'usage' })
  })

  it('refuses unknown verbs, options, stray words and bad numbers', () => {
    expect(parsed(['fly'])).toEqual({ error: 'unknown-verb' })
    expect(parsed(['status', 'now'])).toEqual({ error: 'usage' })
    expect(parsed(['history', '--frob'])).toEqual({ error: 'usage' })
    expect(parsed(['history', '--limit', 'many'])).toEqual({ error: 'usage' })
    expect(parsed(['history', '--limit'])).toEqual({ error: 'usage' })
    expect(parsed(['tab', 'fly', 'x'])).toEqual({ error: 'usage' })
    expect(parsed(['reveal', 'a', 'b'])).toEqual({ error: 'usage' })
    expect(parsed(['constructor'])).toEqual({ error: 'unknown-verb' })
    expect(parsed(['__proto__', 'x'])).toEqual({ error: 'unknown-verb' })
  })

  it('reaches every tool from a verb', () => {
    const required: Record<string, string[]> = {
      find: ['x'],
      locate: ['x'],
      open: ['x'],
      search: ['x'],
      play: ['x'],
      reveal: ['/x'],
      site: ['x'],
    }
    for (const tool of TOOLS) {
      const [group, action] = tool.name.split('_')
      const argv =
        action === undefined
          ? [tool.name, ...(required[tool.name] ?? [])]
          : [group ?? '', action, ...(tool.schema.required.length > 0 ? ['x'] : [])]
      expect(parsed(argv), tool.name).toMatchObject({ tool: tool.name })
    }
    expect(VERBS).toContain('call')
  })

  it('makes paths absolute against the working directory and home', () => {
    const ctx = { cwd: '/w', home: '/h', exists: (p: string) => p === '/w/notes' }
    expect(absolutePaths('ls', { path: '.' }, ctx)).toEqual({ path: '/w' })
    expect(absolutePaths('locate', { query: 'a', in: '~/Docs' }, ctx)).toEqual({
      query: 'a',
      in: '/h/Docs',
    })
    expect(absolutePaths('reveal', { path: 'file:///tmp/a%20b' }, ctx)).toEqual({
      path: '/tmp/a b',
    })
    expect(
      absolutePaths(
        'open',
        { targets: ['./a', 'notes', 'sheep', 'https://x.org', '~', 'localhost:3000'] },
        ctx,
      ),
    ).toEqual({ targets: ['/w/a', '/w/notes', 'sheep', 'https://x.org', '/h', 'localhost:3000'] })
    expect(absolutePaths('play', { query: '~/a.mp3' }, ctx)).toEqual({ query: '/h/a.mp3' })
    expect(absolutePaths('play', { query: 'the wool' }, ctx)).toEqual({ query: 'the wool' })
  })
})

describe('tool arguments', () => {
  const spec = (name: string) => {
    const found = toolNamed(name)
    if (found === undefined) throw new Error(name)
    return found
  }

  it('fills defaults and checks types, ranges, enums and required keys', () => {
    expect(checkArgs(spec('history'), {})).toEqual({ ok: true, args: { limit: 50 } })
    expect(checkArgs(spec('recent'), { kind: 'video' })).toEqual({
      ok: true,
      args: { kind: 'video', limit: 12 },
    })
    expect(checkArgs(spec('recent'), { kind: 'films' }).ok).toBe(false)
    expect(checkArgs(spec('history'), { limit: 0 }).ok).toBe(false)
    expect(checkArgs(spec('history'), { limit: 2.5 }).ok).toBe(false)
    expect(checkArgs(spec('find'), {}).ok).toBe(false)
    expect(checkArgs(spec('find'), { query: '  ' }).ok).toBe(false)
    expect(checkArgs(spec('ls'), { path: '/', color: 'red' }).ok).toBe(false)
    expect(checkArgs(spec('open'), { targets: [] }).ok).toBe(false)
    expect(checkArgs(spec('open'), { targets: ['a', 1] }).ok).toBe(false)
    expect(checkArgs(spec('ls'), [] as unknown).ok).toBe(false)
    expect(checkArgs(spec('tabs'), JSON.parse('{"__proto__":1}')).ok).toBe(false)
    expect(checkArgs(spec('tabs'), { constructor: 1 }).ok).toBe(false)
  })

  it('describes every tool for an assistant registry', () => {
    const reply = commandsReply('1.0.0') as unknown as {
      tools: {
        name: string
        tier: number
        untrusted: boolean
        argv: string[]
        schema: { required: string[]; properties: object; additionalProperties: boolean }
      }[]
    }
    const names = reply.tools.map((t) => t.name)
    expect(names).not.toContain('help')
    expect(names).toContain('tab_close')
    for (const tool of reply.tools) {
      expect([0, 1, 2]).toContain(tool.tier)
      expect(tool.argv).toEqual(['ewe-browser', 'call', tool.name])
      expect(tool.schema.additionalProperties).toBe(false)
      for (const key of tool.schema.required)
        expect(Object.keys(tool.schema.properties)).toContain(key)
    }
    const untrusted = reply.tools.filter((t) => t.untrusted).map((t) => t.name)
    for (const name of ['status', 'tabs', 'page', 'ls', 'music', 'play', 'tab_close'])
      expect(untrusted).toContain(name)
    for (const name of ['version', 'open', 'focus']) expect(untrusted).not.toContain(name)
    expect(helpReply('1', 'tab')).toMatchObject({ ok: true, verb: 'tab' })
    expect(helpReply('1', 'fly')).toMatchObject({ ok: false, error: 'unknown-verb' })
  })
})

describe('profile and socket', () => {
  it('finds the profile like the app does and gives each profile its own socket', () => {
    expect(userDataDir({ EWE_USER_DATA: 'rel/dir' })).toBe(resolve('rel/dir'))
    expect(userDataDir({ XDG_CONFIG_HOME: '/c', HOME: '/h' })).toBe('/c/ewe-browser')
    const env = { XDG_RUNTIME_DIR: '/run/user/7' }
    const a = socketPath('/p/one', env)
    expect(dirname(a)).toBe('/run/user/7')
    expect(socketPath('/p/one/', env)).toBe(a)
    expect(socketPath('/p/two', env)).not.toBe(a)
  })
})

describe('socket server', () => {
  const handle = (tool: string, args: Record<string, unknown>) => {
    if (tool === 'focus') return Promise.reject(new Error('no display'))
    return Promise.resolve({ ok: true as const, tool, args })
  }

  it('answers requests with the id echoed and refuses bad ones', async () => {
    const request = (tool: string, args: object, v = PROTOCOL_VERSION) =>
      JSON.stringify({ v, id: 'r1', tool, args })
    expect(await answer('{', handle)).toMatchObject({ ok: false, error: 'bad-request' })
    expect(await answer('{"v":1}', handle)).toMatchObject({ ok: false, error: 'bad-request' })
    expect(await answer(request('tabs', {}, 99), handle)).toMatchObject({ error: 'protocol' })
    expect(await answer(request('ls', { path: '/' }), handle)).toMatchObject({
      error: 'unknown-verb',
    })
    expect(await answer(request('history', { limit: 'x' }), handle)).toMatchObject({
      error: 'bad-args',
    })
    expect(await answer(request('focus', {}), handle)).toMatchObject({
      ok: false,
      error: 'failed',
      message: 'no display',
      id: 'r1',
    })
    expect(await answer(request('history', { query: 'a' }), handle)).toEqual({
      ok: true,
      tool: 'history',
      args: { query: 'a', limit: 50 },
      id: 'r1',
    })
  })

  it('listens on a private unix socket and removes it when closed', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ewe-sock-')), 'run', 'b.sock')
    const server = await listenCli(path, handle)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
    const reply = await new Promise<string>((done) => {
      const socket = connect(path)
      let text = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        text += chunk
        if (text.includes('\n')) {
          socket.destroy()
          done(text)
        }
      })
      socket.write(`${JSON.stringify({ v: 1, id: 'x', tool: 'tabs', args: {} })}\n`)
    })
    expect(JSON.parse(reply)).toEqual({ ok: true, tool: 'tabs', args: {}, id: 'x' })
    server.close()
    expect(() => statSync(path)).toThrow()
  })

  it('refuses to listen in a folder that other users can write to', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-sock-'))
    chmodSync(dir, 0o777)
    await expect(listenCli(join(dir, 'b.sock'), handle)).rejects.toThrow('not a private folder')
  })
})

describe('folders', () => {
  const tree = () => {
    const root = mkdtempSync(join(tmpdir(), 'ewe-cli-'))
    mkdirSync(join(root, 'Docs/deep/deeper'), { recursive: true })
    mkdirSync(join(root, '.cache/sheep'), { recursive: true })
    mkdirSync(join(root, 'node_modules/sheep'), { recursive: true })
    writeFileSync(join(root, 'b-sheep.txt'), 'hello')
    writeFileSync(join(root, 'a.pdf'), 'x'.repeat(50))
    writeFileSync(join(root, '.sheep'), '')
    writeFileSync(join(root, 'Docs/deep/sheep'), '')
    writeFileSync(join(root, 'Docs/deep/deeper/Sheep Report.md'), '')
    const old = new Date('2020-01-01T00:00:00Z')
    utimesSync(join(root, 'a.pdf'), old, old)
    return root
  }

  it('lists a folder with folders first, kinds, sizes and times', async () => {
    const root = tree()
    const reply = (await listFolder(root, false, 'name', 500)) as unknown as {
      entries: { name: string; kind: string; size: number | null; modified: string }[]
      total: number
    }
    expect(reply.entries.map((e) => e.name)).toEqual([
      'Docs',
      'node_modules',
      'a.pdf',
      'b-sheep.txt',
    ])
    expect(reply.entries[2]).toMatchObject({
      kind: 'pdf',
      size: 50,
      modified: '2020-01-01T00:00:00.000Z',
    })
    expect(reply.entries[0]).toMatchObject({ kind: 'folder', size: null })
    const bySize = (await listFolder(root, true, 'size', 2)) as unknown as {
      entries: { name: string }[]
      truncated: boolean
      total: number
    }
    expect(bySize.entries.map((e) => e.name)).toEqual(['a.pdf', 'b-sheep.txt'])
    expect(bySize).toMatchObject({ truncated: true, total: 6 })
    expect(await listFolder(join(root, 'nope'), false, 'name', 5)).toMatchObject({
      error: 'not-found',
    })
    expect(await listFolder(join(root, 'a.pdf'), false, 'name', 5)).toMatchObject({
      error: 'not-a-folder',
    })
  })

  it('locates names by every word, best and shallowest first, skipping dot folders and node_modules', async () => {
    const root = tree()
    const names = async (query: string, hidden = false, depth = 8) =>
      (
        (await locate(query, root, hidden, depth, 50)) as unknown as { results: { name: string }[] }
      ).results.map((r) => r.name)
    expect(await names('sheep')).toEqual(['sheep', 'Sheep Report.md', 'b-sheep.txt'])
    expect(await names('report sheep')).toEqual(['Sheep Report.md'])
    expect(await names('sheep', false, 1)).toEqual(['b-sheep.txt'])
    expect(await names('sheep', true)).toContain('.sheep')
    expect(await locate('x', join(root, 'a.pdf'), false, 2, 5)).toMatchObject({
      error: 'not-a-folder',
    })
    expect(await locate('sheep', root, false, 8, 50, { entries: 0, ms: 1000 })).toMatchObject({
      truncated: true,
    })
  })
})

describe('browser data', () => {
  const root: BookmarkFolder = {
    id: 'root',
    kind: 'folder',
    title: '',
    added: 0,
    children: [
      { id: 'b1', kind: 'bookmark', title: 'Sheep wiki', url: 'https://sheep.example/', added: 1 },
      {
        id: 'f1',
        kind: 'folder',
        title: 'Farm',
        added: 2,
        children: [
          {
            id: 'b2',
            kind: 'bookmark',
            title: 'Wool prices',
            url: 'https://wool.example/',
            added: 3,
          },
        ],
      },
    ],
  }
  const visit: HistoryVisit = {
    url: 'https://sheep.example/',
    title: 'Sheep wiki',
    host: 'sheep.example',
    count: 3,
    last: 0,
  }
  const track = {
    title: 'Black Sheep',
    artist: 'Flock',
    album: 'Wool',
    path: '/m/a.mp3',
    duration: 61.4,
  } as Track
  const item = {
    kind: 'doc',
    title: 'sheep notes',
    path: '/d/sheep.md',
    time: 0,
    source: 'opened',
  } as RecentItem
  const src: Sources = {
    running: false,
    windows: () => [],
    tabs: () => [
      {
        id: 't1',
        title: 'Sheep wiki',
        url: 'https://sheep.example/',
        kind: 'page',
        active: true,
        pinned: false,
        audible: false,
        muted: false,
        loading: false,
        workspace: 'Home',
        window: 1,
      },
    ],
    workspaces: () => [],
    history: (query) => (query === '' || 'sheep'.includes(query) ? [visit] : []),
    bookmarks: () => root,
    downloads: () => [],
    recents: () => Promise.resolve([item]),
    tracks: () => [track],
  }

  it('shapes history, bookmarks and music with readable times and folder paths', async () => {
    expect(await readTool('history', { limit: 5 }, src)).toMatchObject({
      ok: true,
      running: false,
      entries: [{ visits: 3, lastVisit: '1970-01-01T00:00:00.000Z' }],
    })
    expect(await readTool('bookmarks', { limit: 10 }, src)).toMatchObject({
      bookmarks: [
        { id: 'b2', folder: 'Farm' },
        { id: 'b1', folder: '' },
      ],
    })
    expect(await readTool('bookmarks', { query: 'wool', limit: 10 }, src)).toMatchObject({
      bookmarks: [{ id: 'b2' }],
    })
    expect(await readTool('music', { query: 'flock', limit: 5 }, src)).toMatchObject({
      total: 1,
      tracks: [{ title: 'Black Sheep', duration: 61 }],
    })
  })

  it('finds a query across tabs, bookmarks, history, recent files and music', async () => {
    const reply = (await readTool('find', { query: 'sheep', limit: 5 }, src)) as unknown as Record<
      string,
      unknown[]
    >
    expect(reply.tabs).toHaveLength(1)
    expect(reply.bookmarks).toHaveLength(1)
    expect(reply.history).toHaveLength(1)
    expect(reply.recent).toHaveLength(1)
    expect(reply.music).toHaveLength(1)
  })

  it('adds and removes bookmarks with undo argv, in the real store', async () => {
    const store = new BookmarksStore(mkdtempSync(join(tmpdir(), 'ewe-bm-')))
    await store.load()
    const add = { url: 'https://sheep.example/' }
    expect(bookmarkWrite('bookmark_add', add, store, () => 'Sheep', true)).toMatchObject({
      ok: true,
      existed: false,
      bookmark: { title: 'Sheep', host: 'sheep.example' },
      undo: [['ewe-browser', 'bookmark', 'remove', 'https://sheep.example/']],
    })
    expect(bookmarkWrite('bookmark_add', add, store, () => undefined, true)).toMatchObject({
      existed: true,
    })
    expect(bookmarkWrite('bookmark_remove', add, store, () => undefined, true)).toMatchObject({
      removed: 1,
      undo: [['ewe-browser', 'bookmark', 'add', 'https://sheep.example/', '--title', 'Sheep']],
    })
    expect(bookmarkWrite('bookmark_remove', add, store, () => undefined, true)).toMatchObject({
      error: 'not-bookmarked',
    })
    expect(
      bookmarkWrite('bookmark_add', { url: 'javascript:alert(1)' }, store, () => undefined, true),
    ).toMatchObject({
      error: 'bad-url',
    })
  })
})

describe('the command line bundle', () => {
  it('never imports electron, so it runs in Node mode without a display', () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/from 'electron'|require\('electron'\)/)
      for (const m of source.matchAll(/(?:from |import\()'(\.[^']+)'/g)) {
        const target = resolve(dirname(file), m[1] ?? '')
        visit(target.endsWith('.ts') ? target : `${target}.ts`)
      }
    }
    visit(resolve(__dirname, '../../src/main/cli/index.ts'))
    expect(seen.size).toBeGreaterThan(10)
  })
})

describe('workspaces, navigation, downloads and site search on the command line', () => {
  it('parses the new verbs', () => {
    expect(parsed(['workspaces'])).toEqual({ tool: 'workspaces', args: {} })
    expect(parsed(['workspace', 'next'])).toEqual({ tool: 'workspace_next', args: {} })
    expect(parsed(['workspace', 'prev'])).toEqual({ tool: 'workspace_prev', args: {} })
    expect(parsed(['workspace', 'activate', 'Deep', 'work'])).toEqual({
      tool: 'workspace_activate',
      args: { workspace: 'Deep work' },
    })
    expect(parsed(['workspace', 'activate', '2'])).toEqual({
      tool: 'workspace_activate',
      args: { workspace: '2' },
    })
    expect(parsed(['workspace', 'create', 'Wool', 'shop', '--color', 'sky'])).toEqual({
      tool: 'workspace_create',
      args: { name: 'Wool shop', color: 'sky' },
    })
    expect(parsed(['workspace', 'create'])).toEqual({ tool: 'workspace_create', args: {} })
    expect(parsed(['workspace', 'rename', 'Work', 'Deep', 'work'])).toEqual({
      tool: 'workspace_rename',
      args: { workspace: 'Work', name: 'Deep work' },
    })
    expect(parsed(['workspace', 'rename', 'Work', '--name', 'x'])).toEqual({ error: 'usage' })
    expect(parsed(['workspace', 'remove', 'Work'])).toEqual({
      tool: 'workspace_remove',
      args: { workspace: 'Work' },
    })
    expect(parsed(['workspace', 'next', 'now'])).toEqual({ error: 'usage' })
    expect(parsed(['workspace', 'fly'])).toEqual({ error: 'usage' })
    expect(parsed(['back'])).toEqual({ tool: 'back', args: {} })
    expect(parsed(['forward'])).toEqual({ tool: 'forward', args: {} })
    expect(parsed(['download', 'open', 'abcd'])).toEqual({
      tool: 'download_open',
      args: { id: 'abcd' },
    })
    expect(parsed(['download', 'show', 'abcd'])).toEqual({
      tool: 'download_show',
      args: { id: 'abcd' },
    })
    expect(parsed(['site', 'h&m'])).toEqual({ tool: 'site', args: { site: 'h&m' } })
    expect(parsed(['site', 'youtube', 'music'])).toEqual({
      tool: 'site',
      args: { site: 'youtube music' },
    })
    expect(parsed(['search', "men's", 'shoes', '--site', 'zara'])).toEqual({
      tool: 'search',
      args: { query: "men's shoes", site: 'zara' },
    })
    expect(parsed(['open', 'github.com', '--workspace', 'Work'])).toEqual({
      tool: 'open',
      args: { targets: ['github.com'], workspace: 'Work' },
    })
    expect(VERBS).toEqual(
      expect.arrayContaining(['workspace', 'workspaces', 'download', 'back', 'site']),
    )
  })

  it('checks the new arguments', () => {
    const spec = (name: string) => {
      const found = toolNamed(name)
      if (found === undefined) throw new Error(name)
      return found
    }
    expect(checkArgs(spec('workspace_create'), { color: 'sky' }).ok).toBe(true)
    expect(checkArgs(spec('workspace_create'), { color: 'teal' }).ok).toBe(false)
    expect(checkArgs(spec('workspace_rename'), { workspace: 'Work' }).ok).toBe(false)
    expect(checkArgs(spec('workspace_rename'), { workspace: 'Work', name: ' ' }).ok).toBe(false)
    expect(checkArgs(spec('site'), {}).ok).toBe(false)
    expect(checkArgs(spec('search'), { query: 'x', site: 'zara' }).ok).toBe(true)
    expect(spec('workspace_next')).toMatchObject({ tier: 1, where: 'live' })
    expect(spec('workspace_remove')).toMatchObject({ tier: 2, where: 'live' })
    expect(spec('workspace_create')).toMatchObject({ tier: 1, where: 'app' })
    expect(spec('workspaces')).toMatchObject({ tier: 0, where: 'read' })
    expect(spec('site')).toMatchObject({ tier: 0, where: 'read' })
    const tools = commandsReply('1').tools as { name: string; untrusted: boolean }[]
    expect(tools.find((t) => t.name === 'workspace_next')?.untrusted).toBe(false)
    expect(tools.find((t) => t.name === 'site')?.untrusted).toBe(true)
    expect(tools.find((t) => t.name === 'search')?.untrusted).toBe(true)
    expect(tools.find((t) => t.name === 'back')?.untrusted).toBe(true)
  })

  it('matches workspaces by id, name, number and id prefix', () => {
    const list = [
      { id: 'aaaa1111-x', name: 'Home' },
      { id: 'bbbb2222-y', name: 'Deep work' },
      { id: 'bbbb3333-z', name: '2' },
    ]
    expect(matchWorkspace(list, 'bbbb2222-y')).toBe(1)
    expect(matchWorkspace(list, 'deep WORK')).toBe(1)
    expect(matchWorkspace(list, '2')).toBe(2)
    expect(matchWorkspace(list, '1')).toBe(0)
    expect(matchWorkspace(list, 'aaaa')).toBe(0)
    expect(matchWorkspace(list, 'bbbb')).toMatchObject({ ok: false, error: 'ambiguous-id' })
    expect(matchWorkspace(list, '9')).toMatchObject({ ok: false, error: 'not-found' })
    expect(matchWorkspace(list, 'Play')).toMatchObject({ ok: false, error: 'not-found' })
    expect(
      matchWorkspace(
        [
          { id: 'a', name: 'Work' },
          { id: 'b', name: 'work' },
        ],
        'WORK',
      ),
    ).toMatchObject({ ok: false, error: 'ambiguous-id' })
  })

  it('lists the workspaces of one window in bar order with 1-based numbers', async () => {
    const src: Sources = {
      running: true,
      windows: () => [],
      tabs: () => [],
      workspaces: () => [
        { window: 1, id: 'w1', name: 'Home', color: 'ewellow', active: false, tabs: 2 },
        { window: 2, id: 'w9', name: 'Other', color: 'rose', active: true, tabs: 1 },
        { window: 1, id: 'w2', name: 'Work', color: 'sky', active: true, tabs: 3 },
      ],
      currentWindow: () => 1,
      history: () => [],
      bookmarks: () => ({ id: 'root', kind: 'folder', title: '', added: 0, children: [] }),
      downloads: () => [],
      recents: () => Promise.resolve([]),
      tracks: () => [],
    }
    expect(await readTool('workspaces', {}, src)).toEqual({
      ok: true,
      running: true,
      window: 1,
      workspaces: [
        { id: 'w1', name: 'Home', color: 'ewellow', index: 1, tabs: 2, active: false },
        { id: 'w2', name: 'Work', color: 'sky', index: 2, tabs: 3, active: true },
      ],
    })
  })

  it('answers site lookups and unknown sites in the contract shape', () => {
    expect(
      siteReply(
        { ok: true, name: 'Zara', host: 'zara.com', template: 'https://z/{q}', via: 'table' },
        false,
      ),
    ).toEqual({
      ok: true,
      running: false,
      name: 'Zara',
      host: 'zara.com',
      template: 'https://z/{q}',
      via: 'table',
    })
    expect(
      siteReply({ ok: false, error: 'unknown-site', message: 'no site called "x" is known' }, true),
    ).toMatchObject({ ok: false, error: 'unknown-site', message: 'no site called "x" is known' })
  })
})
