import { FILES_PAGE_URL } from './models'

export type FsEntryKind = 'dir' | 'file' | 'link' | 'other'

export interface FsEntry {
  name: string
  path: string
  kind: FsEntryKind
  dir: boolean
  size: number
  mtime: number
  hidden: boolean
  target: string | null
}

export interface FsListing {
  path: string
  parent: string | null
  entries: FsEntry[]
  writable: boolean
  free: number | null
}

export type FsPlaceGroup = 'places' | 'cloud' | 'bookmarks' | 'devices' | 'other'
export type FsPlaceState = 'ready' | 'offline' | 'setup'
export type FsPlaceIcon =
  | 'house'
  | 'folder'
  | 'download'
  | 'file'
  | 'image'
  | 'music'
  | 'video'
  | 'code'
  | 'cloud'
  | 'drive'
  | 'hard-drive'
  | 'server'
  | 'trash-2'
  | 'monitor'

export interface FsPlace {
  id: string
  label: string
  path: string
  group: FsPlaceGroup
  icon: FsPlaceIcon
  state: FsPlaceState
  mount?: 'nextcloud' | 'drive' | undefined
}

export type ArchiveFormat = 'zip' | 'tar.gz' | 'tar.zst'

export interface ArchiveEntry {
  name: string
  dir: boolean
  size: number
}

export interface ArchiveListing {
  path: string
  count: number
  size: number
  entries: ArchiveEntry[]
  truncated: boolean
  root: string | null
}

export type FsClipboard = { mode: 'copy' | 'cut'; paths: string[] } | null

export type FsRequest =
  | { op: 'list'; path: string; hidden: boolean }
  | { op: 'places' }
  | { op: 'mkdir'; dir: string; name: string }
  | { op: 'rename'; path: string; name: string }
  | { op: 'trash'; paths: string[] }
  | { op: 'copy'; paths: string[]; dir: string }
  | { op: 'move'; paths: string[]; dir: string }
  | { op: 'open'; path: string }
  | { op: 'terminal'; path: string }
  | { op: 'mount'; target: 'nextcloud' | 'drive' }
  | { op: 'watch'; path: string | null }
  | { op: 'token' }
  | { op: 'clipboard.set'; clipboard: FsClipboard }
  | { op: 'clipboard.get' }
  | { op: 'drag'; paths: string[] }
  | { op: 'archive.list'; path: string }
  | { op: 'extract'; path: string }
  | { op: 'compress'; paths: string[]; format: ArchiveFormat }
  | { op: 'mpv'; path: string }

export type FsResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string }

const MAX_PATH = 4096
const MAX_PATHS = 10_000

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH
}

function isPaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_PATHS && value.every(isPath)
}

export function isFileName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    !value.includes('/') &&
    !value.includes('\0') &&
    value !== '.' &&
    value !== '..'
  )
}

function isClipboard(value: unknown): value is FsClipboard {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (c.mode === 'copy' || c.mode === 'cut') && isPaths(c.paths)
}

export function isFsRequest(value: unknown): value is FsRequest {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  switch (r.op) {
    case 'list':
      return isPath(r.path) && typeof r.hidden === 'boolean'
    case 'places':
    case 'token':
    case 'clipboard.get':
      return true
    case 'mkdir':
      return isPath(r.dir) && isFileName(r.name)
    case 'rename':
      return isPath(r.path) && isFileName(r.name)
    case 'trash':
    case 'drag':
      return isPaths(r.paths) && r.paths.length > 0
    case 'copy':
    case 'move':
      return isPaths(r.paths) && r.paths.length > 0 && isPath(r.dir)
    case 'open':
    case 'terminal':
    case 'archive.list':
    case 'extract':
    case 'mpv':
      return isPath(r.path)
    case 'mount':
      return r.target === 'nextcloud' || r.target === 'drive'
    case 'watch':
      return r.path === null || isPath(r.path)
    case 'compress':
      return (
        isPaths(r.paths) &&
        r.paths.length > 0 &&
        (r.format === 'zip' || r.format === 'tar.gz' || r.format === 'tar.zst')
      )
    case 'clipboard.set':
      return isClipboard(r.clipboard)
    default:
      return false
  }
}

export function filesUrl(path: string, select?: string): string {
  const params = new URLSearchParams({ path })
  if (select !== undefined) params.set('select', select)
  return `${FILES_PAGE_URL}?${params.toString()}`
}

export function pathFromFilesUrl(url: string): string | null {
  if (!url.startsWith(FILES_PAGE_URL)) return null
  try {
    return new URL(url).searchParams.get('path')
  } catch {
    return null
  }
}

