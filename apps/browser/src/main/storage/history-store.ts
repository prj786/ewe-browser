import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { HistorySuggestion, HistoryVisit } from '@ewe/shared'
import {
  completeHost,
  entryFor,
  rankSuggestions,
  recentEntries,
  type HistoryEntry,
} from '../history'
import { debounce, readJson, writeJsonAtomic } from './json-file'

const MAX_ENTRIES = 20_000

interface HistoryFile {
  version: 1
  entries: HistoryEntry[]
}

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return (
    typeof e.url === 'string' &&
    typeof e.title === 'string' &&
    typeof e.host === 'string' &&
    typeof e.count === 'number' &&
    typeof e.last === 'number'
  )
}

function isHistoryFile(value: unknown): value is HistoryFile {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Record<string, unknown>
  return f.version === 1 && Array.isArray(f.entries) && f.entries.every(isEntry)
}

export function recordable(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export class HistoryStore extends EventEmitter<{ change: [] }> {
  private readonly path: string
  private readonly entries = new Map<string, HistoryEntry>()
  private readonly write = debounce(() => {
    void writeJsonAtomic(this.path, this.toFile())
  }, 2000)

  constructor(userData: string) {
    super()
    this.path = join(userData, 'history.json')
  }

  async load(): Promise<void> {
    const file = await readJson(this.path, isHistoryFile)
    if (file === null) return
    for (const entry of file.entries) this.entries.set(entry.url, entry)
  }

  record(url: string, title: string, now = Date.now()): void {
    if (!recordable(url)) return
    const existing = this.entries.get(url)
    if (existing === undefined) {
      this.entries.set(url, entryFor(url, title, now))
      if (this.entries.size > MAX_ENTRIES) this.prune()
    } else {
      existing.count += 1
      existing.last = now
      if (title !== '') existing.title = title
    }
    this.changed()
  }

  title(url: string, title: string): void {
    const existing = this.entries.get(url)
    if (existing === undefined || title === '' || existing.title === title) return
    existing.title = title
    this.changed()
  }

  list(query: string, limit = 200): HistoryVisit[] {
    return recentEntries(this.entries.values(), query, limit).map((e) => ({ ...e }))
  }

  remove(url: string): boolean {
    if (!this.entries.delete(url)) return false
    this.changed()
    return true
  }

  private changed(): void {
    this.write()
    this.emit('change')
  }

  suggest(query: string, limit = 6): HistorySuggestion[] {
    return rankSuggestions(this.entries.values(), query, limit)
  }

  complete(typed: string): string | null {
    return completeHost(this.entries.values(), typed)
  }

  all(): HistoryEntry[] {
    return [...this.entries.values()]
  }

  replaceAll(entries: HistoryEntry[]): void {
    this.entries.clear()
    for (const entry of entries) if (recordable(entry.url)) this.entries.set(entry.url, entry)
    this.prune()
    this.write()
    this.emit('change')
  }

  size(): number {
    return this.entries.size
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.toFile())
  }

  private prune(): void {
    const sorted = [...this.entries.values()].sort((a, b) => a.last - b.last)
    for (const entry of sorted.slice(0, this.entries.size - MAX_ENTRIES))
      this.entries.delete(entry.url)
  }

  private toFile(): HistoryFile {
    return { version: 1, entries: [...this.entries.values()] }
  }
}
