import { EventEmitter } from 'node:events'
import { basename, extname, join } from 'node:path'
import { isRemoteId, type DownloadEntry, type DownloadStatus } from '@ewe/shared'
import { readJson, throttle, writeJsonAtomic } from './json-file'

const MAX_ENTRIES = 200
const STATUSES = new Set<string>(['progressing', 'paused', 'completed', 'cancelled', 'interrupted'])

interface DownloadsFile {
  version: 1
  entries: DownloadEntry[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isDownloadEntry(value: unknown): value is DownloadEntry {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.url === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.path === 'string' &&
    typeof value.mime === 'string' &&
    isNumber(value.received) &&
    isNumber(value.total) &&
    isNumber(value.speed) &&
    typeof value.status === 'string' &&
    STATUSES.has(value.status) &&
    isNumber(value.started) &&
    (value.ended === null || isNumber(value.ended)) &&
    (value.via === undefined || isRemoteId(value.via))
  )
}

export function isDownloadsFile(value: unknown): value is DownloadsFile {
  return (
    isObject(value) &&
    value.version === 1 &&
    Array.isArray(value.entries) &&
    value.entries.every(isDownloadEntry)
  )
}

export function isActive(status: DownloadStatus): boolean {
  return status === 'progressing' || status === 'paused'
}

export function restoredEntry(entry: DownloadEntry, now: number): DownloadEntry {
  if (!isActive(entry.status)) return { ...entry, speed: 0 }
  return { ...entry, status: 'interrupted', speed: 0, ended: entry.ended ?? now }
}

export function safeFilename(name: string): string {
  const cleaned = basename(name.replace(/[\\/]/g, '_'))
    .replace(/\p{Cc}/gu, '')
    .trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'download'
  return cleaned.slice(0, 200)
}

export function uniquePath(dir: string, name: string, taken: (path: string) => boolean): string {
  const file = safeFilename(name)
  const ext = extname(file)
  const stem = ext === '' ? file : file.slice(0, -ext.length)
  let candidate = join(dir, file)
  for (let n = 1; taken(candidate) && n < 10_000; n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

export class DownloadsStore extends EventEmitter<{ change: [DownloadEntry[]] }> {
  private readonly path: string
  private entries: DownloadEntry[] = []
  // throttled, not debounced: once a second WHILE a download runs, since
  // ewe's dock draws its progress ring from this file (a public contract —
  // keep the path and the fields; ewe-map "Storage Map")
  // A failed write is retried by the next change and reported by flush();
  // it must not surface as an unhandled rejection (the first write of a
  // burst now goes out at once, while a test may be removing its folder).
  private readonly write = throttle(() => {
    writeJsonAtomic(this.path, this.toFile()).catch(() => undefined)
  }, 1000)

  constructor(userData: string) {
    super()
    this.path = join(userData, 'downloads.json')
  }

  async load(now = Date.now()): Promise<void> {
    const file = await readJson(this.path, isDownloadsFile)
    if (file === null) return
    this.entries = file.entries.slice(0, MAX_ENTRIES).map((e) => restoredEntry(e, now))
  }

  list(): DownloadEntry[] {
    return this.entries
  }

  get(id: string): DownloadEntry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  hasActivePath(path: string): boolean {
    return this.entries.some((e) => e.path === path && isActive(e.status))
  }

  add(entry: DownloadEntry): void {
    this.entries = [entry, ...this.entries.filter((e) => e.id !== entry.id)].slice(0, MAX_ENTRIES)
    this.changed()
  }

  update(id: string, patch: Partial<Omit<DownloadEntry, 'id'>>): DownloadEntry | undefined {
    const index = this.entries.findIndex((e) => e.id === id)
    const current = this.entries[index]
    if (current === undefined) return undefined
    const next = { ...current, ...patch }
    this.entries = this.entries.with(index, next)
    this.changed()
    return next
  }

  remove(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    if (this.entries.length === before) return false
    this.changed()
    return true
  }

  clearFinished(): void {
    const kept = this.entries.filter((e) => isActive(e.status))
    if (kept.length === this.entries.length) return
    this.entries = kept
    this.changed()
  }

  clearRange(from: number, to: number): number {
    const kept = this.entries.filter(
      (e) => isActive(e.status) || e.started < from || e.started > to,
    )
    const removed = this.entries.length - kept.length
    if (removed === 0) return 0
    this.entries = kept
    this.changed()
    return removed
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.toFile())
  }

  private changed(): void {
    this.write()
    this.emit('change', this.entries)
  }

  private toFile(): DownloadsFile {
    return { version: 1, entries: this.entries }
  }
}
