import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computePlaces,
  parseCloudStatus,
  parseGtkBookmarks,
  parseMountPoints,
  parseUserDirs,
  type PlacesEnv,
} from '../../src/main/files/places'
import { expandPath, isInside, listDirectory, transfer } from '../../src/main/files/service'
import { parseRange, thumbnailName } from '../../src/main/files/thumbs'
import { openArgs } from '../../src/main/open-args'
import { titleFromName } from '../../src/main/media/library'
import {
  archiveBase,
  compressPaths,
  extractArchive,
  listArchive,
  parseListing,
  singleRoot,
} from '../../src/main/files/archive'
import { desktopEntry, parseGioDefault } from '../../src/main/files/default-handler'

describe('places parsing', () => {
  it('reads XDG user dirs, GTK bookmarks and mount points', () => {
    expect(
      parseUserDirs('# c\nXDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_MUSIC_DIR="/data/music"\n', '/h'),
    ).toEqual({ DOWNLOAD: '/h/Downloads', MUSIC: '/data/music' })
    expect(
      parseGtkBookmarks(
        'file:///home/me/Nextcloud Nextcloud\nfile:///srv/a%20b\nsftp://x y\nfile:///home/me/Notes/\nfile:///\n',
      ),
    ).toEqual([
      { path: '/home/me/Nextcloud', label: 'Nextcloud' },
      { path: '/srv/a b', label: 'a b' },
      { path: '/home/me/Notes', label: 'Notes' },
      { path: '/', label: '' },
    ])
    expect(
      parseMountPoints(
        'a /home/me/Google\\040Drive fuse.rclone rw 0 0\nb /run/user/1000/gvfs fuse.gvfsd-fuse rw 0 0\n',
        'fuse.rclone',
      ),
    ).toEqual(['/home/me/Google Drive'])
    expect(parseCloudStatus('{"configured":true,"mounted":false,"path":"/h/Nextcloud"}')).toEqual({
      configured: true,
      mounted: false,
      path: '/h/Nextcloud',
    })
    expect(parseCloudStatus('nope')).toBeNull()
    expect(parseCloudStatus(null)).toBeNull()
  })

  it('builds the place list with cloud states, devices and dedupe', async () => {
    const env: PlacesEnv = {
      home: '/h',
      user: 'me',
      uid: 1000,
      configHome: '/h/.config',
      dataHome: '/h/.local/share',
      readText: (p) =>
        p.endsWith('user-dirs.dirs')
          ? 'XDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_DESKTOP_DIR="$HOME"\n'
          : p.endsWith('bookmarks')
            ? 'file:///h/Nextcloud Nextcloud\nfile:///h/work Work\n'
            : null,
      listDirs: (p) =>
        p === '/run/media/me' ? ['USB'] : p === '/run/user/1000/gvfs' ? ['sftp:host=box'] : [],
      isDir: (p) => p !== '/h/Videos',
      mounts: () => '',
      status: (tool) =>
        Promise.resolve(
          tool === 'ewe-files' ? { configured: true, mounted: false, path: '/h/Nextcloud' } : null,
        ),
    }
    const places = await computePlaces(env)
    const ids = places.map((p) => p.id)
    expect(ids[0]).toBe('home')
    expect(ids).toContain('xdg-download')
    expect(ids).not.toContain('xdg-desktop')
    expect(ids).not.toContain('xdg-videos')
    expect(places.find((p) => p.id === 'nextcloud')).toMatchObject({
      state: 'offline',
      mount: 'nextcloud',
      path: '/h/Nextcloud',
    })
    expect(ids).not.toContain('drive')
    expect(places.filter((p) => p.path === '/h/Nextcloud')).toHaveLength(1)
    expect(places.find((p) => p.label === 'Work')?.group).toBe('bookmarks')
    expect(places.find((p) => p.id === 'media-USB')?.path).toBe('/run/media/me/USB')
    expect(places.find((p) => p.id === 'gvfs-sftp:host=box')?.label).toBe('box')
    expect(ids.slice(-2)).toEqual(['root', 'trash'])
  })
})

describe('file service', () => {
  it('expands home and keeps paths absolute', () => {
    expect(expandPath('~', '/h')).toBe('/h')
    expect(expandPath('~/a/../b', '/h')).toBe('/h/b')
    expect(expandPath('relative', '/h')).toBe('/relative')
    expect(isInside('/a/b', '/a')).toBe(true)
    expect(isInside('/ab', '/a')).toBe(false)
  })

  it('lists, copies and moves with unique names and refuses moving into itself', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ewe-fs-'))
    mkdirSync(join(root, 'dir'))
    mkdirSync(join(root, 'dest'))
    writeFileSync(join(root, 'a.txt'), 'hello')
    writeFileSync(join(root, '.hidden'), '')
    writeFileSync(join(root, 'dest', 'a.txt'), 'old')
    const listing = await listDirectory(root, false)
    expect(listing.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'dest', 'dir'])
    expect(listing.entries.find((e) => e.name === 'dir')?.dir).toBe(true)
    expect(listing.writable).toBe(true)
    expect((await listDirectory(root, true)).entries.some((e) => e.name === '.hidden')).toBe(true)

    const copied = await transfer([join(root, 'a.txt')], join(root, 'dest'), 'copy')
    expect(copied).toEqual([join(root, 'dest', 'a (1).txt')])
    expect(readFileSync(join(root, 'dest', 'a.txt'), 'utf8')).toBe('old')
    const moved = await transfer([join(root, 'dir')], join(root, 'dest'), 'move')
    expect(moved).toEqual([join(root, 'dest', 'dir')])
    await expect(transfer([join(root, 'dest')], join(root, 'dest', 'dir'), 'move')).rejects.toThrow(
      'inside itself',
    )
    expect(await transfer([join(root, 'a.txt')], root, 'move')).toEqual([])
  })
})

