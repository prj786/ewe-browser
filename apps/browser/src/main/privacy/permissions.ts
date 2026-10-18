import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import {
  PERMISSION_KINDS,
  isPermissionKind,
  isWebOrigin,
  type PermissionKind,
  type PermissionSite,
  type PermissionValue,
  type SitePermissions,
} from '@ewe/shared'
import { debounce, readJson, writeJsonAtomic } from '../storage/json-file'

export const PERMISSION_SITES_MAX = 1000

export const SILENT_ALLOW = new Set([
  'fullscreen',
  'pointerLock',
  'keyboardLock',
  'clipboard-sanitized-write',
  'mediaKeySystem',
  'screen-wake-lock',
])

export const INTERNAL_ALLOW = new Set([...SILENT_ALLOW, 'window-management'])

export function kindsFor(permission: string, mediaTypes: readonly string[] = []): PermissionKind[] {
  switch (permission) {
    case 'media': {
      const out: PermissionKind[] = []
      if (mediaTypes.includes('video')) out.push('camera')
      if (mediaTypes.includes('audio')) out.push('microphone')
      return out
    }
    case 'geolocation':
    case 'geolocation-approximate':
      return ['location']
    case 'notifications':
      return ['notifications']
    case 'clipboard-read':
      return ['clipboard']
    case 'midi':
    case 'midiSysex':
      return ['midi']
    case 'local-network-access':
    case 'local-network':
    case 'loopback-network':
      return ['local-network']
    case 'window-management':
      return ['windows']
    case 'idle-detection':
      return ['idle']
    default:
      return []
  }
}

export type Verdict = 'allow' | 'block' | 'ask'

export const DISMISS_LIMIT = 2
export const DISMISS_QUIET_MS = 10 * 60_000
export const PROMPT_CALLBACKS_MAX = 16

export class Dismissals {
  private readonly origins = new Map<string, { count: number; until: number }>()

  note(origin: string, now = Date.now()): void {
    const entry = this.origins.get(origin) ?? { count: 0, until: 0 }
    entry.count++
    if (entry.count >= DISMISS_LIMIT) {
      entry.count = 0
      entry.until = now + DISMISS_QUIET_MS
    }
    this.origins.set(origin, entry)
  }

  quiet(origin: string, now = Date.now()): boolean {
    return (this.origins.get(origin)?.until ?? 0) > now
  }

  forget(origin: string): void {
    this.origins.delete(origin)
  }
}

export function verdict(
  site: SitePermissions | undefined,
  kinds: readonly PermissionKind[],
): Verdict {
  if (kinds.length === 0) return 'block'
  if (kinds.some((k) => site?.[k] === 'block')) return 'block'
  if (kinds.every((k) => site?.[k] === 'allow')) return 'allow'
  return 'ask'
}

interface PermissionsFile {
  version: 1
  sites: PermissionSite[]
}

function isFile(value: unknown): value is PermissionsFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === 1 && Array.isArray(v.sites)
}

export function sanitizeSites(raw: unknown[]): PermissionSite[] {
  const seen = new Set<string>()
  const out: PermissionSite[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (!isWebOrigin(v.origin) || seen.has(v.origin)) continue
    const permissions: SitePermissions = {}
    if (typeof v.permissions === 'object' && v.permissions !== null)
      for (const [kind, value] of Object.entries(v.permissions as Record<string, unknown>))
        if (isPermissionKind(kind) && (value === 'allow' || value === 'block'))
          permissions[kind] = value
    if (Object.keys(permissions).length === 0) continue
    seen.add(v.origin)
    const updated =
      typeof v.updated === 'number' && Number.isFinite(v.updated) && v.updated >= 0 ? v.updated : 0
    out.push({ origin: v.origin, permissions, updated })
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, PERMISSION_SITES_MAX)
}

export class PermissionStore extends EventEmitter<{ change: [] }> {
  private readonly path: string
  private sites = new Map<string, PermissionSite>()
  private readonly write = debounce(() => {
    void writeJsonAtomic(this.path, this.toFile())
  }, 500)

  constructor(userData: string) {
    super()
    this.path = join(userData, 'permissions.json')
  }

  async load(): Promise<void> {
    const file = await readJson(this.path, isFile)
    this.sites = new Map(sanitizeSites(file?.sites ?? []).map((s) => [s.origin, s]))
  }

  get(origin: string): SitePermissions | undefined {
    return this.sites.get(origin)?.permissions
  }

  value(origin: string, kind: PermissionKind): PermissionValue {
    return this.get(origin)?.[kind] ?? 'ask'
  }

  list(): PermissionSite[] {
    return [...this.sites.values()]
      .map((s) => ({ ...s, permissions: { ...s.permissions } }))
      .sort((a, b) => b.updated - a.updated || a.origin.localeCompare(b.origin))
  }

  set(
    origin: string,
    kinds: readonly PermissionKind[],
    value: PermissionValue,
    now = Date.now(),
  ): void {
    if (!isWebOrigin(origin)) return
    const before = this.sites.get(origin)?.permissions ?? {}
    const current: SitePermissions = {}
    for (const kind of PERMISSION_KINDS) {
      const next = kinds.includes(kind) ? (value === 'ask' ? undefined : value) : before[kind]
      if (next !== undefined) current[kind] = next
    }
    this.sites.delete(origin)
    if (Object.keys(current).length > 0)
      this.sites.set(origin, { origin, permissions: current, updated: now })
    while (this.sites.size > PERMISSION_SITES_MAX) {
      const oldest = [...this.sites.values()].sort((a, b) => a.updated - b.updated)[0]
      if (oldest === undefined) break
      this.sites.delete(oldest.origin)
    }
    this.changed()
  }

  forget(origin: string): void {
    if (!this.sites.delete(origin)) return
    this.changed()
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.toFile())
  }

  private changed(): void {
    this.write()
    this.emit('change')
  }

  private toFile(): PermissionsFile {
    return { version: 1, sites: this.list() }
  }
}
