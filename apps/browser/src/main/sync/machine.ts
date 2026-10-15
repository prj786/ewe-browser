import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'

const MACHINE_ID_FILES = ['/etc/machine-id', '/var/lib/dbus/machine-id']

export function machineLabel(): string {
  const name = process.env.EWE_SYNC_MACHINE?.trim() ?? ''
  return name === '' ? hostname() : name
}

export function legacyFileId(label: string): string {
  const id = label.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)
  return id === '' ? 'machine' : id
}

function readFirst(paths: string[]): string {
  for (const path of paths) {
    try {
      const raw = readFileSync(path, 'utf8').trim()
      if (raw !== '') return raw
    } catch {
      continue
    }
  }
  return ''
}

export function machineId(userData: string, idFiles: string[] = MACHINE_ID_FILES): string {
  const raw = readFirst(idFiles)
  if (raw !== '')
    return createHash('sha256').update(`ewe-browser:${raw}:${userData}`).digest('hex').slice(0, 16)
  const file = join(userData, 'sync', 'machine-id')
  const saved = readFirst([file])
  if (/^[0-9a-f]{16}$/.test(saved)) return saved
  const fresh = randomUUID().replace(/-/g, '').slice(0, 16)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${fresh}\n`, { mode: 0o600 })
  } catch {
    return fresh
  }
  return fresh
}
