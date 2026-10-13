import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ArchiveEntry, ArchiveFormat, ArchiveListing } from '@ewe/shared'
import { uniquePath } from '../storage/downloads-store'

const MAX_LISTED = 2000
const LINE = /^(\S)\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d+\s+(?:\d{1,2}:\d{2}|\d{4})\s(.*)$/
const MULTI = ['.tar.gz', '.tar.xz', '.tar.zst', '.tar.bz2', '.tar.lz4', '.tgz', '.tbz2', '.txz']

function bsdtar(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'bsdtar',
      args,
      { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...(cwd === undefined ? {} : { cwd }) },
      (error, stdout, stderr) => {
        if (error === null) resolve(stdout)
        else reject(new Error(stderr.trim().split('\n').pop() ?? error.message))
      },
    )
  })
}

export function parseListing(text: string): ArchiveEntry[] {
  const out: ArchiveEntry[] = []
  for (const line of text.split('\n')) {
    const m = LINE.exec(line)
    if (m === null) continue
    const name = (m[3] ?? '').replace(/^\.\//, '').replace(/\/$/, '')
    if (name === '' || name === '.') continue
    out.push({ name, dir: m[1] === 'd', size: Number(m[2] ?? 0) })
  }
  return out
}

export function archiveBase(name: string): string {
  const lower = name.toLowerCase()
  const multi = MULTI.find((ext) => lower.endsWith(ext))
  if (multi !== undefined) return name.slice(0, -multi.length) || name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function singleRoot(entries: ArchiveEntry[]): string | null {
  let root: string | null = null
  for (const e of entries) {
    const top = e.name.split('/')[0] ?? ''
    if (root === null) root = top
    else if (root !== top) return null
  }
  if (root === null) return null
  const top = root
  return entries.some((e) => e.name.startsWith(`${top}/`)) ? top : null
}

export function uniqueDir(dir: string, name: string, taken = existsSync): string {
  let candidate = join(dir, name)
  for (let n = 1; taken(candidate) && n < 10_000; n++) candidate = join(dir, `${name} (${n})`)
  return candidate
}

export async function listArchive(path: string): Promise<ArchiveListing> {
  const entries = parseListing(await bsdtar(['-tvf', path]))
  return {
    path,
    count: entries.filter((e) => !e.dir).length,
    size: entries.reduce((sum, e) => sum + e.size, 0),
    entries: entries.slice(0, MAX_LISTED),
    truncated: entries.length > MAX_LISTED,
    root: singleRoot(entries),
  }
}

export async function extractArchive(path: string): Promise<string> {
  const dir = dirname(path)
  const root = singleRoot(parseListing(await bsdtar(['-tvf', path])))
  if (root !== null && !existsSync(join(dir, root))) {
    await bsdtar(['-xf', path, '-C', dir])
    return join(dir, root)
  }
  const dest = uniqueDir(dir, archiveBase(basename(path)))
  await mkdir(dest)
  try {
    await bsdtar(['-xf', path, '-C', dest])
  } catch (error) {
    await rm(dest, { recursive: true, force: true })
    throw error
  }
  return dest
}

const EXTENSIONS: Record<ArchiveFormat, string> = {
  zip: '.zip',
  'tar.gz': '.tar.gz',
  'tar.zst': '.tar.zst',
}

export async function compressPaths(paths: string[], format: ArchiveFormat): Promise<string> {
  const first = paths[0]
  if (first === undefined) throw new Error('Nothing to compress')
  const dir = dirname(first)
  if (paths.some((p) => dirname(p) !== dir)) throw new Error('Items must be in one folder')
  const base = paths.length === 1 ? basename(first) : 'Archive'
  const out = uniquePath(dir, `${base}${EXTENSIONS[format]}`, (p) => existsSync(p))
  try {
    await bsdtar(['-a', '-cf', out, ...paths.map((p) => `./${basename(p)}`)], dir)
  } catch (error) {
    await rm(out, { force: true })
    throw error
  }
  return out
}
