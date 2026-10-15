import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import {
  hostOf,
  localDay,
  type HistoryClear,
  type HistoryCursor,
  type HistoryDayRow,
  type HistoryRows,
  type HistorySuggestion,
  type HistoryVisit,
} from '@ewe/shared'
import {
  completeHost,
  entryFor,
  rankSuggestions,
  recentEntries,
  type HistoryEntry,
} from '../history'
import { CLEAR_TTL, compactClears, type Records } from '../sync/merge'

export const MAX_ENTRIES = 20_000
export const MAX_VISITS = 200_000
const VISIT_PRUNE_EVERY = 500
const ROW_BATCH = 500

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

export function readLegacy(path: string): { entries: HistoryEntry[]; skipped: number } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const file = parsed as Record<string, unknown>
  if (file.version !== 1 || !Array.isArray(file.entries)) return null
  const entries: HistoryEntry[] = []
  let skipped = 0
  for (const item of file.entries as unknown[]) {
    if (
      isEntry(item) &&
      recordable(item.url) &&
      Number.isFinite(item.count) &&
      Number.isFinite(item.last) &&
      item.last >= 0
    )
      entries.push(item)
    else skipped += 1
  }
  return { entries, skipped }
}

export function recordable(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function letters(word: string): number {
  return word.match(/./gsu)?.length ?? 0
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS urls (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS urls_last ON urls(last);
CREATE INDEX IF NOT EXISTS urls_host ON urls(host);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  url_id INTEGER NOT NULL,
  time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_time ON visits(time, id);
CREATE INDEX IF NOT EXISTS visits_url ON visits(url_id, time);
CREATE TABLE IF NOT EXISTS clears (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  start INTEGER NOT NULL,
  stop INTEGER NOT NULL,
  url TEXT,
  site TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS urls_fts USING fts5(
  title, url, content='urls', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS urls_ai AFTER INSERT ON urls BEGIN
  INSERT INTO urls_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
END;
CREATE TRIGGER IF NOT EXISTS urls_ad AFTER DELETE ON urls BEGIN
  INSERT INTO urls_fts(urls_fts, rowid, title, url) VALUES ('delete', old.id, old.title, old.url);
END;
CREATE TRIGGER IF NOT EXISTS urls_au AFTER UPDATE OF title, url ON urls
WHEN old.title IS NOT new.title OR old.url IS NOT new.url BEGIN
  INSERT INTO urls_fts(urls_fts, rowid, title, url) VALUES ('delete', old.id, old.title, old.url);
  INSERT INTO urls_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
END;
CREATE TEMP TABLE IF NOT EXISTS affected (id INTEGER PRIMARY KEY, url TEXT NOT NULL, n INTEGER NOT NULL);
`

interface VisitFilter {
  from: number
  to: number
  url?: string | undefined
  site?: string | undefined
}

interface UrlRow {
  url: string
  title: string
  host: string
  count: number
  last: number
}

interface ClearRow {
  id: string
  at: number
  start: number
  stop: number
  url: string | null
  site: string | null
}

export class HistoryStore extends EventEmitter<{ change: [] }> {
  private readonly dir: string
  private readonly dbPath: string
  private readonly jsonPath: string
  private readonly entries = new Map<string, HistoryEntry>()
  private db: DatabaseSync | null = null
  private sinceVisitPrune = 0
  private clock: () => number = () => Date.now()

  constructor(userData: string) {
    super()
    this.dir = userData
    this.dbPath = join(userData, 'history.db')
    this.jsonPath = join(userData, 'history.json')
  }

  load(): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    this.db = this.open()
    this.migrate(this.db)
    this.entries.clear()
    const rows = this.db.prepare('SELECT url, title, host, count, last FROM urls').all()
    for (const row of rows as unknown as UrlRow[]) this.entries.set(row.url, { ...row })
    this.prune()
    return Promise.resolve()
  }

  private open(): DatabaseSync {
    try {
      return this.connect()
    } catch (error: unknown) {
      console.error('[ewe] history.db could not be opened, starting a new one', error)
      const stamp = Date.now()
      for (const suffix of ['', '-wal', '-shm']) {
        const path = `${this.dbPath}${suffix}`
        if (existsSync(path)) renameSync(path, `${this.dbPath}.broken-${stamp}${suffix}`)
      }
      return this.connect()
    }
  }

  private connect(): DatabaseSync {
    const db = new DatabaseSync(this.dbPath)
    try {
      db.exec('PRAGMA busy_timeout = 5000')
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
      db.exec(SCHEMA)
      db.prepare('SELECT count(*) AS n FROM urls').get()
      return db
    } catch (error: unknown) {
      db.close()
      throw error
    }
  }

  private migrate(db: DatabaseSync): void {
    if (this.meta(db, 'migrated') !== null) return
    const json = existsSync(this.jsonPath)
    const source = json ? this.jsonPath : `${this.jsonPath}.bak`
    const legacy = readLegacy(source)
    if (legacy !== null)
      console.log(
        `[ewe] history: importing ${legacy.entries.length} pages from ${source}, skipped ${legacy.skipped} malformed`,
      )
    this.transaction(db, () => {
      if (this.meta(db, 'migrated') !== null) return
      const put = db.prepare(
        'INSERT INTO urls (url, title, host, count, last) VALUES (?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING RETURNING id',
      )
      const visit = db.prepare('INSERT INTO visits (url_id, time) VALUES (?, ?)')
      for (const entry of legacy?.entries ?? []) {
        const row = put.get(
          entry.url,
          entry.title,
          hostOf(entry.url),
          Math.max(1, Math.round(entry.count)),
          Math.round(entry.last),
        ) as { id: number } | undefined
        if (row !== undefined) visit.run(row.id, Math.round(entry.last))
      }
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
        'migrated',
        String(legacy?.entries.length ?? 0),
      )
    })
    if (json && existsSync(this.jsonPath)) {
      try {
        renameSync(this.jsonPath, `${this.jsonPath}.bak`)
      } catch (error: unknown) {
        console.error('[ewe] history.json could not be renamed', error)
      }
    }
  }

  private meta(db: DatabaseSync, key: string): string | null {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  private transaction<T>(db: DatabaseSync, fn: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (error: unknown) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  private write<T>(fallback: T, fn: (db: DatabaseSync) => T): T {
    const db = this.db
    if (db === null) return fallback
    try {
      return fn(db)
    } catch (error: unknown) {
      console.error('[ewe] history.db', error)
      return fallback
    }
  }

  private putEntry(db: DatabaseSync, entry: HistoryEntry): number {
    const row = db
      .prepare(
        `INSERT INTO urls (url, title, host, count, last) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET title = excluded.title, host = excluded.host,
         count = excluded.count, last = excluded.last RETURNING id`,
      )
      .get(entry.url, entry.title, entry.host, entry.count, entry.last) as { id: number }
    return row.id
  }

  setClock(clock: () => number): void {
    this.clock = clock
  }

  now(): number {
    return this.clock()
  }

  record(url: string, title: string, now = this.clock()): void {
    if (!recordable(url)) return
    let entry = this.entries.get(url)
    if (entry === undefined) {
      entry = entryFor(url, title, now)
      this.entries.set(url, entry)
    } else {
      entry.count += 1
      entry.last = Math.max(entry.last, now)
      if (title !== '') entry.title = title
    }
    const current = entry
    this.write(undefined, (db) =>
      this.transaction(db, () => {
        const id = this.putEntry(db, current)
        db.prepare('INSERT INTO visits (url_id, time) VALUES (?, ?)').run(id, now)
      }),
    )
    if (this.entries.size > MAX_ENTRIES) this.prune()
    if (++this.sinceVisitPrune >= VISIT_PRUNE_EVERY) {
      this.sinceVisitPrune = 0
      this.pruneVisits()
    }
    this.changed()
  }

  title(url: string, title: string): void {
    const existing = this.entries.get(url)
    if (existing === undefined || title === '' || existing.title === title) return
    existing.title = title
    this.write(undefined, (db) =>
      db.prepare('UPDATE urls SET title = ? WHERE url = ?').run(title, url),
    )
    this.changed()
  }

  list(query: string, limit = 200): HistoryVisit[] {
    return recentEntries(this.entries.values(), query, limit).map((e) => ({ ...e }))
  }

  remove(url: string, now = this.clock()): boolean {
    if (!this.entries.has(url)) return false
    this.clear({ from: 0, to: now, url }, now)
    return true
  }

  clear(filter: VisitFilter, now = this.clock()): number {
    return this.clearMany([filter], now)
  }

  clearMany(filters: VisitFilter[], now = this.clock()): number {
    if (filters.length === 0) return 0
    const touched = new Set<string>()
    this.write(undefined, (db) =>
      this.transaction(db, () => {
        for (const filter of filters) {
          const record: HistoryClear = {
            id: randomUUID(),
            at: now,
            from: Math.max(0, filter.from),
            to: Math.max(Math.max(0, filter.from), Math.min(filter.to, now)),
            ...(filter.url === undefined ? {} : { url: filter.url }),
            ...(filter.site === undefined ? {} : { site: filter.site }),
          }
          for (const url of this.removeVisits(db, record)) touched.add(url)
          this.insertClear(db, record)
        }
        this.pruneClears(db, now)
      }),
    )
    this.changed()
    return touched.size
  }

  applyClears(clears: HistoryClear[], now = this.clock()): boolean {
    let applied = false
    this.write(undefined, (db) =>
      this.transaction(db, () => {
        const known = new Set(
          (db.prepare('SELECT id FROM clears').all() as { id: string }[]).map((r) => r.id),
        )
        for (const clear of clears) {
          if (known.has(clear.id) || clear.at < now - CLEAR_TTL) continue
          known.add(clear.id)
          this.removeVisits(db, clear)
          this.insertClear(db, clear)
          applied = true
        }
        if (applied) this.pruneClears(db, now)
      }),
    )
    if (applied) this.changed()
    return applied
  }

  clears(now = this.clock()): HistoryClear[] {
    return this.write([], (db) => {
      const rows = db
        .prepare('SELECT id, at, start, stop, url, site FROM clears WHERE at >= ? ORDER BY at, id')
        .all(now - CLEAR_TTL) as unknown as ClearRow[]
      return rows.map((r) => ({
        id: r.id,
        at: r.at,
        from: r.start,
        to: r.stop,
        ...(r.url === null ? {} : { url: r.url }),
        ...(r.site === null ? {} : { site: r.site }),
      }))
    })
  }

  enforceRetention(days: number, now = this.clock()): number {
    if (days <= 0) return 0
    const cutoff = now - days * 86_400_000
    const removed = this.write(new Set<string>(), (db) =>
      this.transaction(db, () => this.removeVisits(db, { from: 0, to: cutoff - 1 })),
    )
    if (removed.size > 0) this.changed()
    return removed.size
  }

  private insertClear(db: DatabaseSync, clear: HistoryClear): void {
    db.prepare(
      'INSERT OR IGNORE INTO clears (id, at, start, stop, url, site) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(clear.id, clear.at, clear.from, clear.to, clear.url ?? null, clear.site ?? null)
  }

  private pruneClears(db: DatabaseSync, now: number): void {
    const rows = db
      .prepare('SELECT id, at, start, stop, url, site FROM clears')
      .all() as unknown as ClearRow[]
    const all: HistoryClear[] = rows.map((r) => ({
      id: r.id,
      at: r.at,
      from: r.start,
      to: r.stop,
      ...(r.url === null ? {} : { url: r.url }),
      ...(r.site === null ? {} : { site: r.site }),
    }))
    const kept = new Set(compactClears(all, now).map((c) => c.id))
    const drop = db.prepare('DELETE FROM clears WHERE id = ?')
    for (const clear of all) if (!kept.has(clear.id)) drop.run(clear.id)
  }

  private removeVisits(db: DatabaseSync, filter: VisitFilter): Set<string> {
    const where = ['v.time BETWEEN ? AND ?']
    const params: SQLInputValue[] = [filter.from, filter.to]
    if (filter.url !== undefined) {
      where.push('u.url = ?')
      params.push(filter.url)
    }
    if (filter.site !== undefined) {
      where.push("(u.host = ? OR u.host LIKE ? ESCAPE '\\')")
      params.push(filter.site, `%.${escapeLike(filter.site)}`)
    }
    db.exec('DELETE FROM temp.affected')
    db.prepare(
      `INSERT INTO temp.affected (id, url, n) SELECT u.id, u.url, count(*) FROM visits v
       JOIN urls u ON u.id = v.url_id WHERE ${where.join(' AND ')} GROUP BY u.id`,
    ).run(...params)
    const affected = db.prepare('SELECT url FROM temp.affected').all() as { url: string }[]
    if (affected.length === 0) return new Set()
    db.prepare(
      'DELETE FROM visits WHERE url_id IN (SELECT id FROM temp.affected) AND time BETWEEN ? AND ?',
    ).run(filter.from, filter.to)
    db.exec(`DELETE FROM urls WHERE id IN (SELECT id FROM temp.affected)
      AND NOT EXISTS (SELECT 1 FROM visits WHERE visits.url_id = urls.id)`)
    db.exec(`UPDATE urls SET
      last = (SELECT max(time) FROM visits WHERE visits.url_id = urls.id),
      count = max(
        (SELECT count(*) FROM visits WHERE visits.url_id = urls.id),
        count - (SELECT n FROM temp.affected WHERE temp.affected.id = urls.id)
      )
      WHERE id IN (SELECT id FROM temp.affected)`)
    const left = db
      .prepare(
        'SELECT u.url, u.count, u.last FROM urls u WHERE u.id IN (SELECT id FROM temp.affected)',
      )
      .all() as { url: string; count: number; last: number }[]
    const remaining = new Map(left.map((r) => [r.url, r]))
    const touched = new Set<string>()
    for (const { url } of affected) {
      touched.add(url)
      const row = remaining.get(url)
      const entry = this.entries.get(url)
      if (row === undefined) this.entries.delete(url)
      else if (entry !== undefined) {
        entry.count = row.count
        entry.last = row.last
      }
    }
    db.exec('DELETE FROM temp.affected')
    return touched
  }

  rows(
    query: string,
    options: { site?: string | undefined; before?: HistoryCursor | undefined; limit?: number } = {},
  ): HistoryRows {
    const limit = options.limit ?? 100
    return this.write<HistoryRows>({ rows: [], next: null }, (db) => {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w !== '')
      const where: string[] = []
      const params: SQLInputValue[] = []
      const long = words.filter((w) => letters(w) >= 3)
      if (long.length > 0) {
        where.push('v.url_id IN (SELECT rowid FROM urls_fts WHERE urls_fts MATCH ?)')
        params.push(long.map((w) => `"${w.replace(/"/g, '""')}"`).join(' '))
      }
      for (const word of words.filter((w) => letters(w) < 3)) {
        where.push("(lower(u.title) LIKE ? ESCAPE '\\' OR lower(u.url) LIKE ? ESCAPE '\\')")
        const pattern = `%${escapeLike(word)}%`
        params.push(pattern, pattern)
      }
      if (options.site !== undefined) {
        where.push("(u.host = ? OR u.host LIKE ? ESCAPE '\\')")
        params.push(options.site, `%.${escapeLike(options.site)}`)
      }
      const statement = db.prepare(
        `SELECT v.id AS vid, v.time AS time, u.url AS url, u.title AS title, u.host AS host
         FROM visits v JOIN urls u ON u.id = v.url_id
         WHERE (v.time < ? OR (v.time = ? AND v.id < ?))${where.length > 0 ? ` AND ${where.join(' AND ')}` : ''}
         ORDER BY v.time DESC, v.id DESC LIMIT ?`,
      )
      const rows = new Map<string, HistoryDayRow>()
      let cursor: HistoryCursor = options.before ?? {
        time: Number.MAX_SAFE_INTEGER,
        id: Number.MAX_SAFE_INTEGER,
      }
      for (;;) {
        const batch = statement.all(cursor.time, cursor.time, cursor.id, ...params, ROW_BATCH) as {
          vid: number
          time: number
          url: string
          title: string
          host: string
        }[]
        for (const visit of batch) {
          const day = localDay(visit.time)
          const key = `${day}\n${visit.url}`
          const row = rows.get(key)
          if (row !== undefined) row.visits += 1
          else if (rows.size >= limit) return { rows: [...rows.values()], next: cursor }
          else
            rows.set(key, {
              url: visit.url,
              title: visit.title,
              host: visit.host,
              day,
              last: visit.time,
              visits: 1,
            })
          cursor = { time: visit.time, id: visit.vid }
        }
        if (batch.length < ROW_BATCH) return { rows: [...rows.values()], next: null }
      }
    })
  }

  siteCount(site: string): number {
    return this.siteHosts(site).reduce((n, h) => n + h.pages, 0)
  }

  siteHosts(site: string): { host: string; pages: number }[] {
    return this.write(
      [],
      (db) =>
        db
          .prepare(
            `SELECT host, count(*) AS pages FROM urls WHERE host = ? OR host LIKE ? ESCAPE '\\'
           GROUP BY host ORDER BY pages DESC`,
          )
          .all(site, `%.${escapeLike(site)}`) as unknown as { host: string; pages: number }[],
    )
  }

  applyMerged(records: Records<HistoryEntry>, scope: Iterable<string>): void {
    let changed = false
    this.write(undefined, (db) =>
      this.transaction(db, () => {
        const visit = db.prepare('INSERT INTO visits (url_id, time) VALUES (?, ?)')
        const dropVisits = db.prepare(
          'DELETE FROM visits WHERE url_id = (SELECT id FROM urls WHERE url = ?)',
        )
        const dropUrl = db.prepare('DELETE FROM urls WHERE url = ?')
        for (const url of scope) {
          if (Object.hasOwn(records, url) || !this.entries.has(url)) continue
          dropVisits.run(url)
          dropUrl.run(url)
          this.entries.delete(url)
          changed = true
        }
        for (const [url, record] of Object.entries(records)) {
          if (!recordable(url) || !Number.isFinite(record.last)) continue
          const local = this.entries.get(url)
          const count = Math.max(1, Math.round(record.count))
          const remoteLast = Math.round(record.last)
          if (local === undefined) {
            const entry: HistoryEntry = {
              url,
              title: record.title,
              host: hostOf(url),
              count,
              last: remoteLast,
            }
            visit.run(this.putEntry(db, entry), remoteLast)
            this.entries.set(url, entry)
            changed = true
            continue
          }
          if (local.title === record.title && local.count === count && local.last >= remoteLast)
            continue
          const newer = remoteLast > local.last
          local.title = record.title
          local.count = count
          local.last = Math.max(local.last, remoteLast)
          const id = this.putEntry(db, local)
          if (newer) visit.run(id, remoteLast)
          changed = true
        }
      }),
    )
    if (this.entries.size > MAX_ENTRIES) this.prune()
    if (changed) this.changed()
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
    const records: Records<HistoryEntry> = {}
    for (const entry of entries) records[entry.url] = entry
    this.applyMerged(records, [...this.entries.keys()])
  }

  size(): number {
    return this.entries.size
  }

  visitCount(): number {
    return this.write(0, (db) => {
      const row = db.prepare('SELECT count(*) AS n FROM visits').get() as { n: number }
      return row.n
    })
  }

  flush(): Promise<void> {
    this.write(undefined, (db) => db.exec('PRAGMA wal_checkpoint(PASSIVE)'))
    return Promise.resolve()
  }

  isOpen(): boolean {
    return this.db !== null
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private changed(): void {
    this.emit('change')
  }

  private prune(): void {
    const extra = this.entries.size - MAX_ENTRIES
    if (extra <= 0) return
    this.write(undefined, (db) =>
      this.transaction(db, () => {
        const oldest = db
          .prepare('SELECT id, url FROM urls ORDER BY last ASC, id ASC LIMIT ?')
          .all(extra) as { id: number; url: string }[]
        const dropVisits = db.prepare('DELETE FROM visits WHERE url_id = ?')
        const dropUrl = db.prepare('DELETE FROM urls WHERE id = ?')
        for (const row of oldest) {
          dropVisits.run(row.id)
          dropUrl.run(row.id)
          this.entries.delete(row.url)
        }
      }),
    )
  }

  private pruneVisits(): void {
    this.write(undefined, (db) => {
      const { n } = db.prepare('SELECT count(*) AS n FROM visits').get() as { n: number }
      if (n <= MAX_VISITS) return
      db.prepare(
        `DELETE FROM visits WHERE id IN (SELECT v.id FROM visits v JOIN urls u ON u.id = v.url_id
         WHERE v.time < u.last ORDER BY v.time ASC LIMIT ?)`,
      ).run(n - MAX_VISITS)
    })
  }
}
