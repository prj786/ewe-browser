import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import {
  access,
  constants,
  cp,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  statfs,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { nativeImage, shell, type WebContents } from 'electron'
import {
  IPC,
  type FsClipboard,
  type FsEntry,
  type FsListing,
  type FsRequest,
  type FsResult,
} from '@ewe/shared'
import { uniquePath } from '../storage/downloads-store'
import { compressPaths, extractArchive, listArchive } from './archive'
import { computePlaces, runTool, systemPlacesEnv } from './places'

const WATCH_DEBOUNCE_MS = 200
const STAT_BATCH = 256
const TERMINALS = [
  'kitty',
  'foot',
  'alacritty',
  'wezterm',
  'ghostty',
  'gnome-terminal',
  'konsole',
  'xterm',
]
const CP_OPTIONS = {
  recursive: true,
  errorOnExist: true,
  force: false,
  preserveTimestamps: true,
} as const

interface Watch {
  path: string
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

export function expandPath(input: string, home = homedir()): string {
  const expanded =
    input === '~' ? home : input.startsWith('~/') ? join(home, input.slice(2)) : input
  return resolve('/', expanded)
}

export function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)
}

export function errorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  switch (code) {
    case 'ENOENT':
      return 'It no longer exists'
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied'
    case 'ENOTDIR':
      return 'Not a folder'
    case 'EEXIST':
      return 'Something with that name already exists'
    case 'ENOSPC':
      return 'The disk is full'
    case 'EROFS':
      return 'This location is read-only'
    case 'ENOTEMPTY':
      return 'The folder is not empty'
    default:
      return error instanceof Error ? error.message : 'Something went wrong'
  }
}

function ok<T>(value: T): FsResult<T> {
  return { ok: true, value }
}

function fail(error: unknown): FsResult<never> {
  return { ok: false, error: typeof error === 'string' ? error : errorMessage(error) }
}

async function entryFor(dir: string, name: string): Promise<FsEntry | null> {
  const path = join(dir, name)
  try {
    const info = await lstat(path)
    let isDir = info.isDirectory()
    let size = info.size
    let target: string | null = null
    if (info.isSymbolicLink()) {
      try {
        const real = await stat(path)
        isDir = real.isDirectory()
        size = real.size
      } catch {
        target = 'broken'
      }
    }
    return {
      name,
      path,
      kind: info.isSymbolicLink() ? 'link' : isDir ? 'dir' : info.isFile() ? 'file' : 'other',
      dir: isDir,
      size,
      mtime: info.mtimeMs,
      hidden: name.startsWith('.'),
      target,
    }
  } catch {
    return null
  }
}

export async function listDirectory(path: string, hidden: boolean): Promise<FsListing> {
  const names = (await readdir(path)).filter((n) => hidden || !n.startsWith('.'))
  const entries: FsEntry[] = []
  for (let i = 0; i < names.length; i += STAT_BATCH) {
    const batch = await Promise.all(names.slice(i, i + STAT_BATCH).map((n) => entryFor(path, n)))
    for (const e of batch) if (e !== null) entries.push(e)
  }
  let writable = true
  try {
    await access(path, constants.W_OK)
  } catch {
    writable = false
  }
  const free = await statfs(path).then(
    (info) => info.bavail * info.bsize,
    () => null,
  )
  return { path, parent: path === '/' ? null : dirname(path), entries, writable, free }
}

export async function transfer(
  paths: string[],
  dir: string,
  mode: 'copy' | 'move',
): Promise<string[]> {
  const target = await stat(dir)
  if (!target.isDirectory()) throw Object.assign(new Error('Not a folder'), { code: 'ENOTDIR' })
  const done: string[] = []
  for (const src of paths) {
    if (mode === 'move' && dirname(src) === dir) continue
    if (isInside(dir, src)) throw new Error(`Cannot put ${basename(src)} inside itself`)
    const dest = uniquePath(dir, basename(src), (p) => existsSync(p))
    if (mode === 'copy') await cp(src, dest, CP_OPTIONS)
    else {
      try {
        await rename(src, dest)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        await cp(src, dest, CP_OPTIONS)
        await rm(src, { recursive: true, force: true })
      }
    }
    done.push(dest)
  }
  return done
}

export function openWithDefault(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('gio', ['open', path], { timeout: 10_000 }, (error) => {
      if (error === null) {
        resolve(true)
        return
      }
      void shell.openPath(path).then((message) => resolve(message === ''))
    })
  })
}

export async function playInMpv(path: string): Promise<boolean> {
  const child = spawn('mpv', ['--force-window=immediate', '--', path], {
    detached: true,
    stdio: 'ignore',
  })
  const started = await new Promise<boolean>((resolve) => {
    child.once('error', () => resolve(false))
    child.once('spawn', () => resolve(true))
  })
  child.unref()
  return started
}

function dragIcon(): Electron.NativeImage {
  const size = 32
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 4; y < 28; y++)
    for (let x = 7; x < 25; x++) {
      const i = (y * size + x) * 4
      pixels[i] = 190
      pixels[i + 1] = 196
      pixels[i + 2] = 200
      pixels[i + 3] = 255
    }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size })
}

