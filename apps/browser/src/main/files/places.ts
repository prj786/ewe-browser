import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gvfsLabel, type FsPlace, type FsPlaceIcon } from '@ewe/shared'

export interface CloudStatus {
  configured: boolean
  mounted: boolean
  path?: string | undefined
}

export interface PlacesEnv {
  home: string
  user: string
  uid: number
  configHome: string
  dataHome: string
  readText(path: string): string | null
  listDirs(path: string): string[]
  isDir(path: string): boolean
  mounts(): string
  status(tool: string): Promise<CloudStatus | null>
}

const XDG_DIRS: { key: string; icon: FsPlaceIcon; fallback: string }[] = [
  { key: 'DESKTOP', icon: 'monitor', fallback: 'Desktop' },
  { key: 'DOCUMENTS', icon: 'file', fallback: 'Documents' },
  { key: 'DOWNLOAD', icon: 'download', fallback: 'Downloads' },
  { key: 'MUSIC', icon: 'music', fallback: 'Music' },
  { key: 'PICTURES', icon: 'image', fallback: 'Pictures' },
  { key: 'VIDEOS', icon: 'video', fallback: 'Videos' },
  { key: 'PROJECTS', icon: 'code', fallback: 'Projects' },
]

export function parseUserDirs(text: string, home: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^XDG_([A-Z]+)_DIR="(.*)"\s*$/.exec(line.trim())
    const key = m?.[1]
    const raw = m?.[2]
    if (key === undefined || raw === undefined) continue
    out[key] = raw.replace(/^\$HOME/, home)
  }
  return out
}

export function parseGtkBookmarks(text: string): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('file://')) continue
    const space = trimmed.indexOf(' ')
    const uri = space === -1 ? trimmed : trimmed.slice(0, space)
    try {
      const path = fileURLToPath(uri)
      const label = space === -1 ? (path.split('/').pop() ?? path) : trimmed.slice(space + 1)
      out.push({ path, label })
    } catch {
      continue
    }
  }
  return out
}

export function parseMountPoints(text: string, type: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const parts = line.split(' ')
    const point = parts[1]
    if (parts[2] === type && point !== undefined)
      out.push(point.replace(/\\040/g, ' ').replace(/\\011/g, '\t'))
  }
  return out
}

function cloudPlace(
  id: 'nextcloud' | 'drive',
  label: string,
  status: CloudStatus | null,
  fallbackPath: string,
): FsPlace | null {
  if (status === null) return null
  return {
    id,
    label,
    path: status.path ?? fallbackPath,
    group: 'cloud',
    icon: 'cloud',
    state: status.mounted ? 'ready' : status.configured ? 'offline' : 'setup',
    mount: id,
  }
}

export async function computePlaces(env: PlacesEnv): Promise<FsPlace[]> {
  const places: FsPlace[] = [
    { id: 'home', label: 'Home', path: env.home, group: 'places', icon: 'house', state: 'ready' },
  ]
  const dirs = parseUserDirs(env.readText(join(env.configHome, 'user-dirs.dirs')) ?? '', env.home)
  const seen = new Set<string>([env.home])
  for (const d of XDG_DIRS) {
    const path = dirs[d.key] ?? join(env.home, d.fallback)
    if (seen.has(path) || !env.isDir(path)) continue
    seen.add(path)
    places.push({
      id: `xdg-${d.key.toLowerCase()}`,
      label: path.split('/').pop() ?? d.fallback,
      path,
      group: 'places',
      icon: d.icon,
      state: 'ready',
    })
  }

  const [files, drive] = await Promise.all([env.status('ewe-files'), env.status('ewe-drive')])
  for (const place of [
    cloudPlace('nextcloud', 'Nextcloud', files, join(env.home, 'Nextcloud')),
    cloudPlace('drive', 'Google Drive', drive, join(env.home, 'Google Drive')),
  ]) {
    if (place === null) continue
    seen.add(place.path)
    places.push(place)
  }

  for (const b of parseGtkBookmarks(
    env.readText(join(env.configHome, 'gtk-3.0', 'bookmarks')) ?? '',
  )) {
    if (seen.has(b.path)) continue
    seen.add(b.path)
    places.push({
      id: `bookmark-${b.path}`,
      label: b.label,
      path: b.path,
      group: 'bookmarks',
      icon: 'folder',
      state: env.isDir(b.path) ? 'ready' : 'offline',
    })
  }

  const media = join('/run/media', env.user)
  for (const name of env.listDirs(media)) {
    places.push({
      id: `media-${name}`,
      label: name,
      path: join(media, name),
      group: 'devices',
      icon: 'drive',
      state: 'ready',
    })
  }
  const gvfs = `/run/user/${env.uid}/gvfs`
  for (const name of env.listDirs(gvfs)) {
    const { label, icon } = gvfsLabel(name)
    places.push({
      id: `gvfs-${name}`,
      label,
      path: join(gvfs, name),
      group: 'devices',
      icon,
      state: 'ready',
    })
  }
  for (const path of parseMountPoints(env.mounts(), 'fuse.rclone')) {
    if (seen.has(path)) continue
    seen.add(path)
    places.push({
      id: `rclone-${path}`,
      label: path.split('/').pop() ?? path,
      path,
      group: 'devices',
      icon: 'cloud',
      state: 'ready',
    })
  }

  places.push(
    {
      id: 'root',
      label: 'File system',
      path: '/',
      group: 'other',
      icon: 'hard-drive',
      state: 'ready',
    },
    {
      id: 'trash',
      label: 'Trash',
      path: join(env.dataHome, 'Trash', 'files'),
      group: 'other',
      icon: 'trash-2',
      state: 'ready',
    },
  )
  return places
}

export function eweBinDir(): string {
  return process.env.EWE_BIN ?? join(homedir(), '.local', 'share', 'ewe', 'bin')
}

function toolPath(tool: string): string | null {
  const local = join(eweBinDir(), tool)
  if (existsSync(local)) return local
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir !== '' && existsSync(join(dir, tool))) return join(dir, tool)
  }
  return null
}

export function runTool(tool: string, args: string[], timeout = 4000): Promise<string | null> {
  const path = toolPath(tool)
  if (path === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(path, args, { timeout, encoding: 'utf8' }, (error, stdout) => {
      resolve(error === null ? stdout : null)
    })
  })
}

export function parseCloudStatus(text: string | null): CloudStatus | null {
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    return {
      configured: p.configured === true,
      mounted: p.mounted === true,
      path: typeof p.path === 'string' && p.path.startsWith('/') ? p.path : undefined,
    }
  } catch {
    return null
  }
}

export function systemPlacesEnv(): PlacesEnv {
  const home = homedir()
  return {
    home,
    user: userInfo().username,
    uid: process.getuid?.() ?? 1000,
    configHome: process.env.XDG_CONFIG_HOME ?? join(home, '.config'),
    dataHome: process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'),
    readText: (path) => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },
    listDirs: (path) => {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      } catch {
        return []
      }
    },
    isDir: (path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    },
    mounts: () => {
      try {
        return readFileSync('/proc/mounts', 'utf8')
      } catch {
        return ''
      }
    },
    status: async (tool) => parseCloudStatus(await runTool(tool, ['status'])),
  }
}
