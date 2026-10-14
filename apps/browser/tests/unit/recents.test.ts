import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DownloadEntry, HistoryVisit, Track } from '@ewe/shared'
import { RecentsService, parseRecentlyUsed, snippetOf } from '../../src/main/home/recents'
import { RecentStore, isRecentFile } from '../../src/main/storage/recent-store'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 14, 12)

function xbel(entries: { path: string; time: number }[]): string {
  const rows = entries.map(({ path, time }) => {
    const t = new Date(time).toISOString()
    return `  <bookmark href="${pathToFileURL(path).href.replace(/&/g, '&amp;')}" added="2020-01-01T00:00:00Z" modified="${t}" visited="2020-01-01T00:00:00.123456Z">
    <info><metadata owner="http://freedesktop.org"><mime:mime-type type="text/plain"/>
      <bookmark:applications><bookmark:application name="nemo" exec="&apos;mpv %U&apos;" modified="${t}" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xbel version="1.0">\n${rows.join('\n')}\n  <bookmark href="sftp://host/x.pdf" added="2026-10-01T00:00:00Z"></bookmark>\n</xbel>\n`
}

describe('GTK recent files', () => {
  it('reads file bookmarks with their newest stamp', () => {
    const parsed = parseRecentlyUsed(
      xbel([
        { path: '/home/me/A & B.pdf', time: now },
        { path: '/home/me/clip.mp4', time: now - DAY },
      ]),
    )
    expect(parsed).toEqual([
      { path: '/home/me/A & B.pdf', time: now },
      { path: '/home/me/clip.mp4', time: now - DAY },
    ])
    expect(parseRecentlyUsed('garbage')).toEqual([])
  })

  it('cuts text snippets at a line and skips binary files', () => {
    expect(snippetOf(new TextEncoder().encode('\n\n# Title\nbody\n'))).toBe('# Title\nbody')
    expect(snippetOf(new Uint8Array([65, 0, 66]))).toBeNull()
    expect(snippetOf(new TextEncoder().encode('   \n'))).toBeNull()
  })
})

describe('recent store', () => {
  it('records documents and media, forgets keys and survives a reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-recent-'))
    const store = new RecentStore(dir)
    expect(store.record('/m/a.mp3', 'played', now)).toBe(true)
    expect(store.record('/d/a.pdf', 'opened', now + 1)).toBe(true)
    expect(store.record('/d/a.pdf', 'opened', now + 2)).toBe(true)
    expect(store.record('/x/photo.jpg', 'opened', now)).toBe(false)
    expect(store.record('relative.pdf', 'opened', now)).toBe(false)
    store.forget('https://a.test/', now + 3)
    await store.flush()
    const file: unknown = JSON.parse(readFileSync(join(dir, 'recent.json'), 'utf8'))
    expect(isRecentFile(file)).toBe(true)
    const again = new RecentStore(dir)
    await again.load()
    expect(again.list().find((r) => r.path === '/d/a.pdf')).toMatchObject({
      count: 2,
      time: now + 2,
    })
    expect(again.hidden().get('https://a.test/')).toBe(now + 3)
    again.forget('/d/a.pdf', now + 4)
    expect(again.list().map((r) => r.path)).toEqual(['/m/a.mp3'])
  })
})

