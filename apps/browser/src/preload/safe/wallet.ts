import type { SafeAddressFill, SafeCardFill, SafeWalletKind } from '@ewe/shared'
import type { Visible } from './forms'

export type CardPart =
  'name' | 'given' | 'family' | 'number' | 'exp' | 'exp-month' | 'exp-year' | 'csc' | 'type'

export type AddressPart =
  | 'name'
  | 'given'
  | 'family'
  | 'organization'
  | 'street'
  | 'line1'
  | 'line2'
  | 'city'
  | 'region'
  | 'postal'
  | 'country'
  | 'country-name'
  | 'tel'
  | 'email'

export type WalletEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

export type WalletField =
  | { el: WalletEl; kind: 'card'; part: CardPart; section: string; auto: boolean }
  | { el: WalletEl; kind: 'address'; part: AddressPart; section: string; auto: boolean }

const CARD_TOKENS: Record<string, CardPart> = {
  'cc-name': 'name',
  'cc-given-name': 'given',
  'cc-family-name': 'family',
  'cc-number': 'number',
  'cc-exp': 'exp',
  'cc-exp-month': 'exp-month',
  'cc-exp-year': 'exp-year',
  'cc-csc': 'csc',
  'cc-type': 'type',
}

const ADDRESS_TOKENS: Record<string, AddressPart> = {
  name: 'name',
  'given-name': 'given',
  'family-name': 'family',
  organization: 'organization',
  'street-address': 'street',
  'address-line1': 'line1',
  'address-line2': 'line2',
  'address-level2': 'city',
  'address-level1': 'region',
  'postal-code': 'postal',
  country: 'country',
  'country-name': 'country-name',
  tel: 'tel',
  email: 'email',
}

const CARD_PATTERNS: [CardPart, RegExp][] = [
  [
    'csc',
    /\bcvc|\bcvv|\bcsc\b|\bcvn\b|security.?code|card.?verification|verification.?(code|number|value)/i,
  ],
  ['exp-month', /(exp\w*|valid)\W{0,3}(month|mm\b|mon\b)|card.?month|cc.?month/i],
  ['exp-year', /(exp\w*|valid)\W{0,3}(year|yy(yy)?\b)|card.?year|cc.?year/i],
  ['exp', /exp(iry|iration)?\W?date|expir|\bexp\b|\bmm\s?\/\s?yy|valid.?(thru|through|until)/i],
  ['type', /card.?type|cc.?type|card.?brand/i],
  ['name', /name.?on.?card|card.?holder|holder.?name|cc.?name|card.?name/i],
  [
    'number',
    /card.?num|cc.?num|credit.?card|debit.?card|card.?no\b|ccnum|kartennummer|tarjeta|num[eé]ro.?de.?carte/i,
  ],
]

const ADDRESS_PATTERNS: [AddressPart, RegExp][] = [
  ['email', /e-?mail/i],
  ['tel', /phone|mobile|\btel\b|telephone/i],
  ['line2', /address.?(line)?.?2|addr(ess)?.?2\b|apartment|\bapt\b|suite|\bunit\b/i],
  ['line1', /address.?(line)?.?1|addr(ess)?.?1\b|street|^address$|^addr$/i],
  ['postal', /\bzip|postal|post.?code|postcode|\bplz\b/i],
  ['city', /\bcity\b|\btown\b|locality|suburb/i],
  ['region', /\bstate\b|province|\bregion\b|county|prefecture/i],
  ['country', /country/i],
  ['organization', /company|organi[sz]ation|business.?name/i],
  ['given', /first.?name|given.?name|\bfname\b|forename/i],
  ['family', /last.?name|family.?name|surname|\blname\b/i],
  ['name', /full.?name|^name$|^your.?name$/i],
]

const CORE = new Set<string>([
  'street',
  'line1',
  'city',
  'region',
  'postal',
  'country',
  'country-name',
])
const INPUT_TYPES = new Set(['text', 'tel', 'number', 'email', '', 'month', 'password'])

const BRAND_NAMES: Record<string, string[]> = {
  visa: ['visa'],
  mastercard: ['mastercard', 'master card', 'mc'],
  amex: ['amex', 'american express', 'americanexpress'],
  discover: ['discover'],
  jcb: ['jcb'],
  unionpay: ['unionpay', 'union pay', 'china unionpay'],
  diners: ['diners', 'diners club', 'dinersclub'],
  maestro: ['maestro'],
  mir: ['mir'],
}

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  diners: 'Diners Club',
  maestro: 'Maestro',
  mir: 'Mir',
}

export function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function labelsOf(el: WalletEl): string {
  return Array.from(el.labels ?? [])
    .map((l) => l.textContent ?? '')
    .join(' ')
}

