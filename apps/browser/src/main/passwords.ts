import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PasswordItem, PasswordStatus } from '@ewe/shared'
import { eweBinDir } from './files/places'

const NOT_FOUND: PasswordStatus = {
  ok: false,
  provider: '',
  ready: false,
  error: 'ewe-pass is not installed',
  hint: 'Install the ewe Passwords plugin to fill logins here.',
}

export function passwordTool(): string | null {
  const candidates = [
    ...(process.env.EWE_PASS === undefined ? [] : [process.env.EWE_PASS]),
    join(eweBinDir(), 'ewe-pass'),
    join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
      'ewe',
      'plugins',
      'ewe.passwords',
      'ewe-pass',
    ),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function run(args: string[], timeout = 30_000): Promise<Record<string, unknown> | null> {
  const tool = passwordTool()
  if (tool === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(tool, args, { timeout, encoding: 'utf8' }, (_error, stdout) => {
      try {
        const parsed: unknown = JSON.parse(stdout.trim().split('\n').pop() ?? '')
        resolve(
          typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null,
        )
      } catch {
        resolve(null)
      }
    })
  })
}

export const FOCUS_LOGIN_FIELD = `(() => {
  const what = %WHAT%
  const visible = (el) => el.offsetParent !== null && !el.disabled && !el.readOnly
  const active = document.activeElement
  const typing = active instanceof HTMLInputElement && visible(active)
  const password = [...document.querySelectorAll('input[type=password]')].find(visible)
  if (what === 'password') {
    if (typing && active.type === 'password') return true
    if (password) { password.focus(); return true }
    return typing
  }
  if (typing && active.type !== 'password') return true
  const scope = password?.form ?? document
  const fields = [...scope.querySelectorAll('input')].filter(
    (el) => visible(el) && /^(text|email|tel|)$/.test(el.type) && (!password || (el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING))
  )
  const user =
    fields.find((el) => /user|email|login|account/i.test(el.name + el.id + el.autocomplete)) ?? fields.at(-1)
  if (user) { user.focus(); return true }
  if (password) { password.focus(); return true }
  return typing
})()`

export function focusScript(what: 'login' | 'username' | 'password'): string {
  return FOCUS_LOGIN_FIELD.replace('%WHAT%', JSON.stringify(what))
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

export function parseStatus(raw: Record<string, unknown> | null): PasswordStatus {
  if (raw === null) return NOT_FOUND
  return {
    ok: raw.ok === true,
    provider: text(raw.label) || text(raw.provider),
    ready: raw.ready === true,
    error: raw.ok === true ? null : text(raw.error) || 'The password manager did not answer',
    hint: text(raw.hint) || null,
  }
}

export function parseItems(raw: Record<string, unknown> | null): PasswordItem[] {
  const items = raw?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((value): PasswordItem[] => {
    if (typeof value !== 'object' || value === null) return []
    const v = value as Record<string, unknown>
    const id = text(v.id)
    if (id === '') return []
    return [
      {
        id,
        title: text(v.title) || id,
        username: text(v.username),
        host: text(v.host),
        score: typeof v.score === 'number' ? v.score : 0,
      },
    ]
  })
}

export async function passwordStatus(): Promise<PasswordStatus> {
  return parseStatus(await run(['status'], 10_000))
}

export async function matchPasswords(
  host: string,
  query: string,
): Promise<{ status: PasswordStatus; items: PasswordItem[] }> {
  const status = await passwordStatus()
  if (!status.ok) return { status, items: [] }
  const args = ['match', '--class', 'ewe-browser', '--title', host, '--limit', '40']
  if (query.trim() !== '') args.push('--query', query.trim())
  const raw = await run(args, 200_000)
  if (raw !== null && raw.ok === false) return { status: parseStatus(raw), items: [] }
  return { status, items: parseItems(raw) }
}

export async function fillPassword(
  id: string,
  what: 'login' | 'username' | 'password',
): Promise<string | null> {
  const raw = await run(['fill', id, '--pid', String(process.pid), '--what', what], 200_000)
  if (raw === null) return 'The password manager did not answer'
  return raw.ok === true ? null : text(raw.error) || 'Could not fill'
}

export async function copyPassword(
  id: string,
  what: 'username' | 'password',
): Promise<string | null> {
  const raw = await run(['copy', id, '--what', what], 200_000)
  if (raw === null) return 'The password manager did not answer'
  return raw.ok === true ? null : text(raw.error) || 'Could not copy'
}
