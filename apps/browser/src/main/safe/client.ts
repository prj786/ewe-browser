import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'

export interface SafeReply {
  ok: boolean
  error?: string | undefined
  message?: string | undefined
  [key: string]: unknown
}

export type SafeEvent =
  | { event: 'locked'; reason: string }
  | { event: 'unlocked' }
  | { event: 'changed' }
  | { event: 'sync' }
  | { event: 'gone' }

const CALL_TIMEOUT_MS = 20_000
const LINE_MAX = 8 * 1024 * 1024
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000

export function safeSocketPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.EWE_SAFE_SOCKET
  if (explicit !== undefined && explicit !== '') return explicit
  const runtime = env.XDG_RUNTIME_DIR
  if (runtime === undefined || runtime === '') return null
  return join(runtime, 'ewe-safe.sock')
}

export const UNAVAILABLE: SafeReply = {
  ok: false,
  error: 'daemon-unavailable',
  message: 'Safe is not running.',
}

export function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function toReply(value: Record<string, unknown>): SafeReply {
  return {
    ...value,
    ok: value.ok === true,
    error: typeof value.error === 'string' ? value.error : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  }
}

function toEvent(value: Record<string, unknown>): SafeEvent | null {
  switch (value.event) {
    case 'locked':
      return { event: 'locked', reason: typeof value.reason === 'string' ? value.reason : '' }
    case 'unlocked':
      return { event: 'unlocked' }
    case 'changed':
      return { event: 'changed' }
    case 'sync':
      return { event: 'sync' }
    default:
      return null
  }
}

function lines(onLine: (line: string) => boolean): (chunk: string) => boolean {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    if (buffer.length > LINE_MAX) return false
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.trim() !== '' && onLine(line)) return true
      nl = buffer.indexOf('\n')
    }
    return true
  }
}

export class SafeClient extends EventEmitter<{ event: [SafeEvent] }> {
  private readonly path: () => string | null
  private seq = 0
  private sub: Socket | null = null
  private retry: NodeJS.Timeout | null = null
  private backoff = RETRY_MIN_MS
  private watching = false

  constructor(path: () => string | null = () => safeSocketPath()) {
    super()
    this.path = path
  }

  available(): boolean {
    const path = this.path()
    return path !== null && existsSync(path)
  }

  call(
    verb: string,
    args: Record<string, unknown> = {},
    timeout = CALL_TIMEOUT_MS,
  ): Promise<SafeReply> {
    const path = this.path()
    if (path === null || !existsSync(path)) return Promise.resolve(UNAVAILABLE)
    const id = ++this.seq
    return new Promise((resolve) => {
      let done = false
      const socket = createConnection(path)
      const finish = (reply: SafeReply) => {
        if (done) return
        done = true
        clearTimeout(timer)
        socket.destroy()
        resolve(reply)
      }
      const timer = setTimeout(
        () => finish({ ok: false, error: 'timeout', message: 'Safe did not answer.' }),
        timeout,
      )
      const feed = lines((line) => {
        const value = parseLine(line)
        if (value?.id !== id) return false
        finish(toReply(value))
        return true
      })
      socket.setEncoding('utf8')
      socket.on('connect', () => socket.write(`${JSON.stringify({ v: 1, id, verb, args })}\n`))
      socket.on('data', (chunk: string) => {
        if (!feed(chunk)) finish({ ok: false, error: 'internal', message: 'Safe answered badly.' })
      })
      socket.on('error', () => finish(UNAVAILABLE))
      socket.on('close', () => finish(UNAVAILABLE))
    })
  }

  watch(): void {
    if (this.watching) return
    this.watching = true
    this.connectEvents()
  }

  stop(): void {
    this.watching = false
    if (this.retry !== null) clearTimeout(this.retry)
    this.retry = null
    this.sub?.destroy()
    this.sub = null
  }

  private schedule(): void {
    if (!this.watching || this.retry !== null) return
    this.retry = setTimeout(() => {
      this.retry = null
      this.connectEvents()
    }, this.backoff)
    this.backoff = Math.min(this.backoff * 2, RETRY_MAX_MS)
  }

  private connectEvents(): void {
    if (!this.watching) return
    const path = this.path()
    if (path === null || !existsSync(path)) {
      this.schedule()
      return
    }
    const id = ++this.seq
    const socket = createConnection(path)
    this.sub = socket
    let open = false
    const feed = lines((line) => {
      const value = parseLine(line)
      if (value === null) return false
      if (value.id === id) {
        open = value.ok !== false
        if (open) this.backoff = RETRY_MIN_MS
        return false
      }
      const event = toEvent(value)
      if (event !== null) this.emit('event', event)
      return false
    })
    socket.setEncoding('utf8')
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ v: 1, id, verb: 'subscribe', args: {} })}\n`),
    )
    socket.on('data', (chunk: string) => {
      if (!feed(chunk)) socket.destroy()
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      if (this.sub === socket) this.sub = null
      if (open) this.emit('event', { event: 'gone' })
      this.schedule()
    })
  }
}
