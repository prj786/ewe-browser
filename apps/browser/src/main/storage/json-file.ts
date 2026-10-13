import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

let sequence = 0
const chains = new Map<string, Promise<void>>()

export async function readJson<T>(
  path: string,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
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
