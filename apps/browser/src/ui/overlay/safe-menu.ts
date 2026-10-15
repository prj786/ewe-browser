import type { SafeLogin, SafeMenu, SafePasskey } from '@ewe/shared'
import type { IconName } from '../components/Icon'

export type SafeAction = 'open' | 'setup' | 'generate' | 'unlock'

export type SafeRow =
  | { kind: 'passkey'; key: string; title: string; sub: string; passkey: SafePasskey }
  | { kind: 'login'; key: string; title: string; sub: string; login: SafeLogin }
  | { kind: 'action'; key: string; title: string; icon: IconName; action: SafeAction }
  | { kind: 'note'; key: string; title: string; icon: IconName }

export interface SafeRows {
  items: SafeRow[]
  footer: SafeRow[]
}

const open: SafeRow = {
  kind: 'action',
  key: 'safe-open',
  title: 'Open Safe',
  icon: 'external-link',
  action: 'open',
}
const generate: SafeRow = {
  kind: 'action',
  key: 'safe-generate',
  title: 'Use a strong password',
  icon: 'sparkles',
  action: 'generate',
}
const unlock: SafeRow = {
  kind: 'action',
  key: 'safe-unlock',
  title: 'Unlock Safe',
  icon: 'lock',
  action: 'unlock',
}

const matches = (filter: string, ...texts: string[]): boolean =>
  filter === '' || texts.some((t) => t.toLowerCase().includes(filter))

export function selectable(row: SafeRow): boolean {
  return row.kind !== 'note'
}

export function safeRows(menu: SafeMenu, filterText = ''): SafeRows {
  const filter = filterText.trim().toLowerCase()
  switch (menu.state) {
    case 'unavailable':
      return {
        items: [],
        footer: [{ kind: 'note', key: 'safe-off', title: 'Safe is not running', icon: 'lock' }],
      }
    case 'not-set-up':
      return {
        items: [],
        footer: [
          {
            kind: 'action',
            key: 'safe-setup',
            title: 'Set up Safe',
            icon: 'key-round',
            action: 'setup',
          },
        ],
      }
    case 'locked':
      return { items: [], footer: menu.kind === 'new-password' ? [generate, unlock] : [unlock] }
    case 'empty':
      return {
        items: [],
        footer: [
          {
            kind: 'note',
            key: 'safe-none',
            title:
              menu.kind === 'otp'
                ? `No one-time codes for ${menu.host}`
                : `No logins for ${menu.host}`,
            icon: 'key-round',
          },
          open,
        ],
      }
    case 'ready': {
      if (menu.kind === 'new-password') return { items: [], footer: [generate, open] }
      const passkeys: SafeRow[] = menu.passkeys
        .filter((p) => matches(filter, p.title, p.username, p.rpId))
        .map((p) => ({
          kind: 'passkey',
          key: `passkey-${p.credentialId}`,
          title: p.username === '' ? p.title : p.username,
          sub: `Passkey · ${p.title}`,
          passkey: p,
        }))
      const logins: SafeRow[] = menu.items
        .filter((l) => matches(filter, l.title, l.username, l.host))
        .map((l) => ({
          kind: 'login',
          key: `login-${l.id}`,
          title: menu.kind === 'otp' ? `Code for ${l.title}` : l.title,
          sub: l.username === '' ? l.host : l.username,
          login: l,
        }))
      const items = [...passkeys, ...logins]
      if (items.length === 0 && filter !== '') return { items: [], footer: [] }
      return { items, footer: [open] }
    }
  }
}
