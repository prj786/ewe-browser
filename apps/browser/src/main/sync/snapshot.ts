import type { FsPlaceSync, FsSyncState } from '@ewe/shared'

const MAX_FOLDERS = 200

export const SNAPSHOT_FILE = 'sync-folders.json'
export const NUDGE_FILE = 'sync-now'

export interface SyncSnapshotFolder extends FsPlaceSync {
  key: string
  name: string
  local: string
  remote: string
}

export interface SyncSnapshot {
  signedIn: boolean
  folders: SyncSnapshotFolder[]
  accountFolder: { path: string; state: 'mounted' | 'synced' | 'off' } | null
}

const SYNC_STATES: ReadonlySet<string> = new Set([
  'synced',
  'syncing',
  'pending',
  'paused',
  'error',
  'conflict',
  'offline',
])

function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')) return null
  if (value.length > 4096) return null
  const trimmed = value.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function str(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function folderOf(value: unknown): SyncSnapshotFolder | null {
  if (typeof value !== 'object' || value === null) return null
  const f = value as Record<string, unknown>
  const local = cleanPath(f.local)
  if (local === null || local === '/') return null
  const state = typeof f.state === 'string' && SYNC_STATES.has(f.state) ? f.state : 'pending'
  const last = typeof f.last_sync === 'number' && Number.isFinite(f.last_sync) ? f.last_sync : 0
  const conflicts =
    typeof f.conflicts === 'number' && Number.isInteger(f.conflicts) && f.conflicts > 0
      ? Math.min(f.conflicts, 100_000)
      : 0
  return {
    key: str(f.key, 1000),
    name: str(f.name, 255) || (local.split('/').pop() ?? local),
    local,
    remote: str(f.remote, 4096),
    state: state as FsSyncState,
    conflicts,
    lastSync: last > 0 ? Math.round(last * 1000) : null,
    engine: f.engine === 'nextcloud-app' ? 'nextcloud-app' : 'ewe',
    error: str(f.error),
  }
}

export function parseSyncSnapshot(text: string | null): SyncSnapshot | null {
  if (text === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const s = parsed as Record<string, unknown>
  if (s.version !== 1 || !Array.isArray(s.folders)) return null
  const folders: SyncSnapshotFolder[] = []
  const seen = new Set<string>()
  for (const raw of s.folders.slice(0, MAX_FOLDERS)) {
    const folder = folderOf(raw)
    if (folder === null || seen.has(folder.local)) continue
    seen.add(folder.local)
    folders.push(folder)
  }
  let accountFolder: SyncSnapshot['accountFolder'] = null
  if (typeof s.account_folder === 'object' && s.account_folder !== null) {
    const a = s.account_folder as Record<string, unknown>
    const path = cleanPath(a.path)
    if (path !== null && (a.state === 'mounted' || a.state === 'synced' || a.state === 'off'))
      accountFolder = { path, state: a.state }
  }
  return { signedIn: s.signed_in === true, folders, accountFolder }
}

export function placeSync(folder: SyncSnapshotFolder): FsPlaceSync {
  return {
    state: folder.state,
    conflicts: folder.conflicts,
    lastSync: folder.lastSync,
    engine: folder.engine,
    error: folder.error,
  }
}
