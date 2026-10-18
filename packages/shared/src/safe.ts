import type { Rect } from './models'

export type SafeFieldKind = 'login' | 'new-password' | 'otp'
export type SafeWalletKind = 'card' | 'address'
export type SafeListKind = SafeFieldKind | SafeWalletKind
export type SafeCaptureKind = 'login' | 'signup' | 'change'
export type SafeField = 'username' | 'password' | 'code'
export type SafeMenuState = 'ready' | 'empty' | 'locked' | 'not-set-up' | 'unavailable'
export type SafePromptMode = 'save' | 'update'
export type SafePromptAction = 'save' | 'update' | 'never' | 'dismiss' | 'unlock'
export type SafeTrigger = 'icon' | 'click' | 'key' | 'focus'
export type SafeSuggestKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape'

export interface SafeLogin {
  id: string
  title: string
  username: string
  host: string
}

export interface SafePasskey {
  credentialId: string
  title: string
  username: string
  rpId: string
}

export interface SafeCard {
  id: string
  title: string
  brand: string
  last4: string
  expiry: string
  holder: string
}

export interface SafeAddress {
  id: string
  title: string
  name: string
  line1: string
  city: string
  country: string
}

export interface SafeMenu {
  requestId: string
  kind: SafeListKind
  field: SafeField
  state: SafeMenuState
  host: string
  favicon: string | null
  items: SafeLogin[]
  passkeys: SafePasskey[]
  cards?: SafeCard[] | undefined
  addresses?: SafeAddress[] | undefined
  insecure?: boolean | undefined
}

export interface SafeSuggestState {
  open: boolean
  visible: boolean
  selected: boolean
}

export interface SafePrompt {
  promptId: string
  mode: SafePromptMode
  host: string
  username: string
  title: string
  locked: boolean
}

export type SafeSheetMode = 'create' | 'get'
export type SafeSheetState = 'ready' | 'locked' | 'empty'
export type SafeSheetAction = 'save' | 'pick' | 'native' | 'unlock' | 'cancel'

export interface SafeSheet {
  sheetId: string
  mode: SafeSheetMode
  state: SafeSheetState
  rpId: string
  userName: string
  displayName: string
  into: { title: string; username: string } | null
  passkeys: SafePasskey[]
}

export interface SafeSettings {
  fill: boolean
  suggest: boolean
  passkeys: boolean
  offerSave: boolean
  fillCards: boolean
  fillAddresses: boolean
  neverSave: string[]
}

export const DEFAULT_SAFE_SETTINGS: SafeSettings = {
  fill: true,
  suggest: true,
  passkeys: true,
  offerSave: true,
  fillCards: true,
  fillAddresses: true,
  neverSave: [],
}

export const SAFE_NEVER_SAVE_MAX = 500

export interface SafePageState {
  enabled: boolean
  suggest: boolean
  capture: boolean
  cards: boolean
  addresses: boolean
}

export interface SafeCardFill {
  holder: string
  number: string
  expiryMonth: string
  expiryYear: string
  securityCode: string
  brand: string
}

export interface SafeAddressFill {
  fullName: string
  givenName: string
  familyName: string
  organization: string
  line1: string
  line2: string
  city: string
  region: string
  postalCode: string
  country: string
  phone: string
  email: string
}

export type SafeWalletFill =
  { kind: 'card'; card: SafeCardFill } | { kind: 'address'; address: SafeAddressFill }

export interface SafeFill {
  kind: SafeFieldKind
  username?: string | undefined
  password?: string | undefined
  otp?: string | undefined
}

export type SafePageRequest =
  | { op: 'state' }
  | { op: 'open'; kind: SafeFieldKind; field: SafeField; rect: Rect | null; trigger: SafeTrigger }
  | { op: 'move'; rect: Rect | null }
  | { op: 'key'; key: SafeSuggestKey }
  | { op: 'filter'; text: string }
  | { op: 'blur' }
  | { op: 'focus' }
  | { op: 'close' }
  | { op: 'submit'; kind: SafeCaptureKind; username: string; password: string }
  | { op: 'wallet'; kind: SafeWalletKind; rect: Rect | null; trigger: SafeTrigger }
  | { op: 'username'; username: string }
  | { op: 'draft'; username: string; keep: boolean }

export type SafePasskeyRequest =
  | { op: 'available' }
  | { op: 'create'; id: string; origin: string; options: Record<string, unknown> }
  | { op: 'get'; id: string; origin: string; options: Record<string, unknown>; mediation: string }
  | { op: 'abort'; id: string }

export type SafePasskeyReply =
  | { ok: true; credential: Record<string, unknown> }
  | { ok: false; name: string; message: string }
  | { native: true }

const SAFE_TEXT_MAX = 1024
const REQUEST_ID_MAX = 64

export function isSafeFill(value: unknown): value is SafeFill {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const optional = (x: unknown) => x === undefined || (typeof x === 'string' && x.length <= 4096)
  return isSafeFieldKind(v.kind) && optional(v.username) && optional(v.password) && optional(v.otp)
}

export function isSafePageState(value: unknown): value is SafePageState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.enabled === 'boolean' &&
    typeof v.suggest === 'boolean' &&
    typeof v.capture === 'boolean' &&
    typeof v.cards === 'boolean' &&
    typeof v.addresses === 'boolean'
  )
}

