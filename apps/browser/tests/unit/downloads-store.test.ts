import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DownloadEntry } from '@ewe/shared'
import {
  DownloadsStore,
  isDownloadsFile,
  restoredEntry,
  safeFilename,
  uniquePath,
} from '../../src/main/storage/downloads-store'

const now = Date.UTC(2026, 9, 13)

function entry(id: string, patch: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    id,
    url: `https://files.test/${id}.zip`,
    filename: `${id}.zip`,
    path: `/tmp/dl/${id}.zip`,
    mime: 'application/zip',
    received: 10,
    total: 100,
    speed: 5,
    status: 'progressing',
    started: now,
    ended: null,
    ...patch,
  }
}

describe('download file names', () => {
  it('strips paths and control characters', () => {
    expect(safeFilename('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(safeFilename('a\u0007b.txt')).toBe('ab.txt')
    expect(safeFilename('  ')).toBe('download')
    expect(safeFilename('..')).toBe('download')
  })

  it('numbers taken names before the extension', () => {
    const taken = new Set(['/d/report.pdf', '/d/report (1).pdf', '/d/notes'])
    expect(uniquePath('/d', 'report.pdf', (p) => taken.has(p))).toBe('/d/report (2).pdf')
    expect(uniquePath('/d', 'notes', (p) => taken.has(p))).toBe('/d/notes (1)')
    expect(uniquePath('/d', 'new.txt', (p) => taken.has(p))).toBe('/d/new.txt')
  })
})

describe('DownloadsStore', () => {
  it('adds newest first, updates, removes and clears finished entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-dl-'))
    const store = new DownloadsStore(dir)
    const seen: number[] = []
    store.on('change', (list) => seen.push(list.length))
    store.add(entry('a', { status: 'completed', ended: now }))
    store.add(entry('b'))
    expect(store.list().map((e) => e.id)).toEqual(['b', 'a'])
    expect(store.hasActivePath('/tmp/dl/b.zip')).toBe(true)
    expect(store.hasActivePath('/tmp/dl/a.zip')).toBe(false)
    expect(store.update('b', { received: 50 })?.received).toBe(50)
    expect(store.update('zzz', { received: 1 })).toBeUndefined()
    store.clearFinished()
    expect(store.list().map((e) => e.id)).toEqual(['b'])
    expect(store.remove('b')).toBe(true)
    expect(store.remove('b')).toBe(false)
    expect(seen).toEqual([1, 2, 2, 1, 0])
    store.add(entry('c', { status: 'completed', ended: now }))
    await store.flush()
    const file: unknown = JSON.parse(readFileSync(join(dir, 'downloads.json'), 'utf8'))
    expect(isDownloadsFile(file)).toBe(true)
  })

  it('marks downloads that were running at quit as interrupted on load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-dl-'))
    const first = new DownloadsStore(dir)
    first.add(entry('run'))
    first.add(entry('done', { status: 'completed', ended: now, speed: 0 }))
    await first.flush()
    const second = new DownloadsStore(dir)
    await second.load(now + 1000)
    expect(second.list().map((e) => [e.id, e.status, e.speed])).toEqual([
      ['done', 'completed', 0],
      ['run', 'interrupted', 0],
    ])
    expect(restoredEntry(entry('p', { status: 'paused' }), now).ended).toBe(now)
  })

  it('rejects malformed files', () => {
    expect(isDownloadsFile({ version: 1, entries: [{ id: 'x' }] })).toBe(false)
    expect(
      isDownloadsFile({ version: 1, entries: [entry('a', { status: 'exploded' as 'paused' })] }),
    ).toBe(false)
    expect(isDownloadsFile({ version: 2, entries: [] })).toBe(false)
  })
})
