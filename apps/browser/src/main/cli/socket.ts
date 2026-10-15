import { createHash } from 'node:crypto'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

export const PROTOCOL_VERSION = 1

export interface CliRequest {
  v: number
  id: string
  tool: string
  args: Record<string, unknown>
}

export type CliReply = { ok: true; [key: string]: unknown } | CliError

export interface CliError {
  ok: false
  error: string
  message?: string | undefined
  hint?: string | undefined
  [key: string]: unknown
}

export function failure(error: string, message?: string, hint?: string): CliError {
  const out: CliError = { ok: false, error }
  if (message !== undefined) out.message = message
  if (hint !== undefined) out.hint = hint
  return out
}

export function userDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EWE_USER_DATA !== undefined && env.EWE_USER_DATA !== '') return resolve(env.EWE_USER_DATA)
  const config = env.XDG_CONFIG_HOME
  return join(
    config !== undefined && config !== '' ? config : join(homedir(), '.config'),
    'ewe-browser',
  )
}

export function socketPath(userData: string, env: NodeJS.ProcessEnv = process.env): string {
  const hash = createHash('sha256').update(resolve(userData)).digest('hex').slice(0, 12)
  const runtime = env.XDG_RUNTIME_DIR
  const dir =
    runtime !== undefined && runtime !== ''
      ? runtime
      : join(tmpdir(), `ewe-browser-${userInfo().uid}`)
  return join(dir, `ewe-browser-${hash}.sock`)
}

export function foreignOwner(info: { uid: number }): boolean {
  const uid = process.getuid?.()
  return uid !== undefined && info.uid !== uid
}

export function iso(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString()
}
