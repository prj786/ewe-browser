import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SafeClient, safeSocketPath, type SafeEvent } from '../../src/main/safe/client'

interface Fake {
  path: string
  server: Server
  requests: Record<string, unknown>[]
  subscribers: Socket[]
  close(): Promise<void>
}

const dirs: string[] = []
const servers: Fake[] = []

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function fake(
  answer: (req: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<Fake> {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-safe-client-'))
  dirs.push(dir)
  const path = join(dir, 'ewe-safe.sock')
  const requests: Record<string, unknown>[] = []
  const subscribers: Socket[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const req = JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>
        buffer = buffer.slice(nl + 1)
        requests.push(req)
        if (req.verb === 'subscribe') {
          subscribers.push(socket)
          socket.write(`${JSON.stringify({ v: 1, id: req.id, ok: true })}\n`)
        } else {
          const reply = answer(req)
          if (reply !== null) socket.write(`${JSON.stringify({ v: 1, id: req.id, ...reply })}\n`)
        }
        nl = buffer.indexOf('\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  const handle: Fake = {
    path,
    server,
    requests,
    subscribers,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
  servers.push(handle)
  return handle
}

const nextEvent = (client: SafeClient) =>
  new Promise<SafeEvent>((resolve) => client.once('event', resolve))

describe('safeSocketPath', () => {
  it('prefers EWE_SAFE_SOCKET, then XDG_RUNTIME_DIR', () => {
    expect(safeSocketPath({ EWE_SAFE_SOCKET: '/tmp/x.sock', XDG_RUNTIME_DIR: '/run/u' })).toBe(
      '/tmp/x.sock',
    )
    expect(safeSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' })).toBe(
      '/run/user/1000/ewe-safe.sock',
    )
    expect(safeSocketPath({})).toBeNull()
  })
})

describe('SafeClient', () => {
  it('answers daemon-unavailable without a socket', async () => {
    const client = new SafeClient(() => '/nonexistent/ewe-safe.sock')
    expect(client.available()).toBe(false)
    expect(await client.call('status')).toMatchObject({ ok: false, error: 'daemon-unavailable' })
  })

  it('sends v1 requests and matches the reply by id', async () => {
    const server = await fake((req) =>
      req.verb === 'list' ? { ok: true, items: [{ id: 'a', title: 'A' }] } : { ok: false },
    )
    const client = new SafeClient(() => server.path)
    expect(client.available()).toBe(true)
    const reply = await client.call('list', { kind: 'login' })
    expect(reply.ok).toBe(true)
    expect(reply.items).toEqual([{ id: 'a', title: 'A' }])
    expect(server.requests[0]).toMatchObject({ v: 1, verb: 'list', args: { kind: 'login' } })
  })

  it('carries the error and message of a failure', async () => {
    const server = await fake(() => ({ ok: false, error: 'locked', message: 'Safe is locked.' }))
    const reply = await new SafeClient(() => server.path).call('reveal', { id: 'a' })
    expect(reply).toMatchObject({ ok: false, error: 'locked', message: 'Safe is locked.' })
  })

  it('times out when the daemon does not answer', async () => {
    const server = await fake(() => null)
    const reply = await new SafeClient(() => server.path).call('status', {}, 100)
    expect(reply).toMatchObject({ ok: false, error: 'timeout' })
  })

  it('streams events and reconnects after the daemon restarts', async () => {
    const server = await fake(() => ({ ok: true }))
    const client = new SafeClient(() => server.path)
    client.watch()
    await expect.poll(() => server.subscribers.length).toBe(1)
    const locked = nextEvent(client)
    server.subscribers[0]?.write(`${JSON.stringify({ v: 1, event: 'locked', reason: 'screen' })}\n`)
    expect(await locked).toEqual({ event: 'locked', reason: 'screen' })
    const gone = nextEvent(client)
    server.subscribers[0]?.destroy()
    expect(await gone).toEqual({ event: 'gone' })
    await expect.poll(() => server.subscribers.length, { timeout: 4000 }).toBe(2)
    client.stop()
  })
})
