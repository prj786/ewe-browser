import { rmSync } from 'node:fs'
import { chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { failure, foreignOwner, PROTOCOL_VERSION, type CliReply, type CliRequest } from './socket'
import { checkArgs, toolNamed, type Args } from './tools'

const MAX_LINE = 1 << 20

export type CliHandler = (tool: string, args: Args) => Promise<CliReply>

export function isCliRequest(value: unknown): value is CliRequest {
  if (value === null || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    typeof r.v === 'number' &&
    typeof r.id === 'string' &&
    typeof r.tool === 'string' &&
    r.args !== null &&
    typeof r.args === 'object' &&
    !Array.isArray(r.args)
  )
}

export async function answer(
  line: string,
  handle: CliHandler,
): Promise<CliReply & { id?: string }> {
  let request: unknown
  try {
    request = JSON.parse(line)
  } catch {
    return failure('bad-request', 'not JSON')
  }
  if (!isCliRequest(request)) return failure('bad-request', 'expected {v, id, tool, args}')
  const reply = await (async (): Promise<CliReply> => {
    if (request.v !== PROTOCOL_VERSION)
      return failure(
        'protocol',
        `this browser speaks protocol ${PROTOCOL_VERSION}`,
        'update ewe-browser',
      )
    const spec = toolNamed(request.tool)
    if (spec === undefined || spec.where === 'local')
      return failure('unknown-verb', `unknown tool: ${request.tool}`)
    const checked = checkArgs(spec, request.args)
    if (!checked.ok) return failure('bad-args', checked.message, spec.usage)
    try {
      return await handle(spec.name, checked.args)
    } catch (error) {
      return failure('failed', error instanceof Error ? error.message : String(error))
    }
  })()
  return { ...reply, id: request.id }
}

function serve(socket: Socket, handle: CliHandler): void {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > MAX_LINE) {
      socket.destroy()
      return
    }
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line !== '')
        void answer(line, handle).then((reply) => {
          if (!socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`)
        })
      newline = buffer.indexOf('\n')
    }
  })
  socket.on('error', () => socket.destroy())
}

export interface CliServer {
  path: string
  close(): void
}

export async function listenCli(path: string, handle: CliHandler): Promise<CliServer> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await lstat(dir)
  if (!info.isDirectory() || foreignOwner(info) || (info.mode & 0o022) !== 0)
    throw new Error(`${dir} is not a private folder of this user`)
  await rm(path, { force: true })
  const server: Server = createServer((socket) => serve(socket, handle))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  await chmod(path, 0o600)
  return {
    path,
    close: () => {
      server.close()
      rmSync(path, { force: true })
    },
  }
}
