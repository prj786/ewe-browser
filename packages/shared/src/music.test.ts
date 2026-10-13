import { describe, expect, it } from 'vitest'
import {
  compareTracks,
  formatDuration,
  groupAlbums,
  groupArtists,
  isMusicRequest,
  searchTracks,
  shuffled,
  type Track,
} from './music'

function track(p: Partial<Track> & { title: string }): Track {
  return {
    path: `/m/${p.title}.mp3`,
    mtime: 0,
    size: 0,
    artist: '',
    album: '',
    albumArtist: '',
    track: null,
    disc: null,
    year: null,
    duration: null,
    genre: '',
    cover: false,
    ...p,
  }
}

const library = [
  track({ title: 'Shearing', artist: 'The Flock', album: 'Pasture', track: 2 }),
  track({
    title: 'Morning',
    artist: 'The Flock',
    album: 'Pasture',
    track: 1,
    cover: true,
    year: 2024,
  }),
  track({ title: 'Lone Ewe', artist: 'Solo', album: 'Hills', genre: 'Folk' }),
  track({ title: 'Guest', artist: 'Guest', albumArtist: 'The Flock', album: 'Pasture', track: 3 }),
]

describe('music library helpers', () => {
  it('orders by album artist, album, disc and track number', () => {
    expect([...library].sort(compareTracks).map((t) => t.title)).toEqual([
      'Lone Ewe',
      'Morning',
      'Shearing',
      'Guest',
    ])
  })

  it('groups albums by album artist and picks a cover and year', () => {
    const albums = groupAlbums(library)
    expect(albums.map((a) => [a.title, a.artist, a.tracks.length])).toEqual([
      ['Hills', 'Solo', 1],
      ['Pasture', 'The Flock', 3],
    ])
    expect(albums[1]?.cover?.title).toBe('Morning')
    expect(albums[1]?.year).toBe(2024)
    expect(groupArtists(albums).map((a) => [a.name, a.tracks])).toEqual([
      ['Solo', 1],
      ['The Flock', 3],
    ])
  })

  it('searches every word across title, artist, album and genre', () => {
    expect(searchTracks(library, 'flock morn').map((t) => t.title)).toEqual(['Morning'])
    expect(searchTracks(library, 'folk').map((t) => t.title)).toEqual(['Lone Ewe'])
    expect(searchTracks(library, '  ')).toHaveLength(4)
  })

  it('formats durations and shuffles with the chosen track first', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(null)).toBe('')
    const order = shuffled([1, 2, 3, 4, 5], 3, () => 0)
    expect(order[0]).toBe(3)
    expect([...order].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('validates music requests', () => {
    expect(isMusicRequest({ op: 'library' })).toBe(true)
    expect(isMusicRequest({ op: 'delete' })).toBe(false)
    expect(isMusicRequest(null)).toBe(false)
  })
})
