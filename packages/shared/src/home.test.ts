import { describe, expect, it } from 'vitest'
import { viewerUrl } from './files'
import {
  dedupeRecents,
  isHomeRequest,
  isRecentFilter,
  isSearchResultUrl,
  pickRecents,
  recentKindOf,
  type RecentItem,
  type RecentKind,
} from './home'
import { isMusicRequest } from './music'
import { isShellCommand } from './ipc-contract'

function item(key: string, kind: RecentKind, time: number, host: string | null = null): RecentItem {
  return {
    key,
    kind,
    title: key,
    time,
    source: kind === 'web' ? 'visited' : 'opened',
    url: kind === 'web' ? key : null,
    path: kind === 'web' ? null : key,
    dir: null,
    fileKind: null,
    ext: '',
    size: null,
    host,
    artist: null,
    album: null,
    cover: false,
    snippet: null,
  }
}

describe('recent kinds', () => {
  it('maps documents, videos, music and leaves the rest out', () => {
    expect(recentKindOf('/a/Report.PDF')).toBe('doc')
    expect(recentKindOf('/a/letter.docx')).toBe('doc')
    expect(recentKindOf('/a/budget.ods')).toBe('doc')
    expect(recentKindOf('/a/deck.pptx')).toBe('doc')
    expect(recentKindOf('/a/notes.md')).toBe('doc')
    expect(recentKindOf('/a/todo.txt')).toBe('doc')
    expect(recentKindOf('/a/clip.mkv')).toBe('video')
    expect(recentKindOf('/a/song.flac')).toBe('audio')
    expect(recentKindOf('/a/ewe.conf')).toBeNull()
    expect(recentKindOf('/a/photo.jpg')).toBeNull()
    expect(recentKindOf('/a/main.ts')).toBeNull()
    expect(recentKindOf('/a/backup.zip')).toBeNull()
  })

  it('tells search result pages apart from sites', () => {
    expect(isSearchResultUrl('https://www.google.com/search?q=sheep&hl=en')).toBe(true)
    expect(isSearchResultUrl('https://google.com/search?q=sheep')).toBe(true)
    expect(isSearchResultUrl('https://duckduckgo.com/?q=sheep&ia=web')).toBe(true)
    expect(isSearchResultUrl('https://duckduckgo.com/about')).toBe(false)
    expect(isSearchResultUrl('https://www.google.com/maps')).toBe(false)
    expect(isSearchResultUrl('not a url')).toBe(false)
  })
})

describe('picking recents', () => {
  const items = [
    item('https://a.test/1', 'web', 100, 'a.test'),
    item('https://a.test/2', 'web', 99, 'a.test'),
    item('https://b.test/', 'web', 98, 'b.test'),
    item('https://c.test/', 'web', 97, 'c.test'),
    item('/d/a.pdf', 'doc', 50),
    item('/d/b.pdf', 'doc', 40),
    item('/v/a.mp4', 'video', 30),
    item('/m/a.mp3', 'audio', 20),
  ]

  it('keeps the newest page per site', () => {
    const keys = dedupeRecents(items).map((i) => i.key)
    expect(keys).toContain('https://a.test/1')
    expect(keys).not.toContain('https://a.test/2')
  })

  it('takes the newest of every kind first, then fills by time', () => {
    expect(pickRecents(items, 'all', 5).map((i) => i.key)).toEqual([
      'https://a.test/1',
      'https://b.test/',
      '/d/a.pdf',
      '/v/a.mp4',
      '/m/a.mp3',
    ])
  })

  it('returns the newest of one kind for a filter', () => {
    expect(pickRecents(items, 'doc', 5).map((i) => i.key)).toEqual(['/d/a.pdf', '/d/b.pdf'])
    expect(pickRecents(items, 'web', 2).map((i) => i.key)).toEqual([
      'https://a.test/1',
      'https://b.test/',
    ])
    expect(pickRecents([], 'all', 5)).toEqual([])
  })
})

describe('home requests', () => {
  it('validates every op', () => {
    expect(isHomeRequest({ op: 'recents', filter: 'all', limit: 5 })).toBe(true)
    expect(isHomeRequest({ op: 'recents', filter: 'photos', limit: 5 })).toBe(false)
    expect(isHomeRequest({ op: 'recents', filter: 'doc', limit: 0 })).toBe(false)
    expect(isHomeRequest({ op: 'recents', filter: 'doc', limit: 1.5 })).toBe(false)
    expect(isHomeRequest({ op: 'places' })).toBe(true)
    expect(isHomeRequest({ op: 'token' })).toBe(true)
    expect(isHomeRequest({ op: 'open', path: '/a/b.pdf' })).toBe(true)
    expect(isHomeRequest({ op: 'open', path: 'b.pdf' })).toBe(false)
    expect(isHomeRequest({ op: 'mpv', path: '/a/b.mp4' })).toBe(true)
    expect(isHomeRequest({ op: 'forget', key: 'https://a.test/' })).toBe(true)
    expect(isHomeRequest({ op: 'forget', key: '' })).toBe(false)
    expect(isHomeRequest({ op: 'rm', path: '/' })).toBe(false)
    expect(isRecentFilter('audio')).toBe(true)
    expect(isRecentFilter('image')).toBe(false)
  })

  it('accepts music.play and the played music op only with absolute paths', () => {
    expect(isShellCommand({ type: 'music.play', path: '/m/a.mp3' })).toBe(true)
    expect(isShellCommand({ type: 'music.play', path: 'a.mp3' })).toBe(false)
    expect(isMusicRequest({ op: 'played', path: '/m/a.mp3' })).toBe(true)
    expect(isMusicRequest({ op: 'played' })).toBe(false)
  })

  it('builds viewer urls for the files page', () => {
    expect(viewerUrl('/home/me/Docs/a b.pdf')).toBe(
      'app://files/?path=%2Fhome%2Fme%2FDocs&select=a+b.pdf&view=1',
    )
    expect(viewerUrl('/a.pdf')).toBe('app://files/?path=%2F&select=a.pdf&view=1')
  })
})
