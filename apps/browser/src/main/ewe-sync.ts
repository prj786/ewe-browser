import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EweSyncRequest } from '@ewe/shared'
import { toolPath } from './files/places'

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function eweSyncArgs(
  request: EweSyncRequest,
  isDir: (path: string) => boolean = isDirectory,
): string[] | null {
  switch (request.op) {
    case 'available':
      return null
    case 'pane':
      return ['--pane', request.pane]
    case 'add-folder':
      return resolve(request.path) === request.path && request.path !== '/' && isDir(request.path)
        ? ['--add-folder', request.path]
        : null
  }
}

export function runEweSync(request: EweSyncRequest): boolean {
  const bin = toolPath('ewe-sync')
  if (bin === null) return false
  if (request.op === 'available') return true
  const args = eweSyncArgs(request)
  if (args === null) return false
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const child = spawn(bin, args, { detached: true, stdio: 'ignore', env })
    child.on('error', () => undefined)
    child.unref()
    return true
  } catch {
    return false
  }
}
