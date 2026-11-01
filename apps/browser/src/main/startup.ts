import { runTool } from './files/places'

export const STARTUP_NAME = 'ewe Browser'
const LEGACY_NAMES = new Set([STARTUP_NAME, 'ewe browser'])

export interface StartupEntry {
  enabled: boolean
  exec: string
  icon: string
  name: string
}

function quote(arg: string): string {
  return /^[\w./-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`
}

export function startupExec(command: string[]): string {
  return [...command, '--background'].map(quote).join(' ')
}

function isEntry(value: unknown): value is StartupEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.exec === 'string' && typeof v.name === 'string'
}

export function parseEntries(text: string | null): StartupEntry[] | null {
  if (text === null) return null
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === 'null') return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed.filter(isEntry) : null
  } catch {
    return null
  }
}

export function withEntry(entries: StartupEntry[], on: boolean, exec: string): StartupEntry[] {
  const rest = entries.filter((e) => !LEGACY_NAMES.has(e.name))
  return on ? [...rest, { enabled: true, exec, icon: 'web-browser', name: STARTUP_NAME }] : rest
}

export class Startup {
  private readonly exec: string

  constructor(command: string[]) {
    this.exec = startupExec(command)
  }

  async status(): Promise<{ available: boolean; on: boolean }> {
    const entries = parseEntries(await runTool('ewe-conf', ['get', 'apps.startup']))
    if (entries === null) return { available: false, on: false }
    return { available: true, on: entries.some((e) => LEGACY_NAMES.has(e.name) && e.enabled) }
  }

  async set(on: boolean): Promise<{ available: boolean; on: boolean }> {
    const entries = parseEntries(await runTool('ewe-conf', ['get', 'apps.startup']))
    if (entries === null) return { available: false, on: false }
    const next = withEntry(entries, on, this.exec)
    await runTool('ewe-conf', ['set', 'apps.startup', JSON.stringify(next)], 30_000)
    return this.status()
  }
}
