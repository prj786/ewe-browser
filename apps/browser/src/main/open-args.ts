import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type OpenTarget = { kind: 'dir'; path: string } | { kind: 'url'; url: string }

function isDir(path: string): boolean | null {
  try {
    return statSync(path).isDirectory()
  } catch {
    return null
  }
}

export function openArgs(
  argv: string[],
  cwd: string,
  self: readonly string[],
  probe: (path: string) => boolean | null = isDir,
): OpenTarget[] {
  const out: OpenTarget[] = []
  for (const arg of argv.slice(1)) {
    if (arg === '' || arg.startsWith('-')) continue
    if (/^https?:\/\//i.test(arg)) {
      out.push({ kind: 'url', url: arg })
      continue
    }
    let path: string
    try {
      path = arg.startsWith('file://')
        ? fileURLToPath(arg)
        : isAbsolute(arg)
          ? arg
          : resolve(cwd, arg)
    } catch {
      continue
    }
    if (self.includes(path)) continue
    const dir = probe(path)
    if (dir === null) continue
    out.push(dir ? { kind: 'dir', path } : { kind: 'url', url: pathToFileURL(path).href })
  }
  return out
}
