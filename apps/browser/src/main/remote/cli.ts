import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cleanRemoteName, isRemoteId, type RemoteComputer } from '@ewe/shared'
import { toolPath } from '../files/places'

export const STATUS_TIMEOUT_MS = 5_000
export const TUNNEL_TIMEOUT_MS = 30_000
export const MAX_COMPUTERS = 64
export const PROXY_BYPASS = '<-loopback>'

export interface RemoteStatus {
  thisId: string | null
  computers: RemoteComputer[]
}

export const NO_STATUS: RemoteStatus = { thisId: null, computers: [] }

export type TunnelResult =
  { ok: true; host: string; port: number } | { ok: false; error: string; message: string }

export type RunRemote = (bin: string, args: string[], timeout: number) => Promise<unknown>

const SOCKS = /^(127\.0\.0\.1|\[::1\]):(\d{1,5})$/
const ERROR_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MESSAGE_MAX = 300

const MESSAGES: Record<string, string> = {
  unreachable: 'it is not answering',
  'not-paired': 'this computer is not paired with it',
  'not-sharing': 'it is not sharing',
  'this-computer': 'it is this computer',
  'no-remote': 'ewe Remote is not installed',
  'no-answer': 'ewe-remote did not answer',
  'bad-answer': 'ewe-remote gave no local SOCKS address',
}

export function remoteBin(
  env: NodeJS.ProcessEnv = process.env,
  find: (tool: string) => string | null = toolPath,
): string | null {
  const override = env.EWE_REMOTE_BIN
  if (override !== undefined && override !== '') return existsSync(override) ? override : null
  return find('ewe-remote')
}

export const runRemote: RunRemote = (bin, args, timeout) => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout, encoding: 'utf8', maxBuffer: 1 << 20, env },
      (_error, stdout) => {
        try {
          resolve(JSON.parse(stdout) as unknown)
        } catch {
          resolve(null)
        }
      },
    )
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseStatus(raw: unknown): RemoteStatus | null {
  const top = record(raw)
  if (top?.ok !== true) return null
  const self = record(top.this)
  const thisId = isRemoteId(self?.id) ? self.id : null
  const list = Array.isArray(top.computers) ? top.computers : []
  const seen = new Set<string>()
  const computers: RemoteComputer[] = []
  for (const item of list) {
    const c = record(item)
    if (c === null || !isRemoteId(c.id) || seen.has(c.id)) continue
    seen.add(c.id)
    computers.push({
      id: c.id,
      name: cleanRemoteName(c.name) ?? c.id,
      online: c.online === true,
      // null = unknown (paired, but the account listing could not be read):
      // worth trying — `ewe-remote tunnel` answers not-sharing if it is off
      sharing: c.sharing === true || (c.paired === true && (c.sharing === null || c.sharing === undefined)),
      paired: c.paired === true,
    })
    if (computers.length >= MAX_COMPUTERS) break
  }
  return { thisId, computers }
}

export function remoteMessage(error: string, message?: unknown): string {
  const given = cleanText(message)
  return given ?? MESSAGES[error] ?? 'it can’t be reached'
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? null : text.slice(0, MESSAGE_MAX)
}

export function tunnelFailure(error: string, message?: unknown): TunnelResult {
  return { ok: false, error, message: remoteMessage(error, message) }
}

export function parseTunnel(raw: unknown): TunnelResult {
  const top = record(raw)
  if (top === null) return tunnelFailure('no-answer')
  if (top.ok !== true) {
    const error = typeof top.error === 'string' && ERROR_CODE.test(top.error) ? top.error : 'failed'
    return tunnelFailure(error, top.message)
  }
  const socks = typeof top.socks === 'string' ? SOCKS.exec(top.socks) : null
  const port = Number(socks?.[2])
  if (socks === null || !Number.isInteger(port) || port < 1 || port > 65535)
    return tunnelFailure('bad-answer')
  return { ok: true, host: socks[1] ?? '127.0.0.1', port }
}

export function proxyConfig(host: string, port: number): Electron.ProxyConfig {
  return {
    mode: 'fixed_servers',
    proxyRules: `socks5://${host}:${port}`,
    proxyBypassRules: PROXY_BYPASS,
  }
}

const PROXY_ERRORS = new Set([-20, -111, -115, -120, -121, -127, -130, -131, -336])

export function isTunnelError(code: number): boolean {
  return PROXY_ERRORS.has(code)
}

export function tunnelErrorText(description: string): string {
  const code = /^[A-Z0-9_]{1,64}$/.test(description) ? ` (${description})` : ''
  return `the connection through it failed${code}`
}
