import type { SafeAddress, SafeCard, SafeLogin, SafeMenu, SafePasskey } from '@ewe/shared'
import type { IconName } from '../components/Icon'

export type SafeAction = 'open' | 'setup' | 'generate' | 'unlock'

export type SafeRow =
  | { kind: 'passkey'; key: string; title: string; sub: string; passkey: SafePasskey }
  | { kind: 'login'; key: string; title: string; sub: string; login: SafeLogin }
  | { kind: 'card'; key: string; title: string; sub: string; card: SafeCard }
  | { kind: 'address'; key: string; title: string; sub: string; address: SafeAddress }
  | { kind: 'action'; key: string; title: string; icon: IconName; action: SafeAction }
  | { kind: 'note'; key: string; title: string; icon: IconName }

export interface SafeRows {
  items: SafeRow[]
  footer: SafeRow[]
}

const open: SafeRow = {
  kind: 'action',
  key: 'safe-open',
  title: 'Open ewe Safe',
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
  title: 'Unlock ewe Safe',
  icon: 'lock',
  action: 'unlock',
}

const matches = (filter: string, ...texts: string[]): boolean =>
  filter === '' || texts.some((t) => t.toLowerCase().includes(filter))

export function selectable(row: SafeRow): boolean {
  return row.kind !== 'note'
}

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  diners: 'Diners Club',
  maestro: 'Maestro',
  mir: 'Mir',
}

export function cardTitle(card: SafeCard): string {
  const brand = BRAND_LABEL[card.brand] ?? 'Card'
  return card.last4 === '' ? card.title || brand : `${brand} •••• ${card.last4}`
}

export function cardSub(card: SafeCard): string {
  const m = /^(\d{2})\/\d{2}(\d{2})$/.exec(card.expiry)
  const expiry = m === null ? '' : `${m[1] ?? ''}/${m[2] ?? ''}`
  return [expiry, card.holder].filter((t) => t !== '').join(' · ')
}

function walletRows(menu: SafeMenu, filter: string): SafeRows {
  const card = menu.kind === 'card'
  const what = card ? 'cards' : 'addresses'
  switch (menu.state) {
    case 'unavailable':
      return {
        items: [],
        footer: [{ kind: 'note', key: 'safe-off', title: 'ewe Safe is not running', icon: 'lock' }],
      }
    case 'not-set-up':
      return {
        items: [],
        footer: [
          {
            kind: 'action',
            key: 'safe-setup',
            title: 'Set up ewe Safe',
            icon: 'key-round',
            action: 'setup',
          },
        ],
      }
    case 'locked':
      return { items: [], footer: [unlock] }
    case 'empty':
      if (menu.insecure === true)
        return {
          items: [],
          footer: [
            {
              kind: 'note',
              key: 'safe-insecure',
              title: 'ewe Safe fills cards only on secure (https) pages',
              icon: 'lock',
            },
          ],
        }
      return {
        items: [],
        footer: [
          {
            kind: 'note',
            key: 'safe-none',
            title: `No ${what} in ewe Safe`,
            icon: card ? 'credit-card' : 'map-pin',
          },
          open,
        ],
      }
    case 'ready': {
      const items: SafeRow[] = card
        ? (menu.cards ?? []).map((c) => ({
            kind: 'card',
            key: `card-${c.id}`,
            title: cardTitle(c),
            sub: cardSub(c),
            card: c,
          }))
        : (menu.addresses ?? [])
            .filter((a) => matches(filter, a.title, a.name, a.line1, a.city))
            .map((a) => ({
              kind: 'address',
              key: `address-${a.id}`,
              title: a.title === '' ? a.name : a.title,
              sub: [a.name, a.line1].filter((t) => t !== '').join(' · '),
              address: a,
            }))
      if (items.length === 0 && filter !== '') return { items: [], footer: [] }
      return { items, footer: [open] }
    }
  }
}

export function safeRows(menu: SafeMenu, filterText = ''): SafeRows {
  const filter = filterText.trim().toLowerCase()
  if (menu.kind === 'card' || menu.kind === 'address') return walletRows(menu, filter)
  switch (menu.state) {
    case 'unavailable':
      return {
        items: [],
        footer: [{ kind: 'note', key: 'safe-off', title: 'ewe Safe is not running', icon: 'lock' }],
      }
    case 'not-set-up':
      return {
        items: [],
        footer: [
          {
            kind: 'action',
            key: 'safe-setup',
            title: 'Set up ewe Safe',
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
