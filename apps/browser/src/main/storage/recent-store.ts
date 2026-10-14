import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { recentKindOf } from '@ewe/shared'
import { debounce, readJson, writeJsonAtomic } from './json-file'

const MAX_ENTRIES = 300
const MAX_HIDDEN = 500

export type RecordSource = 'opened' | 'played'

export interface RecentRecord {
  path: string
  time: number
  source: RecordSource
  count: number
}

interface HiddenKey {
  key: string
  time: number
}

interface RecentFile {
  version: 1
  entries: RecentRecord[]
  hidden: HiddenKey[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is RecentRecord {
  return (
    isObject(value) &&
    typeof value.path === 'string' &&
    value.path.startsWith('/') &&
    isTime(value.time) &&
    (value.source === 'opened' || value.source === 'played') &&
    isTime(value.count)
  )
}

function isHidden(value: unknown): value is HiddenKey {
  return isObject(value) && typeof value.key === 'string' && isTime(value.time)
}

export function isRecentFile(value: unknown): value is RecentFile {
  return (
    isObject(value) &&
    value.version === 1 &&
    Array.isArray(value.entries) &&
    value.entries.every(isRecord) &&
    Array.isArray(value.hidden) &&
    value.hidden.every(isHidden)
  )
}

function newest<T extends { time: number }>(items: Iterable<T>, max: number): T[] {
  return [...items].sort((a, b) => b.time - a.time).slice(0, max)
}

export class RecentStore extends EventEmitter<{ change: [] }> {
  private readonly path: string
  private readonly entries = new Map<string, RecentRecord>()
  private readonly hiddenKeys = new Map<string, number>()
  private readonly write = debounce(() => {
    void writeJsonAtomic(this.path, this.toFile())
  }, 1000)

  constructor(userData: string) {
    super()
    this.path = join(userData, 'recent.json')
  }

  async load(): Promise<void> {
    const file = await readJson(this.path, isRecentFile)
    if (file === null) return
    for (const entry of newest(file.entries, MAX_ENTRIES)) this.entries.set(entry.path, entry)
    for (const h of newest(file.hidden, MAX_HIDDEN)) this.hiddenKeys.set(h.key, h.time)
  }

  record(path: string, source: RecordSource, now = Date.now()): boolean {
    if (!path.startsWith('/') || recentKindOf(path) === null) return false
    const existing = this.entries.get(path)
    if (existing === undefined) this.entries.set(path, { path, time: now, source, count: 1 })
    else {
      existing.time = now
      existing.source = source
      existing.count += 1
    }
    if (this.entries.size > MAX_ENTRIES) {
      const keep = new Set(newest(this.entries.values(), MAX_ENTRIES).map((e) => e.path))
      for (const key of this.entries.keys()) if (!keep.has(key)) this.entries.delete(key)
    }
    this.write()
    this.emit('change')
    return true
  }

  forget(key: string, now = Date.now()): void {
    this.entries.delete(key)
    this.hiddenKeys.set(key, now)
    if (this.hiddenKeys.size > MAX_HIDDEN) {
      const oldest = [...this.hiddenKeys.entries()].sort((a, b) => a[1] - b[1])[0]
      if (oldest !== undefined) this.hiddenKeys.delete(oldest[0])
    }
    this.write()
    this.emit('change')
  }

  list(): RecentRecord[] {
    return [...this.entries.values()].map((e) => ({ ...e }))
  }

  hidden(): ReadonlyMap<string, number> {
    return this.hiddenKeys
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.toFile())
  }

  private toFile(): RecentFile {
    return {
      version: 1,
      entries: [...this.entries.values()],
      hidden: [...this.hiddenKeys.entries()].map(([key, time]) => ({ key, time })),
    }
  }
}
