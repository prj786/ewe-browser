import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from 'electron'
import { describe, expect, it } from 'vitest'
import {
  NO_STATUS,
  isTunnelError,
  parseStatus,
  parseTunnel,
  proxyConfig,
  remoteBin,
  runRemote,
  tunnelErrorText,
} from '../../src/main/remote/cli'
import { inlineableFavicon } from '../../src/main/remote/favicon'
import { RemoteService, STATUS_TTL_MS } from '../../src/main/remote/service'
import { ownTabs } from '../../src/main/sync/service'
import { isSessionFile, sanitizeWindows } from '../../src/main/storage/session-store'
import { isDownloadEntry } from '../../src/main/storage/downloads-store'

const WORK = { id: '3f9c0a1b2c3d4e5f', name: 'work-pc', user: 'you' }
const HOME = { id: 'aa00bb11cc22dd33', name: 'home', user: 'you' }

function status(computers: Record<string, unknown>[], thisId = HOME.id): unknown {
  return {
    ok: true,
    this: { id: thisId, name: 'home', sharing: false, code: '48219035' },
    computers,
    tailscale: { installed: true },
  }
}

const sharing = { ...WORK, sharing: true, online: true, paired: true, allowed: false }

describe('ewe-remote answers', () => {
  it('finds the binary through EWE_REMOTE_BIN, else the ewe bin dir and PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-remote-bin-'))
    const bin = join(dir, 'ewe-remote')
    writeFileSync(bin, '#!/bin/sh\n')
    expect(remoteBin({ EWE_REMOTE_BIN: bin }, () => '/usr/bin/ewe-remote')).toBe(bin)
    expect(remoteBin({ EWE_REMOTE_BIN: join(dir, 'missing') }, () => '/usr/bin/x')).toBeNull()
    expect(remoteBin({}, (tool) => `/usr/bin/${tool}`)).toBe('/usr/bin/ewe-remote')
    expect(remoteBin({}, () => null)).toBeNull()
  })

  it('reads status: paired computers, names cleaned, bad ids skipped, this computer known', () => {
    const parsed = parseStatus(
      status([
        sharing,
        { id: 'NOT-HEX!', name: 'odd', sharing: true, paired: true },
        { ...sharing, name: 'dup' },
        { id: 'bb', name: 'lap\u202etop\n', sharing: 'yes', online: 1, paired: true },
        { id: 'cc' },
      ]),
    )
    expect(parsed).toEqual({
      thisId: HOME.id,
      computers: [
        { id: WORK.id, name: 'work-pc', online: true, sharing: true, paired: true },
        { id: 'bb', name: 'laptop', online: false, sharing: false, paired: true },
        { id: 'cc', name: 'cc', online: false, sharing: false, paired: false },
      ],
    })
    expect(parseStatus({ ok: false, error: 'boom' })).toBeNull()
    expect(parseStatus(null)).toBeNull()
    expect(parseStatus({ ok: true })).toEqual(NO_STATUS)
  })

  it('reads status: a paired computer whose sharing is unknown (account unreachable) is worth trying', () => {
    const parsed = parseStatus(
      status([
        { id: 'dd', name: 'paired-unknown', sharing: null, paired: true },
        { id: 'ee', name: 'listed-unknown', sharing: null, paired: false },
        { id: 'ff', name: 'paired-off', sharing: false, paired: true },
      ]),
    )
    expect(parsed?.computers.map((c) => [c.id, c.sharing])).toEqual([
      ['dd', true],
      ['ee', false],
      ['ff', false],
    ])
  })

  it('reads a tunnel: only a loopback SOCKS address counts', () => {
    expect(parseTunnel({ ok: true, socks: '127.0.0.1:41234', pid: 9 })).toEqual({
      ok: true,
      host: '127.0.0.1',
      port: 41234,
    })
    expect(parseTunnel({ ok: true, socks: '[::1]:1080' })).toEqual({
      ok: true,
      host: '[::1]',
      port: 1080,
    })
    for (const socks of ['10.0.0.5:1080', 'localhost:1080', '127.0.0.1:0', '127.0.0.1:70000', 7])
      expect(parseTunnel({ ok: true, socks })).toMatchObject({ ok: false, error: 'bad-answer' })
    expect(parseTunnel(null)).toMatchObject({ ok: false, error: 'no-answer' })
    expect(
      parseTunnel({ ok: false, error: 'unreachable', message: 'work-pc\u0007 is\n offline' }),
    ).toEqual({ ok: false, error: 'unreachable', message: 'work-pc is offline' })
    expect(parseTunnel({ ok: false, error: 'not-sharing' })).toEqual({
      ok: false,
      error: 'not-sharing',
      message: 'it is not sharing',
    })
    expect(parseTunnel({ ok: false, error: '<b>' })).toMatchObject({ error: 'failed' })
  })

  it('builds a socks5 proxy that also carries loopback, and knows tunnel errors', () => {
    expect(proxyConfig('127.0.0.1', 41234)).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'socks5://127.0.0.1:41234',
      proxyBypassRules: '<-loopback>',
    })
    expect(isTunnelError(-130)).toBe(true)
    expect(isTunnelError(-120)).toBe(true)
    expect(isTunnelError(-20)).toBe(true)
    expect(isTunnelError(-105)).toBe(false)
    expect(isTunnelError(-106)).toBe(false)
    expect(tunnelErrorText('ERR_PROXY_CONNECTION_FAILED')).toBe(
      'the connection through it failed (ERR_PROXY_CONNECTION_FAILED)',
    )
    expect(tunnelErrorText('<script>')).toBe('the connection through it failed')
  })

  it('runs the binary with argv only and parses its JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-remote-run-'))
    const bin = join(dir, 'ewe-remote')
    writeFileSync(bin, '#!/bin/sh\nprintf \'{"ok":true,"args":"%s"}\' "$*"\n')
    chmodSync(bin, 0o755)
    expect(await runRemote(bin, ['tunnel', '$(touch x); id'], 2000)).toEqual({
      ok: true,
      args: 'tunnel $(touch x); id',
    })
    const broken = join(dir, 'broken')
    writeFileSync(broken, '#!/bin/sh\necho nope\nexit 3\n')
    chmodSync(broken, 0o755)
    expect(await runRemote(broken, ['status'], 2000)).toBeNull()
  })
})

