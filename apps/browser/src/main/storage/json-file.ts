import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

let sequence = 0
const chains = new Map<string, Promise<void>>()

export function staleTemp(name: string, file: string, pid = process.pid): boolean {
  const prefix = `${name}.`
  if (!file.startsWith(prefix) || !file.endsWith('.tmp')) return false
  const m = /^(\d+)\.\d+\.tmp$/.exec(file.slice(prefix.length))
  return m !== null && Number(m[1]) !== pid
}

export const STALE_TEMP_MS = 60_000

async function removeStaleTemps(path: string, now = Date.now()): Promise<void> {
  const dir = dirname(path)
  const name = basename(path)
  const files = await readdir(dir).catch(() => [])
  await Promise.all(
    files
      .filter((f) => staleTemp(name, f))
      .map(async (f) => {
        const file = join(dir, f)
        const info = await stat(file).catch(() => null)
        if (info !== null && now - info.mtimeMs > STALE_TEMP_MS) await rm(file, { force: true })
      }),
  )
}

export async function readJson<T>(
  path: string,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  await removeStaleTemps(path)
  try {
    const text = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(text)
    return validate(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2)
  const previous = chains.get(path) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.${++sequence}.tmp`
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, path)
    })
  chains.set(path, next)
  return next
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: NodeJS.Timeout | null = null
  let pending: A | null = null
  const flush = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (pending !== null) {
      const args = pending
      pending = null
      fn(...args)
    }
  }
  const call = (...args: A) => {
    pending = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, ms)
  }
  return Object.assign(call, { flush })
}

// At most one call per `ms`: the first at once, the latest never lost. For a
// steady stream — a running download reports progress every 250 ms — where a
// trailing debounce would wait for the stream to stop: the desktop's dock
// reads downloads.json for its progress ring, and saw a download only once it
// had finished.
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: NodeJS.Timeout | null = null
  let pending: A | null = null
  let last = Number.NEGATIVE_INFINITY
  const run = () => {
    timer = null
    if (pending === null) return
    const args = pending
    pending = null
    last = Date.now()
    fn(...args)
  }
  const call = (...args: A) => {
    pending = args
    if (timer !== null) return
    const wait = last + ms - Date.now()
    if (wait <= 0) run()
    else timer = setTimeout(run, wait)
  }
  const flush = () => {
    if (timer !== null) clearTimeout(timer)
    run()
  }
  return Object.assign(call, { flush })
}
