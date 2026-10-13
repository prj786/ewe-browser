import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Account } from '@ewe/shared'

export function eweCloudPath(): string {
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(config, 'ewe', 'cloud.json')
}

export function parseEweAccount(text: string): Account | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  const name = [p.display_name, p.login_name, p.user].find(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  )
  if (name === undefined) return null
  return {
    name,
    email: typeof p.email === 'string' ? p.email : null,
    server: typeof p.server === 'string' ? p.server : null,
  }
}

export function readEweAccount(path = eweCloudPath()): Account | null {
  if (!existsSync(path)) return null
  try {
    return parseEweAccount(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