export interface FileServiceHost {
  trashDir?: string | undefined
  onOpened?: ((path: string) => void) | undefined
}

export class FileService {
  readonly token = randomBytes(16).toString('hex')
  private clipboard: FsClipboard = null
  private readonly watches = new Map<number, Watch>()
  private readonly host: FileServiceHost

  constructor(host: FileServiceHost = {}) {
    this.host = host
  }

  async handle(request: FsRequest, sender: WebContents): Promise<FsResult> {
    try {
      switch (request.op) {
        case 'list':
          return ok(await listDirectory(expandPath(request.path), request.hidden))
        case 'places':
          return ok(await computePlaces(systemPlacesEnv()))
        case 'mkdir': {
          const path = join(expandPath(request.dir), request.name)
          await mkdir(path)
          return ok(path)
        }
        case 'rename': {
          const from = expandPath(request.path)
          const to = join(dirname(from), request.name)
          if (from === to) return ok(to)
          if (existsSync(to)) return fail('Something with that name already exists')
          await rename(from, to)
          return ok(to)
        }
        case 'trash':
          return ok(await this.trash(request.paths.map((p) => expandPath(p))))
        case 'copy':
        case 'move': {
          const done = await transfer(
            request.paths.map((p) => expandPath(p)),
            expandPath(request.dir),
            request.op,
          )
          if (request.op === 'move' && this.clipboard?.mode === 'cut') this.clipboard = null
          return ok(done)
        }
        case 'open': {
          const path = expandPath(request.path)
          if (!(await openWithDefault(path))) return fail('No app opens this kind of file')
          this.host.onOpened?.(path)
          return ok(true)
        }
        case 'recent':
          this.host.onOpened?.(expandPath(request.path))
          return ok(true)
        case 'archive.list':
          return ok(await listArchive(expandPath(request.path)))
        case 'extract':
          return ok(await extractArchive(expandPath(request.path)))
        case 'compress':
          return ok(
            await compressPaths(
              request.paths.map((p) => expandPath(p)),
              request.format,
            ),
          )
        case 'terminal':
          return this.terminal(expandPath(request.path))
        case 'mpv': {
          const path = expandPath(request.path)
          if (!(await playInMpv(path))) return fail('mpv is not installed')
          this.host.onOpened?.(path)
          return ok(true)
        }
        case 'mount': {
          const tool = request.target === 'nextcloud' ? 'ewe-files' : 'ewe-drive'
          const out = await runTool(tool, ['mount'], 30_000)
          if (out === null) return fail('Could not connect')
          return ok(await computePlaces(systemPlacesEnv()))
        }
        case 'watch':
          this.watch(sender, request.path === null ? null : expandPath(request.path))
          return ok(true)
        case 'token':
          return ok(this.token)
        case 'clipboard.set':
          this.clipboard = request.clipboard
          return ok(true)
        case 'clipboard.get':
          return ok(this.clipboard)
        case 'drag': {
          const files = request.paths.map((p) => expandPath(p))
          sender.startDrag({ file: files[0] ?? '', files, icon: dragIcon() })
          return ok(true)
        }
      }
    } catch (error) {
      return fail(error)
    }
  }

  private async trash(paths: string[]): Promise<number> {
    const dir = this.host.trashDir
    if (dir !== undefined) {
      await mkdir(dir, { recursive: true })
      await transfer(paths, dir, 'move')
      return paths.length
    }
    for (const path of paths) await shell.trashItem(path)
    return paths.length
  }

  private terminal(cwd: string): FsResult {
    const preferred = process.env.TERMINAL
    const candidates = preferred === undefined ? TERMINALS : [preferred, ...TERMINALS]
    const dirs = (process.env.PATH ?? '').split(':').filter((d) => d !== '')
    for (const name of candidates) {
      const dir = dirs.find((d) => existsSync(join(d, name)))
      if (dir === undefined) continue
      const child = spawn(join(dir, name), [], { cwd, detached: true, stdio: 'ignore' })
      child.on('error', () => undefined)
      child.unref()
      return ok(name)
    }
    return fail('No terminal found')
  }

  private watch(sender: WebContents, path: string | null): void {
    const id = sender.id
    const current = this.watches.get(id)
    if (current?.path === path) return
    if (current !== undefined) {
      current.watcher.close()
      if (current.timer !== null) clearTimeout(current.timer)
      this.watches.delete(id)
    }
    if (path === null || sender.isDestroyed()) return
    try {
      const entry: Watch = { path, timer: null, watcher: watch(path) }
      entry.watcher.on('change', () => {
        if (entry.timer !== null) clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          entry.timer = null
          if (!sender.isDestroyed()) sender.send(IPC.fsChanged, path)
        }, WATCH_DEBOUNCE_MS)
      })
      entry.watcher.on('error', () => this.watch(sender, null))
      this.watches.set(id, entry)
      if (current === undefined) sender.once('destroyed', () => this.watch(sender, null))
    } catch {
      return
    }
  }

  dispose(): void {
    for (const w of this.watches.values()) {
      w.watcher.close()
      if (w.timer !== null) clearTimeout(w.timer)
    }
    this.watches.clear()
  }
}