export function isLocalPathInput(input: string): boolean {
  return input === '~' || input.startsWith('~/') || /^\/(?!\/)/.test(input)
}

export function tildePath(path: string, home: string): string {
  if (home === '' || home === '/') return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export type FileKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'code'
  | 'archive'
  | 'document'
  | 'sheet'
  | 'slides'
  | 'font'
  | 'disk'
  | 'executable'
  | 'package'
  | 'other'

const KINDS: Record<string, FileKind> = {}
function register(kind: FileKind, exts: string): void {
  for (const ext of exts.split(' ')) KINDS[ext] = kind
}
register(
  'image',
  'png jpg jpeg gif webp avif bmp svg ico tif tiff heic heif jxl raw cr2 nef psd xcf',
)
register('video', 'mp4 m4v mkv webm mov avi wmv flv mpg mpeg 3gp m2ts ogv')
register('audio', 'mp3 flac ogg oga opus wav m4a aac wma aiff alac mka')
register('pdf', 'pdf')
register('text', 'txt md markdown rst log csv tsv ini conf cfg toml yaml yml nfo srt vtt')
register(
  'code',
  'js mjs cjs ts tsx jsx json html htm css scss less py rb go rs c h cpp hpp cc java kt swift sh bash zsh fish lua qml php sql xml vue svelte nix dart zig',
)
register('archive', 'zip tar gz tgz bz2 xz zst 7z rar lz4 deb rpm pkg apk jar whl')
register('document', 'doc docx odt rtf epub pages')
register('sheet', 'xls xlsx ods numbers')
register('slides', 'ppt pptx odp key')
register('font', 'ttf otf woff woff2')
register('disk', 'iso img qcow2 vdi vmdk dmg')
register('executable', 'exe msi run')
register('package', 'appimage flatpak flatpakref snap')

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function fileKind(entry: Pick<FsEntry, 'name' | 'dir'>): FileKind {
  if (entry.dir) return 'folder'
  return KINDS[extensionOf(entry.name)] ?? 'other'
}

export const MEDIA_KINDS: ReadonlySet<FileKind> = new Set<FileKind>(['image', 'video', 'audio'])

export const VIEWABLE_KINDS: ReadonlySet<FileKind> = new Set<FileKind>([
  'image',
  'video',
  'audio',
  'text',
  'code',
  'pdf',
])

export const THUMBNAIL_KINDS: ReadonlySet<FileKind> = new Set<FileKind>(['image', 'video'])

export type SortKey = 'name' | 'mtime' | 'size' | 'kind'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortEntries(entries: FsEntry[], key: SortKey, descending: boolean): FsEntry[] {
  const sign = descending ? -1 : 1
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    let order = 0
    if (key === 'mtime') order = a.mtime - b.mtime
    else if (key === 'size') order = a.dir ? 0 : a.size - b.size
    else if (key === 'kind') order = collator.compare(fileKind(a), fileKind(b))
    if (order === 0) order = collator.compare(a.name, b.name)
    return order * sign
  })
}

export function filterEntries(entries: FsEntry[], query: string): FsEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return entries
  return entries.filter((e) => e.name.toLowerCase().includes(q))
}

function gvfsParams(spec: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of spec.split(',')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const raw = part.slice(eq + 1)
    try {
      out[part.slice(0, eq)] = decodeURIComponent(raw)
    } catch {
      out[part.slice(0, eq)] = raw
    }
  }
  return out
}

export function gvfsLabel(name: string): { label: string; icon: FsPlaceIcon } {
  const colon = name.indexOf(':')
  if (colon <= 0) return { label: name, icon: 'server' }
  const type = name.slice(0, colon)
  const p = gvfsParams(name.slice(colon + 1))
  const host = p.host ?? p.server ?? ''
  switch (type) {
    case 'google-drive':
      return { label: `Google Drive (${p.user ?? host})`, icon: 'cloud' }
    case 'smb-share':
      return { label: `${p.share ?? 'share'} on ${host}`, icon: 'server' }
    case 'sftp':
    case 'ftp':
      return { label: `${p.user === undefined ? '' : `${p.user}@`}${host}`, icon: 'server' }
    case 'dav':
    case 'davs':
      return { label: host === '' ? 'WebDAV' : host, icon: 'cloud' }
    case 'mtp':
    case 'gphoto2':
      return { label: host.replace(/_/g, ' ') || 'Device', icon: 'drive' }
    default:
      return { label: host === '' ? name : `${host} (${type})`, icon: 'server' }
  }
}
