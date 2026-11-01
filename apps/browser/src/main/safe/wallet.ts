import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  IPC,
  type SafeAddress,
  type SafeAddressFill,
  type SafeCard,
  type SafeCardFill,
  type SafeMenu,
  type SafeMenuState,
  type SafeSettings,
  type SafeWalletFill,
  type SafeWalletKind,
} from '@ewe/shared'
import { parseLine, type SafeClient, type SafeReply } from './client'
import { displayHost, siteOf } from './site'

export interface WalletRef {
  contentsId: number
  processId: number
  routingId: number
  origin: string
}

export interface WalletTarget {
  send(channel: string, value: unknown): void
  focus(): void
}

export interface WalletDeps {
  client: SafeClient
  settings(): SafeSettings
  cli(): string | null
  state(): Promise<SafeMenuState>
  resolve(ref: WalletRef): WalletTarget | null
}

export interface WalletOutcome {
  ok: boolean
  message: string
}

interface WalletRequest extends WalletRef {
  kind: SafeWalletKind
  offered: Map<string, string>
  created: number
}

const LIST_TIMEOUT_MS = 5_000
const FIELDS_TIMEOUT_MS = 10_000
const CONFIRM_TIMEOUT_MS = 300_000
const REQUEST_TTL_MS = 120_000
const MENU_LIMIT = 30
const TEXT_MAX = 1024

const BRANDS = new Set([
  'visa',
  'mastercard',
  'amex',
  'discover',
  'jcb',
  'unionpay',
  'diners',
  'maestro',
  'mir',
  'other',
])

const PAGE_CHANGED: WalletOutcome = { ok: false, message: 'The page changed. Try again.' }
const NOT_FILLED: WalletOutcome = { ok: false, message: 'ewe Safe did not fill the card.' }

const text = (v: unknown, max = TEXT_MAX): string => (typeof v === 'string' ? v.slice(0, max) : '')

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

export function cardOriginOk(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  const host = url.hostname.toLowerCase()
  return url.protocol === 'http:' && (host === 'localhost' || host.endsWith('.localhost'))
}

function itemsOf(reply: SafeReply, kind: SafeWalletKind): Record<string, unknown>[] {
  const items = reply.items
  if (!Array.isArray(items)) return []
  return items.flatMap((value) => {
    const v = record(value)
    return v !== null && v.kind === kind && text(v.id) !== '' ? [v] : []
  })
}

export function parseCards(reply: SafeReply): SafeCard[] {
  return itemsOf(reply, 'card').map((v) => {
    const card = record(v.card) ?? {}
    const brand = text(card.brand).toLowerCase()
    const last4 = text(card.last4)
    const expiry = text(card.expiry)
    return {
      id: text(v.id),
      title: text(v.title, 200),
      brand: BRANDS.has(brand) ? brand : 'other',
      last4: /^\d{1,4}$/.test(last4) ? last4 : '',
      expiry: /^\d{2}\/\d{4}$/.test(expiry) ? expiry : '',
      holder: text(card.holder, 200),
    }
  })
}

export function parseAddresses(reply: SafeReply): SafeAddress[] {
  return itemsOf(reply, 'address').map((v) => {
    const a = record(v.address) ?? {}
    return {
      id: text(v.id),
      title: text(v.title, 200),
      name: text(a.name, 200),
      line1: text(a.line1, 200),
      city: text(a.city, 200),
      country: text(a.country, 64),
    }
  })
}

export function cardFill(value: unknown): SafeCardFill | null {
  const f = record(value)
  if (f === null) return null
  const number = text(f.number).replace(/[\s-]/g, '')
  if (!/^\d{8,19}$/.test(number)) return null
  const month = text(f.expiry_month).trim()
  const year = text(f.expiry_year).trim()
  const expiryMonth = /^\d{1,2}$/.test(month) ? month.padStart(2, '0') : ''
  const expiryYear = /^\d{4}$/.test(year) ? year : /^\d{2}$/.test(year) ? `20${year}` : ''
  return {
    holder: text(f.holder),
    number,
    expiryMonth,
    expiryYear,
    securityCode: text(f.security_code).replace(/\s/g, ''),
    brand: text(f.brand).toLowerCase(),
  }
}

export function addressFill(value: unknown): SafeAddressFill | null {
  const f = record(value)
  if (f === null) return null
  return {
    fullName: text(f.full_name),
    givenName: text(f.given_name),
    familyName: text(f.family_name),
    organization: text(f.organization),
    line1: text(f.line1),
    line2: text(f.line2),
    city: text(f.city),
    region: text(f.region),
    postalCode: text(f.postal_code),
    country: text(f.country),
    phone: text(f.phone),
    email: text(f.email),
  }
}

export class SafeWallet {
  private readonly deps: WalletDeps
  private readonly requests = new Map<string, WalletRequest>()
  private confirming: Promise<boolean> | null = null

