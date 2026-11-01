import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { absolutePaths, parseArgv } from './argv'
import { appVersion, runLocal } from './local'
import { offlineBookmark, offlineRead, offlineSite } from './offline'
import {
  failure,
  foreignOwner,
  PROTOCOL_VERSION,
  socketPath,
  userDataDir,
  type CliReply,
  type CliRequest,
} from './socket'
import { checkArgs, toolNamed, type Args } from './tools'

const CONNECT_MS = 1000
const REPLY_MS = 20_000
const LAUNCH_MS = 20_000
const HANDOFF_MS = 2500

type Sent = { reply: CliReply } | { offline: 'missing' | 'stale' }

function send(path: string, tool: string, args: Args): Promise<Sent> {
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (info !== undefined && foreignOwner(info))
    return Promise.resolve({ reply: failure('failed', `${path} belongs to another user`) })
  return new Promise((done) => {
    const socket = connect(path)
    let connected = false
    let buffer = ''
    const finish = (value: Sent) => {
      clearTimeout(timer)
      socket.destroy()
      done(value)
    }
    let timer = setTimeout(
      () => finish({ reply: failure('busy', 'ewe Browser does not accept the connection') }),
      CONNECT_MS,
    )
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      connected = true
      clearTimeout(timer)
      timer = setTimeout(
        () => finish({ reply: failure('timeout', 'ewe Browser did not answer in time') }),
        REPLY_MS,
      )
      const request: CliRequest = { v: PROTOCOL_VERSION, id: randomUUID(), tool, args }
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const reply = JSON.parse(buffer.slice(0, newline)) as CliReply & { id?: unknown }
        delete reply.id
        finish({ reply })
      } catch {
        finish({ reply: failure('bad-reply', 'ewe Browser sent something that is not JSON') })
      }
    })
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (connected) finish({ reply: failure('failed', 'the connection broke') })
      else if (error.code === 'ENOENT') finish({ offline: 'missing' })
      else if (error.code === 'ECONNREFUSED') finish({ offline: 'stale' })
      else finish({ reply: failure('failed', error.message) })
    })
    socket.on('close', () => {
      if (connected) finish({ reply: failure('failed', 'ewe Browser closed the connection') })
    })
  })
}

function appCommand(): string[] {
  const override = process.env.EWE_BROWSER_BIN
  if (override !== undefined && override !== '') return [override]
  if (__dirname.includes('app.asar')) return [process.execPath]
  const app = resolve(__dirname, '../..')
  return [join(app, 'node_modules/electron/dist/electron'), app]
}

function listening(path: string): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect(path)
    socket.on('connect', () => {
      socket.destroy()
      done(true)
    })
    socket.on('error', () => done(false))
  })
}

async function launch(path: string): Promise<CliReply | null> {
  const [bin, ...rest] = appCommand()
  if (bin === undefined || !existsSync(bin))
    return failure('not-installed', 'the ewe Browser binary was not found', 'set EWE_BROWSER_BIN')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let exitedAt: number | null = null
  const child = spawn(bin, rest, { detached: true, stdio: 'ignore', env })
  child.on('exit', () => (exitedAt = Date.now()))
  child.on('error', () => (exitedAt = Date.now()))
  child.unref()
  const started = Date.now()
  while (Date.now() - started < LAUNCH_MS) {
    await new Promise((r) => setTimeout(r, 150))
    if (existsSync(path) && (await listening(path))) return null
    if (exitedAt !== null && Date.now() - exitedAt > HANDOFF_MS)
      return failure(
        'no-socket',
        'ewe Browser is running but does not answer the command line (an older version?)',
        'restart ewe Browser',
      )
  }
  return failure('timeout', 'ewe Browser did not start in time')
}

async function run(argv: readonly string[]): Promise<{ reply: CliReply; pretty: boolean }> {
  const parsed = parseArgv(argv)
  if (!parsed.ok)
    return {
      reply: failure(parsed.error, parsed.message, 'ewe-browser help'),
      pretty: parsed.pretty,
    }
  const pretty = parsed.pretty
  const spec = toolNamed(parsed.tool)
  if (spec === undefined) return { reply: failure('unknown-verb', parsed.tool), pretty }
  const withPaths = absolutePaths(spec.name, parsed.args, {
    cwd: process.cwd(),
    home: homedir(),
    exists: existsSync,
  })
  const checked = checkArgs(spec, withPaths)
  if (!checked.ok) return { reply: failure('bad-args', checked.message, spec.usage), pretty }
  const args = checked.args
  const version = appVersion()
  if (spec.where === 'local') return { reply: await runLocal(spec.name, args, version), pretty }

  const userData = userDataDir()
  const socket = socketPath(userData)
  const first = await send(socket, spec.name, args)
  if ('reply' in first) return { reply: first.reply, pretty }
  switch (spec.where) {
    case 'read':
      return { reply: await offlineRead(spec.name, args, { userData, socket, version }), pretty }
    case 'store':
      return { reply: await offlineBookmark(spec.name, args, userData), pretty }
    case 'live':
      return {
        reply: failure('not-running', 'ewe Browser is not running', 'ewe-browser focus starts it'),
        pretty,
      }
    default: {
      if (spec.name === 'search' && typeof args.site === 'string' && args.site.trim() !== '') {
        const found = await offlineSite(args.site, userData)
        if (!found.ok) return { reply: found, pretty }
      }
      if (first.offline === 'stale') rmSync(socket, { force: true })
      const problem = await launch(socket)
      if (problem !== null) return { reply: problem, pretty }
      const second = await send(socket, spec.name, args)
      return {
        reply:
          'reply' in second
            ? { ...second.reply, launched: true }
            : failure('not-running', 'ewe Browser started but does not answer'),
        pretty,
      }
    }
  }
}

function print(reply: CliReply, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(reply, null, pretty ? 2 : undefined)}\n`, () =>
    process.exit(0),
  )
}

run(process.argv.slice(2))
  .then(({ reply, pretty }) => print(reply, pretty))
  .catch((error: unknown) =>
    print(failure('internal', error instanceof Error ? error.message : String(error)), false),
  )
