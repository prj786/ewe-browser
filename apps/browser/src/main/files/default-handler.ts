import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DESKTOP_ID = 'ewe-browser-folders.desktop'
const MIME = 'inode/directory'
const FALLBACK = 'nemo.desktop'

export interface DefaultHandlerStatus {
  isDefault: boolean
  current: string | null
}

function quote(arg: string): string {
  return `"${arg.replace(/(["`$\\])/g, '\\$1')}"`
}

export function desktopEntry(command: string[]): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ewe Browser',
    'GenericName=File manager',
    'Comment=Open folders in ewe Browser',
    `Exec=${command.map(quote).join(' ')} %U`,
    'Icon=ewe-browser',
    'Terminal=false',
    'NoDisplay=true',
    'Categories=FileManager;',
    'MimeType=inode/directory;',
    'StartupWMClass=ewe-browser',
    '',
  ].join('\n')
}

function gioMime(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gio', ['mime', MIME, ...args], { timeout: 5000, encoding: 'utf8' }, (error, stdout) =>
      resolve(error === null ? stdout : null),
    )
  })
}

export function parseGioDefault(text: string | null): string | null {
  if (text === null) return null
  const first = text.split('\n')[0] ?? ''
  const m = /:\s*(\S+\.desktop)\s*$/.exec(first)
  return m?.[1] ?? null
}

export class DefaultHandler {
  private readonly stateFile: string
  private readonly command: string[]

  constructor(userData: string, command: string[]) {
    this.stateFile = join(userData, 'default-handler.json')
    this.command = command
  }

  private dataHome(): string {
    return process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  }

  async status(): Promise<DefaultHandlerStatus> {
    const current = parseGioDefault(await gioMime([]))
    return { isDefault: current === DESKTOP_ID, current }
  }

  async set(on: boolean): Promise<DefaultHandlerStatus> {
    if (on) {
      const before = await this.status()
      if (!before.isDefault)
        await writeFile(this.stateFile, JSON.stringify({ previous: before.current }))
      const dir = join(this.dataHome(), 'applications')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, DESKTOP_ID), desktopEntry(this.command))
      await gioMime([DESKTOP_ID])
      return this.status()
    }
    let previous = FALLBACK
    try {
      const saved: unknown = JSON.parse(await readFile(this.stateFile, 'utf8'))
      const value = (saved as { previous?: unknown } | null)?.previous
      if (typeof value === 'string' && value.endsWith('.desktop') && value !== DESKTOP_ID)
        previous = value
    } catch {
      previous = FALLBACK
    }
    await gioMime([previous])
    return this.status()
  }
}