  constructor(deps: WalletDeps) {
    this.deps = deps
  }

  clear(): void {
    this.requests.clear()
  }

  has(requestId: string): boolean {
    return this.requests.has(requestId)
  }

  refOf(requestId: string): WalletRef | null {
    this.prune()
    return this.requests.get(requestId) ?? null
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, r] of this.requests)
      if (now - r.created > REQUEST_TTL_MS) this.requests.delete(id)
  }

  enabled(kind: SafeWalletKind): boolean {
    const s = this.deps.settings()
    return s.fill && (kind === 'card' ? s.fillCards : s.fillAddresses)
  }

  async menu(ref: WalletRef, kind: SafeWalletKind): Promise<SafeMenu> {
    this.prune()
    const requestId = randomUUID()
    const site = siteOf(ref.origin)
    const menu: SafeMenu = {
      requestId,
      kind,
      field: kind === 'address' ? 'username' : 'code',
      state: 'unavailable',
      host: site === null ? '' : displayHost(site),
      favicon: null,
      items: [],
      passkeys: [],
      cards: [],
      addresses: [],
    }
    if (site === null || !this.enabled(kind)) return menu
    menu.state = await this.deps.state()
    const offered = new Map<string, string>()
    if (menu.state === 'ready') {
      if (kind === 'card' && !cardOriginOk(ref.origin)) {
        menu.state = 'empty'
        menu.insecure = true
      } else {
        const reply = await this.deps.client.call('list', { kind }, LIST_TIMEOUT_MS)
        if (!reply.ok) menu.state = reply.error === 'locked' ? 'locked' : 'empty'
        else {
          if (kind === 'card') {
            const cards = parseCards(reply).slice(0, MENU_LIMIT)
            menu.cards = cards
            for (const c of cards) offered.set(c.id, c.title)
          } else {
            const addresses = parseAddresses(reply).slice(0, MENU_LIMIT)
            menu.addresses = addresses
            for (const a of addresses) offered.set(a.id, a.title)
          }
          if (offered.size === 0) menu.state = 'empty'
        }
      }
    }
    this.requests.set(requestId, { ...ref, kind, offered, created: Date.now() })
    return menu
  }

  private fields(id: string): Promise<SafeReply> {
    return this.deps.client.call('fields', { item_id: id }, FIELDS_TIMEOUT_MS)
  }

  private confirm(reason: string): Promise<boolean> {
    if (this.confirming !== null) return this.confirming
    const cli = this.deps.cli()
    if (cli === null) return Promise.resolve(false)
    const run = new Promise<boolean>((resolve) => {
      execFile(
        cli,
        ['confirm', '--ask', '--reason', reason],
        { timeout: CONFIRM_TIMEOUT_MS, encoding: 'utf8' },
        (_error, stdout) => {
          const value = parseLine(stdout.trim().split('\n').pop() ?? '')
          resolve(value?.ok === true)
        },
      )
    })
    this.confirming = run
    void run.finally(() => {
      if (this.confirming === run) this.confirming = null
    })
    return run
  }

  async choose(requestId: string, id: string): Promise<WalletOutcome | null> {
    this.prune()
    const r = this.requests.get(requestId)
    if (r === undefined) return PAGE_CHANGED
    const title = r.offered.get(id)
    if (title === undefined) return { ok: false, message: 'That item is not offered here.' }
    if (this.deps.resolve(r) === null) return PAGE_CHANGED
    if (r.kind === 'card' && !cardOriginOk(r.origin))
      return { ok: false, message: 'ewe Safe fills cards only on secure (https) pages.' }
    this.requests.delete(requestId)
    let reply = await this.fields(id)
    if (!reply.ok && reply.error === 'confirm-needed') {
      const site = siteOf(r.origin)
      const host = site === null ? r.origin : displayHost(site)
      if (!(await this.confirm(`Fill ${title} on ${host}`))) return NOT_FILLED
      reply = await this.fields(id)
    }
    if (!reply.ok) {
      if (reply.error === 'locked') return { ok: false, message: 'ewe Safe is locked.' }
      if (r.kind === 'card') return NOT_FILLED
      return { ok: false, message: 'ewe Safe could not open that address.' }
    }
    let fill: SafeWalletFill | null = null
    if (r.kind === 'card') {
      const card = cardFill(reply.fields)
      if (card !== null) fill = { kind: 'card', card }
    } else {
      const address = addressFill(reply.fields)
      if (address !== null) fill = { kind: 'address', address }
    }
    if (fill === null) return r.kind === 'card' ? NOT_FILLED : PAGE_CHANGED
    const target = this.deps.resolve(r)
    if (target === null) return PAGE_CHANGED
    target.send(IPC.safeWalletFill, fill)
    target.focus()
    return null
  }
}
