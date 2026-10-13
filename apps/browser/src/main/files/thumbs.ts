import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { nativeImage } from 'electron'
import { extensionOf, fileKind } from '@ewe/shared'

const THUMB_SIZE = 256
const MAX_RAW_THUMB = 25 * 1024 * 1024
const MAX_JOBS = 3

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  json: 'application/json',
}

const NATIVE_DECODE = new Set(['png', 'jpg', 'jpeg'])

export function mimeOf(path: string): string {
  return MIME[extensionOf(path)] ?? 'application/octet-stream'
}

function cacheHome(): string {
  return process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
}

export function thumbnailName(path: string): string {
  return `${createHash('md5').update(pathToFileURL(path).href).digest('hex')}.png`
}

async function freshFile(path: string, notBefore: number): Promise<Buffer | null> {
  try {
    const info = await stat(path)
    if (info.mtimeMs + 1000 < notBefore) return null
    return await readFile(path)
  } catch {
    return null
  }
}

let running = 0
const waiting: (() => void)[] = []

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_JOBS) await new Promise<void>((r) => waiting.push(r))
  running += 1
  try {
    return await job()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}

function videoFrame(input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'ffmpegthumbnailer',
      ['-i', input, '-o', output, '-s', String(THUMB_SIZE), '-c', 'png', '-q', '8'],
      { timeout: 15_000 },
      (error) => resolve(error === null),
    )
  })
}

export type Thumbnail = { kind: 'png'; data: Buffer } | { kind: 'raw' } | null

export async function thumbnail(path: string): Promise<Thumbnail> {
  let info
  try {
    info = await stat(path)
  } catch {
    return null
  }
  if (!info.isFile()) return null
  const kind = fileKind({ name: path, dir: false })
  if (kind !== 'image' && kind !== 'video') return null
  const name = thumbnailName(path)
  for (const size of ['x-large', 'large', 'normal']) {
    const shared = await freshFile(join(cacheHome(), 'thumbnails', size, name), info.mtimeMs)
    if (shared !== null) return { kind: 'png', data: shared }
  }
  const ownDir = join(cacheHome(), 'ewe-browser', 'thumbnails')
  const own = join(ownDir, name)
  const cached = await freshFile(own, info.mtimeMs)
  if (cached !== null) return { kind: 'png', data: cached }

  const ext = extensionOf(path)
  if (kind === 'image' && !NATIVE_DECODE.has(ext))
    return info.size <= MAX_RAW_THUMB ? { kind: 'raw' } : null

  return slot(async (): Promise<Thumbnail> => {
    await mkdir(ownDir, { recursive: true })
    if (kind === 'video') {
      if (!(await videoFrame(path, own))) return null
      const data = await freshFile(own, 0)
      return data === null ? null : { kind: 'png', data }
    }
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) return info.size <= MAX_RAW_THUMB ? { kind: 'raw' } : null
    const { width, height } = image.getSize()
    const scaled =
      Math.max(width, height) > THUMB_SIZE
        ? image.resize(width >= height ? { width: THUMB_SIZE } : { height: THUMB_SIZE })
        : image
    const data = scaled.toPNG()
    await writeFile(own, data).catch(() => undefined)
    return { kind: 'png', data }
  })
}

export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (header === null) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (m === null) return null
  const a = m[1] ?? ''
  const b = m[2] ?? ''
  if (a === '' && b === '') return null
  const start = a === '' ? Math.max(0, size - Number(b)) : Number(a)
  const end = a === '' || b === '' ? size - 1 : Math.min(Number(b), size - 1)
  if (start > end || start >= size) return null
  return { start, end }
}

export async function rawResponse(path: string, range: string | null): Promise<Response> {
  let info
  try {
    info = await stat(path)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!info.isFile()) return new Response('Not a file', { status: 400 })
  const headers: Record<string, string> = {
    'content-type': mimeOf(path),
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  }
  const r = parseRange(range, info.size)
  const stream = createReadStream(path, r === null ? {} : { start: r.start, end: r.end })
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
  if (r === null) {
    headers['content-length'] = String(info.size)
    return new Response(body, { status: 200, headers })
  }
  headers['content-length'] = String(r.end - r.start + 1)
  headers['content-range'] = `bytes ${r.start}-${r.end}/${info.size}`
  return new Response(body, { status: 206, headers })
}

export async function thumbResponse(path: string): Promise<Response> {
  const thumb = await thumbnail(path)
  if (thumb === null) return new Response('No thumbnail', { status: 404 })
  if (thumb.kind === 'raw') return rawResponse(path, null)
  return new Response(new Uint8Array(thumb.data), {
    headers: { 'content-type': 'image/png', 'cache-control': 'max-age=300' },
  })
}
