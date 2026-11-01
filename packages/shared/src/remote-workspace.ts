export interface RemoteBinding {
  id: string
  name: string
}

export interface RemoteComputer {
  id: string
  name: string
  online: boolean
  sharing: boolean
  paired: boolean
}

export interface RemoteChoice {
  id: string
  name: string
  online: boolean
  usable: boolean
}

export const REMOTE_PARTITION_PREFIX = 'persist:remote-'
export const REMOTE_NAME_MAX = 64

const REMOTE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

export function isRemoteId(value: unknown): value is string {
  return typeof value === 'string' && REMOTE_ID.test(value)
}

export function remotePartition(id: string): string {
  return `${REMOTE_PARTITION_PREFIX}${id}`
}

export function cleanRemoteName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(HIDDEN, '').trim().slice(0, REMOTE_NAME_MAX)
  return name === '' ? null : name
}

export function isRemoteBinding(value: unknown): value is RemoteBinding {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Record<string, unknown>
  return isRemoteId(b.id) && cleanRemoteName(b.name) === b.name
}

export function canBrowseFrom(computer: RemoteComputer, thisId: string | null): boolean {
  return computer.paired && computer.sharing && computer.id !== thisId
}

export function remoteChoices(computers: RemoteComputer[], thisId: string | null): RemoteChoice[] {
  return computers
    .filter((c) => c.paired && c.id !== thisId)
    .map((c) => ({ id: c.id, name: c.name, online: c.online, usable: c.sharing }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function matchComputer(
  computers: RemoteComputer[],
  key: string,
): RemoteComputer | undefined {
  const wanted = key.trim()
  if (wanted === '') return undefined
  const byId = computers.find((c) => c.id === wanted)
  if (byId !== undefined) return byId
  const lower = wanted.toLowerCase()
  const byName = computers.filter((c) => c.name.toLowerCase() === lower)
  if (byName.length === 1) return byName[0]
  if (wanted.length < 4) return undefined
  const byPrefix = computers.filter((c) => c.id.startsWith(lower))
  return byPrefix.length === 1 ? byPrefix[0] : undefined
}
