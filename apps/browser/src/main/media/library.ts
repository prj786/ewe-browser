import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileKind, type MusicLibrary, type Track } from '@ewe/shared'
import { parseFile } from 'music-metadata'
import { debounce, readJson, writeJsonAtomic } from '../storage/json-file'

const MAX_DEPTH = 12
const MAX_TRACKS = 50_000
const JOBS = 4
const FOLDER_COVERS = [
  'cover.jpg',
  'cover.png',
  'folder.jpg',
  'folder.png',
  'front.jpg',
  'album.jpg',
]

interface IndexFile {
  version: 1
  tracks: Track[]
}

function isTrack(value: unknown): value is Track {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    typeof t.path === 'string' &&
    typeof t.mtime === 'number' &&
    typeof t.title === 'string' &&
    typeof t.artist === 'string' &&
    typeof t.album === 'string'
  )
}

function isIndexFile(value: unknown): value is IndexFile {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Record<string, unknown>
  return f.version === 1 && Array.isArray(f.tracks) && f.tracks.every(isTrack)
}

export function titleFromName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return stem.replace(/^\d{1,3}[\s._-]+/, '').trim() || stem
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_TRACKS) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const path = join(dir, e.name)
    if (e.isDirectory()) await walk(path, depth + 1, out)
    else if (e.isFile() && fileKind({ name: e.name, dir: false }) === 'audio') out.push(path)
  }
}

async function readTrack(path: string, mtime: number, size: number): Promise<Track> {
  const fallback: Track = {
    path,
    mtime,
    size,
    title: titleFromName(path),
    artist: '',
    album: '',
    albumArtist: '',
    track: null,
    disc: null,
    year: null,
    duration: null,
    genre: '',
    cover: false,
  }
  try {
    const meta = await parseFile(path, { duration: true, skipCovers: false })
    const c = meta.common
    const folderCover = FOLDER_COVERS.some((n) => existsSync(join(dirname(path), n)))
    return {
      ...fallback,
      title: c.title === undefined || c.title.trim() === '' ? fallback.title : c.title.trim(),
      artist: c.artist?.trim() ?? '',
      album: c.album?.trim() ?? '',
      albumArtist: c.albumartist?.trim() ?? '',
      track: c.track.no ?? null,
      disc: c.disk.no ?? null,
      year: c.year ?? null,
      duration: meta.format.duration ?? null,
      genre: c.genre?.[0] ?? '',
      cover: (c.picture?.length ?? 0) > 0 || folderCover,
    }
  } catch {
    return fallback
  }
}

export function musicRoots(): string[] {
  const override = process.env.EWE_MUSIC_DIR
  if (override !== undefined) return [override]
  const home = homedir()
  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  try {
    const text = readFileSync(join(config, 'user-dirs.dirs'), 'utf8')
    const dir = /^XDG_MUSIC_DIR="(.*)"$/m.exec(text)?.[1]
    if (dir !== undefined) return [dir.replace(/^\$HOME/, home)]
  } catch {
    return [join(home, 'Music')]
  }
  return [join(home, 'Music')]
}

export class MusicLibraryStore extends EventEmitter<{ change: [MusicLibrary] }> {
  private readonly path: string
  private readonly roots: string[]
  private tracks: Track[] = []
  private scanning: Promise<void> | null = null
  private scannedAt: number | null = null
  private readonly write = debounce(() => {
    const file: IndexFile = { version: 1, tracks: this.tracks }
    void writeJsonAtomic(this.path, file)
  }, 1000)

  constructor(userData: string, roots = musicRoots()) {
    super()
    this.path = join(userData, 'music-index.json')
    this.roots = roots
  }

  async load(): Promise<void> {
    const file = await readJson(this.path, isIndexFile)
    if (file !== null) this.tracks = file.tracks
  }

  snapshot(): MusicLibrary {
    return {
      roots: this.roots,
      tracks: this.tracks,
      scanning: this.scanning !== null,
      scannedAt: this.scannedAt,
    }
  }

  scan(): Promise<void> {
    if (this.scanning !== null) return this.scanning
    this.scanning = this.doScan().finally(() => {
      this.scanning = null
      this.scannedAt = Date.now()
      this.emit('change', this.snapshot())
    })
    this.emit('change', this.snapshot())
    return this.scanning
  }

  private async doScan(): Promise<void> {
    const paths: string[] = []
    for (const root of this.roots) await walk(root, 0, paths)
    const known = new Map(this.tracks.map((t) => [t.path, t]))
    const next: Track[] = []
    let i = 0
    const worker = async () => {
      while (i < paths.length) {
        const path = paths[i++]
        if (path === undefined) break
        try {
          const info = await stat(path)
          const old = known.get(path)
          next.push(
            old?.mtime === info.mtimeMs && old.size === info.size
              ? old
              : await readTrack(path, info.mtimeMs, info.size),
          )
        } catch {
          continue
        }
      }
    }
    await Promise.all(Array.from({ length: JOBS }, worker))
    this.tracks = next
    this.write()
  }

  flush(): void {
    this.write.flush()
  }
}

function coverCache(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ewe-browser', 'covers')
}

function sniff(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0x52 && data[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

function imageResponse(data: Uint8Array): Response {
  return new Response(new Uint8Array(data), {
    headers: { 'content-type': sniff(data), 'cache-control': 'max-age=600' },
  })
}

async function cachedCover(cached: string, notBefore: number): Promise<Uint8Array | null> {
  try {
    const info = await stat(cached)
    if (info.mtimeMs < notBefore) return null
    return new Uint8Array(await readFile(cached))
  } catch {
    return null
  }
}

async function embeddedCover(path: string): Promise<Uint8Array | null> {
  try {
    const meta = await parseFile(path, { duration: false, skipCovers: false })
    return meta.common.picture?.[0]?.data ?? null
  } catch {
    return null
  }
}

export async function coverResponse(path: string): Promise<Response> {
  let info
  try {
    info = await stat(path)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const cached = join(coverCache(), `${createHash('md5').update(path).digest('hex')}.img`)
  const hit = await cachedCover(cached, info.mtimeMs)
  if (hit !== null) return imageResponse(hit)
  let data = await embeddedCover(path)
  if (data === null) {
    const folder = FOLDER_COVERS.map((n) => join(dirname(path), n)).find((p) => existsSync(p))
    if (folder !== undefined) data = new Uint8Array(await readFile(folder))
  }
  if (data === null) return new Response('No cover', { status: 404 })
  await mkdir(coverCache(), { recursive: true })
  await writeFile(cached, data).catch(() => undefined)
  return imageResponse(data)
}
