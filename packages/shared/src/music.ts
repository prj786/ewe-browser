export interface Track {
  path: string
  mtime: number
  size: number
  title: string
  artist: string
  album: string
  albumArtist: string
  track: number | null
  disc: number | null
  year: number | null
  duration: number | null
  genre: string
  cover: boolean
}

export interface MusicLibrary {
  roots: string[]
  tracks: Track[]
  scanning: boolean
  scannedAt: number | null
}

export interface Album {
  key: string
  title: string
  artist: string
  year: number | null
  tracks: Track[]
  cover: Track | null
}

export interface Artist {
  name: string
  albums: Album[]
  tracks: number
}

export type MusicRequest = { op: 'library' } | { op: 'rescan' } | { op: 'token' }

export function isMusicRequest(value: unknown): value is MusicRequest {
  if (typeof value !== 'object' || value === null) return false
  const op = (value as Record<string, unknown>).op
  return op === 'library' || op === 'rescan' || op === 'token'
}

export const MUSIC_PAGE_URL = 'app://music/'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function compareTracks(a: Track, b: Track): number {
  return (
    collator.compare(a.albumArtist || a.artist, b.albumArtist || b.artist) ||
    collator.compare(a.album, b.album) ||
    (a.disc ?? 1) - (b.disc ?? 1) ||
    (a.track ?? 9999) - (b.track ?? 9999) ||
    collator.compare(a.title, b.title)
  )
}

export function groupAlbums(tracks: Track[]): Album[] {
  const byKey = new Map<string, Album>()
  for (const t of [...tracks].sort(compareTracks)) {
    const artist = t.albumArtist || t.artist
    const key = `${artist.toLowerCase()}\u0000${t.album.toLowerCase()}`
    let album = byKey.get(key)
    if (album === undefined) {
      album = { key, title: t.album, artist, year: t.year, tracks: [], cover: null }
      byKey.set(key, album)
    }
    album.tracks.push(t)
    if (album.cover === null && t.cover) album.cover = t
    if (album.year === null && t.year !== null) album.year = t.year
  }
  return [...byKey.values()].sort(
    (a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title),
  )
}

export function groupArtists(albums: Album[]): Artist[] {
  const byName = new Map<string, Artist>()
  for (const album of albums) {
    const key = album.artist.toLowerCase()
    let artist = byName.get(key)
    if (artist === undefined) {
      artist = { name: album.artist, albums: [], tracks: 0 }
      byName.set(key, artist)
    }
    artist.albums.push(album)
    artist.tracks += album.tracks.length
  }
  return [...byName.values()].sort((a, b) => collator.compare(a.name, b.name))
}

export function searchTracks(tracks: Track[], query: string): Track[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
  if (words.length === 0) return tracks
  return tracks.filter((t) => {
    const text = `${t.title} ${t.artist} ${t.album} ${t.albumArtist} ${t.genre}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

export function shuffled<T>(items: T[], first: T | undefined, random = Math.random): T[] {
  const rest = items.filter((x) => x !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = rest[i]
    const b = rest[j]
    if (a !== undefined && b !== undefined) {
      rest[i] = b
      rest[j] = a
    }
  }
  return first === undefined ? rest : [first, ...rest]
}