interface FakeSession {
  proxies: Electron.ProxyConfig[]
  closed: number
  setProxy(config: Electron.ProxyConfig): Promise<void>
  closeAllConnections(): Promise<void>
}

function fakeSession(): FakeSession {
  return {
    proxies: [],
    closed: 0,
    setProxy(config) {
      this.proxies.push(config)
      return Promise.resolve()
    },
    closeAllConnections() {
      this.closed++
      return Promise.resolve()
    },
  }
}

function service(answers: { status?: unknown; tunnel?: unknown[] }, userData = tmpdir()) {
  const calls: string[][] = []
  const sessions = new Map<string, FakeSession>()
  const gates = new Map<string, () => boolean>()
  let clock = 1_000_000
  const tunnels = [...(answers.tunnel ?? [])]
  const remote = new RemoteService({
    userData,
    bin: () => '/fake/ewe-remote',
    now: () => clock,
    run: (_bin, args) => {
      calls.push(args)
      if (args[0] === 'status') return Promise.resolve(answers.status ?? null)
      return Promise.resolve(tunnels.length > 1 ? tunnels.shift() : tunnels[0])
    },
    fromPartition: (partition) => {
      const s = sessions.get(partition) ?? fakeSession()
      sessions.set(partition, s)
      return s as unknown as Session
    },
    setup: (session, gate) => {
      const partition = [...sessions].find(([, s]) => (s as unknown) === session)?.[0] ?? ''
      gates.set(partition, gate)
    },
  })
  return {
    remote,
    calls,
    sessions,
    gates,
    tick: (ms: number) => (clock += ms),
  }
}