function hintParts(el: WalletEl): string[] {
  const placeholder = el instanceof HTMLSelectElement ? '' : el.placeholder
  return [el.name, el.id, placeholder, el.getAttribute('aria-label') ?? '', labelsOf(el)]
    .map((t) =>
      t
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/_+/g, ' ')
        .trim(),
    )
    .filter((t) => t !== '')
}

function tokens(el: WalletEl): { field: string | null; section: string } {
  const list = (el.getAttribute('autocomplete') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '' && t !== 'webauthn')
  const field = list.at(-1) ?? null
  const section = list
    .slice(0, -1)
    .filter((t) => t.startsWith('section-') || t === 'shipping' || t === 'billing')
    .join(' ')
  return { field, section }
}

function usable(el: WalletEl): boolean {
  if (el.disabled) return false
  if (el instanceof HTMLSelectElement) return true
  if (el.readOnly) return false
  if (el instanceof HTMLTextAreaElement) return true
  return INPUT_TYPES.has(el.type)
}

function matchPattern<T extends string>(parts: string[], table: [T, RegExp][]): T | null {
  for (const [part, re] of table) if (parts.some((p) => re.test(p))) return part
  return null
}

export function walletFieldOf(el: WalletEl): WalletField | null {
  if (!usable(el)) return null
  const { field, section } = tokens(el)
  if (field !== null) {
    const card = CARD_TOKENS[field]
    if (card !== undefined) return { el, kind: 'card', part: card, section, auto: true }
    const address = ADDRESS_TOKENS[field]
    if (address !== undefined) {
      if (el instanceof HTMLInputElement && el.type === 'password') return null
      return { el, kind: 'address', part: address, section, auto: true }
    }
  }
  const parts = hintParts(el)
  const card = matchPattern(parts, CARD_PATTERNS)
  if (card !== null) return { el, kind: 'card', part: card, section, auto: false }
  if (el instanceof HTMLInputElement && el.type === 'password') return null
  const address = matchPattern(parts, ADDRESS_PATTERNS)
  if (address !== null) return { el, kind: 'address', part: address, section, auto: false }
  if (el instanceof HTMLInputElement && el.type === 'email')
    return { el, kind: 'address', part: 'email', section, auto: false }
  if (el instanceof HTMLInputElement && el.type === 'tel')
    return { el, kind: 'address', part: 'tel', section, auto: false }
  return null
}

function scopeFor(el: WalletEl): ParentNode {
  return el.form ?? el.ownerDocument
}

export function relatedFields(anchor: WalletEl, visible: Visible): WalletField[] {
  const own = walletFieldOf(anchor)
  if (own === null) return []
  const out: WalletField[] = []
  for (const el of Array.from(
    scopeFor(anchor).querySelectorAll<WalletEl>('input, select, textarea'),
  )) {
    const f: WalletField | null = el === anchor ? own : walletFieldOf(el)
    if (f?.kind !== own.kind || f.section !== own.section) continue
    if (el !== anchor && !visible(el)) continue
    out.push(f)
  }
  return out
}

function cardForm(own: WalletField, related: WalletField[]): boolean {
  if (own.auto || own.part === 'number') return true
  return related.some((f) => f.el !== own.el && (f.auto || f.part === 'number'))
}

function addressForm(related: WalletField[]): boolean {
  const all = new Set(related.map((f) => f.part))
  const tagged = new Set(related.filter((f) => f.auto).map((f) => f.part))
  const core = (set: Set<string>) => [...set].some((p) => CORE.has(p))
  return (all.size >= 3 && core(all)) || (tagged.size >= 2 && core(tagged))
}

export function walletKindOf(el: HTMLInputElement, visible: Visible): SafeWalletKind | null {
  const own = walletFieldOf(el)
  if (own === null) return null
  const related = relatedFields(el, visible)
  if (own.kind === 'card') return cardForm(own, related) ? 'card' : null
  return addressForm(related) ? 'address' : null
}

function fit(el: HTMLInputElement | HTMLTextAreaElement, value: string): string {
  return el.maxLength > 0 ? value.slice(0, el.maxLength) : value
}