describe('thumbnails and ranges', () => {
  it('names thumbnails like the freedesktop cache', () => {
    expect(thumbnailName('/home/me/a b.png')).toMatch(/^[0-9a-f]{32}\.png$/)
    expect(thumbnailName('/x')).not.toBe(thumbnailName('/y'))
  })

  it('parses byte ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=2000-', 1000)).toBeNull()
    expect(parseRange('items=0-1', 1000)).toBeNull()
    expect(parseRange(null, 1000)).toBeNull()
  })
})

describe('openArgs', () => {
  const probe = (p: string) => (p.endsWith('.txt') ? false : p.startsWith('/missing') ? null : true)
  it('turns command line paths into folder and file targets', () => {
    expect(
      openArgs(
        ['/usr/bin/electron', '/app', '--flag', '/home/me', 'docs', 'file:///n/a.txt', '/missing'],
        '/work',
        ['/app'],
        probe,
      ),
    ).toEqual([
      { kind: 'dir', path: '/home/me' },
      { kind: 'dir', path: '/work/docs' },
      { kind: 'url', url: 'file:///n/a.txt' },
    ])
    expect(openArgs(['/opt/ewe', 'https://example.com'], '/', [], probe)).toEqual([
      { kind: 'url', url: 'https://example.com' },
    ])
  })
})

describe('default folder handler', () => {
  it('writes a desktop entry that reopens this app and parses gio output', () => {
    const entry = desktopEntry(['/usr/bin/electron', '/home/me/ewe browser'])
    expect(entry).toContain('Exec="/usr/bin/electron" "/home/me/ewe browser" %U')
    expect(entry).toContain('MimeType=inode/directory;')
    expect(
      parseGioDefault('Default application for “inode/directory”: nemo.desktop\nRegistered'),
    ).toBe('nemo.desktop')
    expect(parseGioDefault('No default applications for “inode/directory”\n')).toBeNull()
    expect(parseGioDefault(null)).toBeNull()
  })
})

describe('archives', () => {
  it('parses bsdtar listings and names', () => {
    const text = [
      'drwxr-xr-x  0 1000   1000        0 Oct 13 16:14 ./',
      '-rw-r--r--  0 1000   1000        3 Oct 13 16:14 ./a b.txt',
      'drwxr-xr-x  0 me     me          0 Jan  2  2024 ./sub/',
      '-rw-r--r--  0 me     me       2048 Oct 13 16:14 ./sub/c.md',
    ].join('\n')
    expect(parseListing(text)).toEqual([
      { name: 'a b.txt', dir: false, size: 3 },
      { name: 'sub', dir: true, size: 0 },
      { name: 'sub/c.md', dir: false, size: 2048 },
    ])
    expect(archiveBase('photos.tar.zst')).toBe('photos')
    expect(archiveBase('Flock.ZIP')).toBe('Flock')
    expect(archiveBase('noext')).toBe('noext')
    expect(
      singleRoot([
        { name: 'p', dir: true, size: 0 },
        { name: 'p/a', dir: false, size: 1 },
      ]),
    ).toBe('p')
    expect(singleRoot([{ name: 'a', dir: false, size: 1 }])).toBeNull()
    expect(
      singleRoot([
        { name: 'p/a', dir: false, size: 1 },
        { name: 'q/b', dir: false, size: 1 },
      ]),
    ).toBeNull()
  })

  it('compresses and extracts without nesting a single top folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ewe-arc-'))
    mkdirSync(join(root, 'flock'))
    writeFileSync(join(root, 'flock', 'ewe.txt'), 'baa')
    writeFileSync(join(root, '-dash.txt'), 'x')
    const zip = await compressPaths([join(root, 'flock')], 'zip')
    expect(zip).toBe(join(root, 'flock.zip'))
    const listing = await listArchive(zip)
    expect(listing.root).toBe('flock')
    expect(listing.count).toBe(1)
    const first = await extractArchive(zip)
    expect(first).toBe(join(root, 'flock (1)'))
    expect(readFileSync(join(first, 'flock', 'ewe.txt'), 'utf8')).toBe('baa')
    const many = await compressPaths([join(root, 'flock'), join(root, '-dash.txt')], 'tar.zst')
    expect(many).toBe(join(root, 'Archive.tar.zst'))
    const out = await extractArchive(many)
    expect(out).toBe(join(root, 'Archive'))
    expect(readFileSync(join(out, '-dash.txt'), 'utf8')).toBe('x')
  })
})

describe('media helpers', () => {
  it('derives a title from a numbered file name', () => {
    expect(titleFromName('/m/03 - Shearing Day.flac')).toBe('Shearing Day')
    expect(titleFromName('/m/Morning.mp3')).toBe('Morning')
    expect(titleFromName('/m/2024.mp3')).toBe('2024')
  })
})