describe('RemoteService', () => {
  it('caches status briefly and offers paired computers other than this one', async () => {
    const t = service({
      status: status([
        sharing,
        { ...HOME, sharing: true, paired: true },
        { id: 'bb', name: 'attic', sharing: false, online: false, paired: true },
        { id: 'cc', name: 'stranger', sharing: true, paired: false },
      ]),
    })
    expect(await t.remote.choices()).toEqual([
      { id: 'bb', name: 'attic', online: false, usable: false },
      { id: WORK.id, name: 'work-pc', online: true, usable: true },
    ])
    await t.remote.choices()
    expect(t.calls).toEqual([['status']])
    t.tick(STATUS_TTL_MS + 1)
    await t.remote.choices()
    expect(t.calls).toEqual([['status'], ['status']])
  })

  it('without ewe-remote there is nothing to offer and nothing runs', async () => {
    const calls: string[][] = []
    const remote = new RemoteService({
      userData: tmpdir(),
      bin: () => null,
      run: (_b, args) => {
        calls.push(args)
        return Promise.resolve(null)
      },
      fromPartition: () => fakeSession() as unknown as Session,
      setup: () => undefined,
    })
    expect(await remote.choices()).toEqual([])
    expect(await remote.pick('work-pc')).toMatchObject({ ok: false, error: 'no-remote' })
    expect(await remote.ensure(WORK.id)).toMatchObject({ ok: false, error: 'no-remote' })
    expect(remote.ready(WORK.id)).toBe(false)
    expect(calls).toEqual([])
  })

  it('picks a computer by id or name and says why it cannot', async () => {
    const t = service({
      status: status([
        sharing,
        { id: 'bb', name: 'attic', sharing: false, paired: true },
        { id: 'cc', name: 'stranger', sharing: true, paired: false },
      ]),
    })
    expect(await t.remote.pick('WORK-PC')).toMatchObject({ ok: true, computer: { id: WORK.id } })
    expect(await t.remote.pick(WORK.id)).toMatchObject({ ok: true })
    expect(await t.remote.pick('3f9c')).toMatchObject({ ok: true })
    expect(await t.remote.pick('attic')).toMatchObject({ ok: false, error: 'not-sharing' })
    expect(await t.remote.pick('stranger')).toMatchObject({ ok: false, error: 'not-paired' })
    expect(await t.remote.pick('nowhere')).toMatchObject({ ok: false, error: 'not-found' })
    const self = service({ status: status([{ ...sharing }], WORK.id) })
    expect(await self.remote.pick('work-pc')).toMatchObject({ ok: false, error: 'this-computer' })
  })

  it('keeps a remote session closed until its tunnel is up, then proxies through it', async () => {
    const t = service({
      status: status([sharing]),
      tunnel: [{ ok: true, socks: '127.0.0.1:41234', pid: 1 }],
    })
    const session = t.remote.sessionFor(WORK.id)
    const partition = `persist:remote-${WORK.id}`
    expect(t.sessions.get(partition)).toBe(session)
    expect(t.remote.remoteOf(session)).toBe(WORK.id)
    const gate = t.gates.get(partition)
    expect(gate?.()).toBe(false)
    const [a, b] = await Promise.all([t.remote.ensure(WORK.id), t.remote.ensure(WORK.id)])
    expect(a).toEqual({ ok: true, host: '127.0.0.1', port: 41234 })
    expect(b).toEqual(a)
    expect(t.calls.filter((c) => c[0] === 'tunnel')).toEqual([['tunnel', WORK.id]])
    expect(gate?.()).toBe(true)
    expect(t.remote.ready(WORK.id)).toBe(true)
    expect(t.sessions.get(partition)?.proxies).toEqual([
      {
        mode: 'fixed_servers',
        proxyRules: 'socks5://127.0.0.1:41234',
        proxyBypassRules: '<-loopback>',
      },
    ])
    await t.remote.ensure(WORK.id)
    expect(t.calls.filter((c) => c[0] === 'tunnel')).toHaveLength(1)
    t.remote.sessionFor(WORK.id)
    expect(t.gates.size).toBe(1)
  })

  it('a forced ensure asks again and moves the proxy when the port changed', async () => {
    const t = service({
      status: status([sharing]),
      tunnel: [
        { ok: true, socks: '127.0.0.1:41234' },
        { ok: true, socks: '127.0.0.1:41234' },
        { ok: true, socks: '127.0.0.1:50000' },
      ],
    })
    await t.remote.ensure(WORK.id)
    await t.remote.ensure(WORK.id, true)
    const fake = t.sessions.get(`persist:remote-${WORK.id}`)
    expect(fake?.closed).toBe(0)
    await t.remote.ensure(WORK.id, true)
    expect(fake?.proxies.map((p) => p.proxyRules)).toEqual([
      'socks5://127.0.0.1:41234',
      'socks5://127.0.0.1:41234',
      'socks5://127.0.0.1:50000',
    ])
    expect(fake?.closed).toBe(1)
  })

  it('a failed tunnel leaves the session closed; this computer is never tunnelled to', async () => {
    const t = service({
      status: status([sharing]),
      tunnel: [{ ok: false, error: 'unreachable', message: 'work-pc is offline' }],
    })
    expect(await t.remote.ensure(WORK.id)).toEqual({
      ok: false,
      error: 'unreachable',
      message: 'work-pc is offline',
    })
    expect(t.gates.get(`persist:remote-${WORK.id}`)?.()).toBe(false)
    expect(t.sessions.get(`persist:remote-${WORK.id}`)?.proxies).toEqual([])

    const self = service({ status: status([sharing], WORK.id), tunnel: [{ ok: true }] })
    expect(await self.remote.ensure(WORK.id)).toMatchObject({ ok: false, error: 'this-computer' })
    expect(self.calls.some((c) => c[0] === 'tunnel')).toBe(false)
    expect(() => self.remote.sessionFor('../default')).toThrow()
  })

  it('knows the remote partitions on disk, for Clear browsing data', () => {
    const userData = mkdtempSync(join(tmpdir(), 'ewe-remote-parts-'))
    for (const name of [`remote-${WORK.id}`, 'remote-bb', 'default', 'remote-..'])
      mkdirSync(join(userData, 'Partitions', name), { recursive: true })
    const t = service({}, userData)
    t.remote.sessionFor('cc')
    expect(t.remote.knownSessions().map((s) => t.remote.remoteOf(s))).toEqual(
      expect.arrayContaining(['cc', WORK.id, 'bb']),
    )
    expect(t.remote.knownSessions()).toHaveLength(3)
  })
})