function setText(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  if (!Reflect.set(proto, 'value', value, el)) el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function setSelect(el: HTMLSelectElement, index: number): void {
  if (el.selectedIndex === index) return
  if (!Reflect.set(HTMLSelectElement.prototype, 'selectedIndex', index, el))
    el.selectedIndex = index
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

export function optionIndex(el: HTMLSelectElement, candidates: string[]): number {
  const wanted = new Set(candidates.map(norm).filter((c) => c !== ''))
  if (wanted.size === 0) return -1
  const options = Array.from(el.options)
  return options.findIndex(
    (o) => !o.disabled && (wanted.has(norm(o.value)) || wanted.has(norm(o.text))),
  )
}

function pageLanguages(doc: Document): string[] {
  const langs = [doc.documentElement.lang, navigator.language, 'en'].filter(
    (l): l is string => typeof l === 'string' && l !== '',
  )
  return [...new Set(langs)]
}

function monthNames(doc: Document, month: number): string[] {
  const out: string[] = []
  const date = new Date(Date.UTC(2000, month - 1, 15))
  for (const lang of pageLanguages(doc)) {
    for (const style of ['long', 'short'] as const) {
      try {
        out.push(new Intl.DateTimeFormat(lang, { month: style, timeZone: 'UTC' }).format(date))
      } catch {
        continue
      }
    }
  }
  return out
}

export function monthIndex(el: HTMLSelectElement, month: number): number {
  const names = new Set(monthNames(el.ownerDocument, month).map(norm))
  const numberOf = (text: string): number | null => {
    const m = /^\s*0?(\d{1,2})(\D|$)/.exec(text)
    return m === null ? null : Number(m[1])
  }
  return Array.from(el.options).findIndex((o) => {
    if (o.disabled) return false
    if (/^\s*\d{1,2}\s*$/.test(o.value)) return Number(o.value) === month
    if (numberOf(o.text) === month) return true
    return names.has(norm(o.text)) || names.has(norm(o.value))
  })
}

export function countryNames(doc: Document, code: string): string[] {
  const upper = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return code.trim() === '' ? [] : [code.trim()]
  const out = [upper]
  for (const lang of pageLanguages(doc)) {
    try {
      const name = new Intl.DisplayNames([lang], { type: 'region' }).of(upper)
      if (name !== undefined && name !== upper) out.push(name)
    } catch {
      continue
    }
  }
  return out
}

function countryText(
  el: HTMLInputElement | HTMLTextAreaElement,
  code: string,
  name: boolean,
): string {
  const names = countryNames(el.ownerDocument, code)
  const short = el.maxLength > 0 && el.maxLength <= 3
  if (!name && short) return names[0] ?? ''
  return names[1] ?? names[0] ?? ''
}

function hintsOf(el: HTMLInputElement): string {
  return [
    el.placeholder,
    el.getAttribute('aria-label') ?? '',
    el.name,
    el.id,
    labelsOf(el),
    el.getAttribute('pattern') ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

export function expiryText(el: HTMLInputElement, month: string, year: string): string {
  if (el.type === 'month') return `${year}-${month}`
  const text = hintsOf(el)
  const max = el.maxLength > 0 ? el.maxLength : 0
  let long: boolean
  if (/yyyy|aaaa|jjjj/.test(text)) long = true
  else if (/mm\s*[/-]?\s*(yy|aa|jj)\b|\b(yy|aa|jj)\b/.test(text)) long = false
  else long = max === 6 || max >= 7
  const sepMatch = /mm(\s*[/-]\s*|)(yy|aa|jj)/.exec(text)
  let sep = sepMatch !== null ? (sepMatch[1] ?? '/') : max === 4 || max === 6 ? '' : '/'
  const yy = long ? year : year.slice(-2)
  let out = `${month}${sep}${yy}`
  if (max > 0 && out.length > max) {
    sep = sep.trim()
    out = `${month}${sep}${yy}`
    if (out.length > max) out = `${month}${yy}`
  }
  return out
}

function formatNumber(el: HTMLInputElement, digits: string): string {
  const m = /\d{4}([ -])\d{4}/.exec(el.placeholder)
  const grouped = m === null ? digits : (digits.match(/.{1,4}/g) ?? []).join(m[1] ?? ' ')
  if (el.maxLength > 0 && grouped.length > el.maxLength) return digits.slice(0, el.maxLength)
  return grouped
}

function splitName(full: string): { given: string; family: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return { given: parts[0] ?? '', family: '' }
  return { given: parts.slice(0, -1).join(' '), family: parts.at(-1) ?? '' }
}

type Plan = { text: string } | { index: number } | null

function cardPlan(f: WalletField, card: SafeCardFill, numberText: string | null): Plan {
  const el = f.el
  const name = splitName(card.holder)
  if (el instanceof HTMLSelectElement) {
    if (f.part === 'exp-month') {
      const index = monthIndex(el, Number(card.expiryMonth))
      return index < 0 ? null : { index }
    }
    if (f.part === 'exp-year') {
      const index = optionIndex(el, [card.expiryYear, card.expiryYear.slice(-2)])
      return index < 0 ? null : { index }
    }
    if (f.part === 'type') {
      const index = optionIndex(el, BRAND_NAMES[card.brand] ?? [card.brand])
      return index < 0 ? null : { index }
    }
    if (f.part === 'exp' && card.expiryMonth !== '' && card.expiryYear !== '') {
      const m = card.expiryMonth
      const index = optionIndex(el, [
        `${m}/${card.expiryYear.slice(-2)}`,
        `${m}/${card.expiryYear}`,
      ])
      return index < 0 ? null : { index }
    }
    return null
  }
  switch (f.part) {
    case 'name':
      return { text: card.holder }
    case 'given':
      return { text: name.given }
    case 'family':
      return { text: name.family }
    case 'number':
      return numberText === null ? null : { text: numberText }
    case 'exp':
      if (card.expiryMonth === '' || card.expiryYear === '') return null
      return el instanceof HTMLInputElement
        ? { text: expiryText(el, card.expiryMonth, card.expiryYear) }
        : null
    case 'exp-month':
      return { text: card.expiryMonth }
    case 'exp-year':
      return { text: el.maxLength === 2 ? card.expiryYear.slice(-2) : card.expiryYear }
    case 'csc':
      return { text: card.securityCode }
    case 'type':
      return { text: BRAND_LABEL[card.brand] ?? '' }
    default:
      return null
  }
}

function addressPlan(f: WalletField, a: SafeAddressFill): Plan {
  const el = f.el
  const split = splitName(a.fullName)
  const full = a.fullName !== '' ? a.fullName : `${a.givenName} ${a.familyName}`.trim()
  if (el instanceof HTMLSelectElement) {
    const country = f.part === 'country' || f.part === 'country-name'
    if (!country && f.part !== 'region') return null
    const candidates = country ? countryNames(el.ownerDocument, a.country) : [a.region]
    const index = optionIndex(el, candidates)
    return index < 0 ? null : { index }
  }
  switch (f.part) {
    case 'name':
      return { text: full }
    case 'given':
      return { text: a.givenName !== '' ? a.givenName : split.given }
    case 'family':
      return { text: a.familyName !== '' ? a.familyName : split.family }
    case 'organization':
      return { text: a.organization }
    case 'street': {
      const lines = [a.line1, a.line2].filter((l) => l !== '')
      return { text: lines.join(el instanceof HTMLTextAreaElement ? '\n' : ', ') }
    }
    case 'line1':
      return { text: a.line1 }
    case 'line2':
      return { text: a.line2 }
    case 'city':
      return { text: a.city }
    case 'region':
      return { text: a.region }
    case 'postal':
      return { text: a.postalCode }
    case 'country':
      return { text: countryText(el, a.country, false) }
    case 'country-name':
      return { text: countryText(el, a.country, true) }
    case 'tel':
      return { text: a.phone }
    case 'email':
      return { text: a.email }
    default:
      return null
  }
}

function apply(f: WalletField, plan: Plan, anchor: WalletEl): boolean {
  if (plan === null) return false
  const el = f.el
  if ('index' in plan) {
    if (!(el instanceof HTMLSelectElement)) return false
    setSelect(el, plan.index)
    return true
  }
  if (el instanceof HTMLSelectElement || plan.text === '') return false
  if (el !== anchor && el.value !== '') return false
  setText(el, fit(el, plan.text))
  return true
}

export function fillCard(anchor: HTMLInputElement, card: SafeCardFill, visible: Visible): number {
  const fields = relatedFields(anchor, visible)
  if (fields[0]?.kind !== 'card') return 0
  const numbers = fields.filter((f) => f.part === 'number' && !(f.el instanceof HTMLSelectElement))
  const numberText = new Map<WalletEl, string>()
  if (numbers.length > 1) {
    let rest = card.number
    for (const f of numbers) {
      const max = f.el instanceof HTMLSelectElement ? 0 : f.el.maxLength
      const size = max > 0 ? max : 4
      numberText.set(f.el, rest.slice(0, size))
      rest = rest.slice(size)
    }
  } else if (numbers[0] !== undefined && numbers[0].el instanceof HTMLInputElement) {
    numberText.set(numbers[0].el, formatNumber(numbers[0].el, card.number))
  }
  let filled = 0
  for (const f of fields) {
    if (apply(f, cardPlan(f, card, numberText.get(f.el) ?? null), anchor)) filled++
  }
  return filled
}

export function fillAddress(
  anchor: HTMLInputElement,
  address: SafeAddressFill,
  visible: Visible,
): number {
  const fields = relatedFields(anchor, visible)
  if (fields[0]?.kind !== 'address') return 0
  let filled = 0
  for (const f of fields) if (apply(f, addressPlan(f, address), anchor)) filled++
  return filled
}