describe('recents service', () => {
  const root = mkdtempSync(join(tmpdir(), 'ewe-recents-'))
  mkdirSync(join(root, 'Docs'))
  const files = {
    pdf: join(root, 'Docs', 'handbook.pdf'),
    md: join(root, 'Docs', 'plan.md'),
    mp4: join(root, 'clip.mp4'),
    mp3: join(root, '01 Morning.mp3'),
    gone: join(root, 'deleted.pdf'),
    conf: join(root, 'ewe.conf'),
    dl: join(root, 'invoice.pdf'),
  }
  writeFileSync(files.pdf, '%PDF-1.4')
  writeFileSync(files.md, '# Plan\n\nShear on Tuesday.\n')
  writeFileSync(files.mp4, '')
  writeFileSync(files.mp3, '')
  writeFileSync(files.conf, '')
  writeFileSync(files.dl, '%PDF-1.4')
  const xbelPath = join(root, 'recently-used.xbel')
  writeFileSync(
    xbelPath,
    xbel([
      { path: files.pdf, time: now - 60_000 },
      { path: files.mp4, time: now - 2 * 3600_000 },
      { path: files.gone, time: now },
      { path: files.conf, time: now },
    ]),
  )
  const visits: HistoryVisit[] = [
    {
      url: 'https://www.google.com/search?q=ewe',
      title: 'ewe - Google',
      host: 'google.com',
      count: 1,
      last: now,
    },
    { url: 'https://a.test/2', title: 'A two', host: 'a.test', count: 1, last: now - 1000 },
    { url: 'https://a.test/1', title: 'A one', host: 'a.test', count: 4, last: now - 2000 },
    { url: 'https://b.test/', title: '', host: 'b.test', count: 1, last: now - 3000 },
  ]
  const download = {
    id: '1',
    url: 'https://shop.test/invoice.pdf',
    filename: 'invoice.pdf',
    path: files.dl,
    mime: 'application/pdf',
    received: 8,
    total: 8,
    speed: 0,
    status: 'completed',
    started: now - 5 * DAY,
    ended: now - 5 * DAY,
  } satisfies DownloadEntry
  const track = {
    path: files.mp3,
    mtime: 0,
    size: 0,
    title: 'Morning',
    artist: 'The Flock',
    album: 'Pasture',
    albumArtist: '',
    track: 1,
    disc: null,
    year: null,
    duration: 30,
    genre: '',
    cover: true,
  } satisfies Track
  const hidden = new Map<string, number>()
  const service = new RecentsService({
    records: () => [
      { path: files.mp3, time: now - DAY, source: 'played', count: 3 },
      { path: files.md, time: now - 30 * 60_000, source: 'opened', count: 1 },
    ],
    hidden: () => hidden,
    history: () => visits,
    downloads: () => [download],
    track: (path) => (path === files.mp3 ? track : undefined),
    xbelPath: () => xbelPath,
  })

  it('mixes the newest of each kind and skips missing files, configs and searches', async () => {
    const all = await service.collect('all', 5)
    expect(all.map((i) => i.key)).toEqual([
      'https://a.test/2',
      'https://b.test/',
      files.pdf,
      files.mp4,
      files.mp3,
    ])
    const audio = all.find((i) => i.kind === 'audio')
    expect(audio).toMatchObject({
      title: 'Morning',
      artist: 'The Flock',
      album: 'Pasture',
      source: 'played',
    })
    expect(all.find((i) => i.key === 'https://b.test/')?.title).toBe('b.test')
    expect(all.find((i) => i.kind === 'video')).toMatchObject({ title: 'clip', source: 'system' })
    expect(service.knows(files.pdf)).toBe(true)
    expect(service.knows(files.conf)).toBe(false)
  })

  it('filters by kind, reads text snippets and includes finished downloads', async () => {
    const docs = await service.collect('doc', 5)
    expect(docs.map((i) => i.key)).toEqual([files.pdf, files.md, files.dl])
    expect(docs[1]?.snippet).toBe('# Plan\n\nShear on Tuesday.')
    expect(docs[2]).toMatchObject({ source: 'downloaded', dir: root, ext: 'pdf', fileKind: 'pdf' })
  })

  it('hides forgotten items until they are used again', async () => {
    hidden.set(files.pdf, now)
    hidden.set('https://a.test/2', now - 500)
    const docs = await service.collect('doc', 5)
    expect(docs.map((i) => i.key)).toEqual([files.md, files.dl])
    const web = await service.collect('web', 5)
    expect(web.map((i) => i.key)).toEqual(['https://a.test/1', 'https://b.test/'])
  })
})