describe('remote bindings on disk', () => {
  const window = (remote: unknown) => ({
    bounds: null,
    tabs: [{ url: 'https://intranet.example/', title: 'Intranet', workspace: 1 }],
    activeIndex: 0,
    workspaces: [
      { id: 'w1', name: 'Home', color: 'ewellow' },
      { id: 'w2', name: 'work-pc', color: 'sky', remote },
    ],
  })

  it('session.json keeps the binding, cleans its name and refuses a bad id', () => {
    const good = { version: 1, windows: [window({ id: WORK.id, name: 'work\u202e-pc' })] }
    expect(isSessionFile(good)).toBe(true)
    const [restored] = sanitizeWindows(good.windows as never)
    expect(restored?.workspaces?.[1]).toEqual({
      id: 'w2',
      name: 'work-pc',
      color: 'sky',
      remote: { id: WORK.id, name: 'work-pc' },
    })
    expect(restored?.workspaces?.[0]).toEqual({ id: 'w1', name: 'Home', color: 'ewellow' })
    expect(isSessionFile({ version: 1, windows: [window({ id: '../x', name: 'x' })] })).toBe(false)
    expect(isSessionFile({ version: 1, windows: [window('work-pc')] })).toBe(false)
    const unnamed = sanitizeWindows([window({ id: WORK.id, name: '' })] as never)
    expect(unnamed[0]?.workspaces?.[1]?.remote).toEqual({ id: WORK.id, name: WORK.id })
  })

  it('tabs of a remote workspace are not published to the synced tabs file', () => {
    const [win] = ownTabs([window({ id: WORK.id, name: 'work-pc' })] as never)
    expect(win).toBeUndefined()
    const both = ownTabs([
      {
        bounds: null,
        tabs: [
          { url: 'https://news.example/', title: 'News', workspace: 0 },
          { url: 'https://intranet.example/', title: 'Intranet', workspace: 1 },
        ],
        activeIndex: 0,
        workspaces: [
          { id: 'w1', name: 'Home', color: 'ewellow' },
          { id: 'w2', name: 'work-pc', color: 'sky', remote: { id: WORK.id, name: 'work-pc' } },
        ],
      },
    ])
    expect(both).toEqual([
      {
        workspaces: [
          {
            name: 'Home',
            color: 'ewellow',
            tabs: [{ url: 'https://news.example/', title: 'News', pinned: false }],
          },
        ],
      },
    ])
  })

  it('remote favicons are inlined, never handed to the shell as a url', () => {
    expect(inlineableFavicon('https://intranet.example/favicon.ico')).toBe('fetch')
    expect(inlineableFavicon('data:image/png;base64,AAAA')).toBe('data')
    expect(inlineableFavicon(`data:image/png;base64,${'A'.repeat(200_000)}`)).toBeNull()
    expect(inlineableFavicon('file:///etc/passwd')).toBeNull()
    expect(inlineableFavicon('chrome://favicon/x')).toBeNull()
  })

  it('a download remembers the computer it came through', () => {
    const entry = {
      id: 'd1',
      url: 'https://intranet.example/a.pdf',
      filename: 'a.pdf',
      path: '/tmp/a.pdf',
      mime: 'application/pdf',
      received: 1,
      total: 1,
      speed: 0,
      status: 'completed',
      started: 1,
      ended: 2,
    }
    expect(isDownloadEntry(entry)).toBe(true)
    expect(isDownloadEntry({ ...entry, via: WORK.id })).toBe(true)
    expect(isDownloadEntry({ ...entry, via: '../x' })).toBe(false)
  })
})
