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

export interface RemoteFailure {
  title: string
  text: string
}

const DID_NOT_ANSWER: ReadonlySet<string> = new Set(['unreachable', 'tunnel'])

// The headline says whose problem it is: "emoh can’t be reached" over a bug on this computer
// sent the owner looking at the network while plain ssh worked (2026-11-05). A null code is a
// tab restored from before the code existed.
export function remoteFailure(code: string | null, name: string): RemoteFailure {
  if (code === null || DID_NOT_ANSWER.has(code))
    return {
      title: `${name} can’t be reached`,
      text: `This workspace browses from ${name}, so its pages load only through it.`,
    }
  if (code === 'not-sharing')
    return {
      title: `${name} isn’t sharing`,
      text: `Turn on Share this computer on ${name}, then try again.`,
    }
  if (code === 'not-paired' || code === 'not-allowed')
    return {
      title: `${name} doesn’t accept this computer`,
      text: `Pair with it again, using the code ${name} shows.`,
    }
  return {
    title: `Couldn’t connect to ${name}`,
    text: `The problem is on this computer, so ${name} itself may be fine.`,
  }
}