const CARD_FILL_KEYS = [
  'holder',
  'number',
  'expiryMonth',
  'expiryYear',
  'securityCode',
  'brand',
] as const
const ADDRESS_FILL_KEYS = [
  'fullName',
  'givenName',
  'familyName',
  'organization',
  'line1',
  'line2',
  'city',
  'region',
  'postalCode',
  'country',
  'phone',
  'email',
] as const

function hasTexts(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return keys.every((k) => typeof v[k] === 'string' && v[k].length <= SAFE_TEXT_MAX)
}

export function isSafeWalletFill(value: unknown): value is SafeWalletFill {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.kind === 'card') return hasTexts(v.card, CARD_FILL_KEYS)
  if (v.kind === 'address') return hasTexts(v.address, ADDRESS_FILL_KEYS)
  return false
}

export function isSafeWalletKind(value: unknown): value is SafeWalletKind {
  return value === 'card' || value === 'address'
}

export function isSafeSuggestState(value: unknown): value is SafeSuggestState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.open === 'boolean' && typeof v.visible === 'boolean' && typeof v.selected === 'boolean'
  )
}

const FIELD_KINDS = new Set<string>(['login', 'new-password', 'otp'])
const FIELDS = new Set<string>(['username', 'password', 'code'])
const TRIGGERS = new Set<string>(['icon', 'click', 'key', 'focus'])
const SUGGEST_KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'Enter', 'Escape'])
const SHEET_ACTIONS = new Set<string>(['save', 'pick', 'native', 'unlock', 'cancel'])

function isRectLike(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  )
}

function isShortText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SAFE_TEXT_MAX
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= REQUEST_ID_MAX
}

export function isSafeFieldKind(value: unknown): value is SafeFieldKind {
  return typeof value === 'string' && FIELD_KINDS.has(value)
}

export function isSafePromptAction(value: unknown): value is SafePromptAction {
  return (
    value === 'save' ||
    value === 'update' ||
    value === 'never' ||
    value === 'dismiss' ||
    value === 'unlock'
  )
}

export function isSafeSheetAction(value: unknown): value is SafeSheetAction {
  return typeof value === 'string' && SHEET_ACTIONS.has(value)
}

export function isSafePageRequest(value: unknown): value is SafePageRequest {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  switch (r.op) {
    case 'state':
    case 'blur':
    case 'focus':
    case 'close':
      return true
    case 'open':
      return (
        isSafeFieldKind(r.kind) &&
        typeof r.field === 'string' &&
        FIELDS.has(r.field) &&
        (r.rect === null || isRectLike(r.rect)) &&
        typeof r.trigger === 'string' &&
        TRIGGERS.has(r.trigger)
      )
    case 'move':
      return r.rect === null || isRectLike(r.rect)
    case 'key':
      return typeof r.key === 'string' && SUGGEST_KEYS.has(r.key)
    case 'filter':
      return isShortText(r.text)
    case 'submit':
      return (
        (r.kind === 'login' || r.kind === 'signup' || r.kind === 'change') &&
        isShortText(r.username) &&
        isShortText(r.password) &&
        r.password !== ''
      )
    case 'wallet':
      return (
        isSafeWalletKind(r.kind) &&
        (r.rect === null || isRectLike(r.rect)) &&
        typeof r.trigger === 'string' &&
        TRIGGERS.has(r.trigger)
      )
    case 'username':
      return isShortText(r.username) && r.username.trim() !== ''
    case 'draft':
      return isShortText(r.username) && typeof r.keep === 'boolean'
    default:
      return false
  }
}

export function isSafePasskeyRequest(value: unknown): value is SafePasskeyRequest {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  const options = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x)
  switch (r.op) {
    case 'available':
      return true
    case 'abort':
      return isRequestId(r.id)
    case 'create':
      return isRequestId(r.id) && isShortText(r.origin) && options(r.options)
    case 'get':
      return (
        isRequestId(r.id) && isShortText(r.origin) && options(r.options) && isShortText(r.mediation)
      )
    default:
      return false
  }
}

export function siteHostOf(input: string): string | null {
  const text = input.trim().toLowerCase()
  if (text === '') return null
  let host = text
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    try {
      host = new URL(text).hostname
    } catch {
      return null
    }
  }
  host = host.replace(/\.$/, '')
  if (host.length > 253 || !/^[a-z0-9.\-[\]:]+$/.test(host)) return null
  return host.startsWith('www.') ? host.slice(4) : host
}

export function sanitizeSafeSettings(value: unknown, base: SafeSettings): SafeSettings {
  if (typeof value !== 'object' || value === null) return base
  const v = value as Record<string, unknown>
  const next: SafeSettings = { ...base, neverSave: [...base.neverSave] }
  if (typeof v.fill === 'boolean') next.fill = v.fill
  if (typeof v.suggest === 'boolean') next.suggest = v.suggest
  if (typeof v.passkeys === 'boolean') next.passkeys = v.passkeys
  if (typeof v.offerSave === 'boolean') next.offerSave = v.offerSave
  if (typeof v.fillCards === 'boolean') next.fillCards = v.fillCards
  if (typeof v.fillAddresses === 'boolean') next.fillAddresses = v.fillAddresses
  if (Array.isArray(v.neverSave)) {
    const seen = new Set<string>()
    for (const entry of v.neverSave) {
      if (typeof entry !== 'string') continue
      const host = siteHostOf(entry)
      if (host === null || seen.has(host)) continue
      seen.add(host)
      if (seen.size > SAFE_NEVER_SAVE_MAX) break
    }
    next.neverSave = [...seen].slice(0, SAFE_NEVER_SAVE_MAX)
  }
  return next
}
