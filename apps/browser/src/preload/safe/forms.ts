import type { SafeCaptureKind, SafeFieldKind } from '@ewe/shared'

export type Visible = (el: HTMLElement) => boolean

const TEXT_TYPES = new Set(['text', 'email', 'tel', ''])
const OTP_TYPES = new Set(['text', 'tel', 'number', ''])
const USER_HINT = /user|e-?mail|login|account|identifier|phone|handle/i
const OTP_HINT =
  /one.?time|\botp\b|totp|2fa|mfa|two.?factor|verification.?code|verify.?code|auth.?code|security.?code|passcode|\bpin\b|token/i
const NEW_HINT = /new.?pass|confirm|repeat|retype|register|sign.?up|signup|create.?account|join/i
const SEARCH_HINT = /search|query|\bq\b/i
const SIGNUP_HINT =
  /register|registration|sign.?up|signup|create.?(an?.?|your.?)?account|join|get.?started|new.?account/i
const CARD_CODE_HINT = /\bcvc|\bcvv|\bcsc\b|\bcvn\b|security.?code|card.?verification|card.?code/i
const CARD_CODE_WORD = /\b(cvc|cvv|csc|cvn|cvc2|cvv2)\b/i

const hints = (el: HTMLInputElement): string =>
  [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label') ?? ''].join(' ')

export function scopeOf(el: HTMLInputElement): ParentNode {
  return el.form ?? el.ownerDocument
}

export function inputsIn(scope: ParentNode, visible: Visible): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll('input')).filter(
    (el) => !el.disabled && !el.readOnly && visible(el),
  )
}

export function passwordsIn(scope: ParentNode, visible: Visible): HTMLInputElement[] {
  return inputsIn(scope, visible).filter((el) => el.type === 'password' && !isCardCodeField(el))
}

function autocompleteHas(el: HTMLInputElement, token: string): boolean {
  return el.autocomplete.split(/\s+/).includes(token)
}

function tokensOf(el: Element): string[] {
  return (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

export function isCardCodeField(el: HTMLInputElement): boolean {
  const tokens = tokensOf(el)
  if (tokens.includes('cc-csc') || tokens.includes('cc-number')) return true
  if (tokens.includes('current-password') || tokens.includes('new-password')) return false
  const text = hints(el)
  if (!CARD_CODE_HINT.test(text)) return false
  return CARD_CODE_WORD.test(text) || (el.maxLength > 0 && el.maxLength <= 4)
}

export function isOtpField(el: HTMLInputElement): boolean {
  if (!OTP_TYPES.has(el.type)) return false
  if (autocompleteHas(el, 'one-time-code')) return true
  if (autocompleteHas(el, 'username') || autocompleteHas(el, 'email')) return false
  const max = el.maxLength
  const short = max > 0 && max <= 10
  const numeric = el.inputMode === 'numeric' || el.type === 'number' || el.type === 'tel'
  return OTP_HINT.test(hints(el)) && (short || numeric)
}

function formHints(el: HTMLInputElement): string {
  const form = el.form
  if (form === null) return ''
  const buttons = Array.from(form.querySelectorAll('button, input[type=submit]'))
    .map((b) => (b instanceof HTMLInputElement ? b.value : (b.textContent ?? '')))
    .join(' ')
  return [form.id, form.name, form.getAttribute('action') ?? '', buttons].join(' ')
}

export function passwordKind(el: HTMLInputElement, visible: Visible): SafeFieldKind {
  if (autocompleteHas(el, 'new-password')) return 'new-password'
  if (autocompleteHas(el, 'current-password')) return 'login'
  const all = passwordsIn(scopeOf(el), visible)
  const index = all.indexOf(el)
  if (all.length >= 3) return index <= 0 ? 'login' : 'new-password'
  if (all.length === 2) return 'new-password'
  return NEW_HINT.test(`${hints(el)} ${formHints(el)}`) ? 'new-password' : 'login'
}

function isUsernameField(el: HTMLInputElement, visible: Visible): boolean {
  if (!TEXT_TYPES.has(el.type)) return false
  if (autocompleteHas(el, 'username') || autocompleteHas(el, 'email')) return true
  if (autocompleteHas(el, 'webauthn')) return true
  if (el.type === 'search' || SEARCH_HINT.test(`${el.name} ${el.id}`)) return false
  const password = passwordsIn(scopeOf(el), visible)[0]
  if (password === undefined) return false
  if (password.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return false
  return el === usernameFor(password, visible)
}

export function classify(el: HTMLInputElement, visible: Visible): SafeFieldKind | null {
  if (el.disabled || el.readOnly) return null
  if (el.type === 'password') return passwordKind(el, visible)
  if (isOtpField(el)) return 'otp'
  if (isUsernameField(el, visible)) return 'login'
  return null
}

export function usernameFor(password: HTMLInputElement, visible: Visible): HTMLInputElement | null {
  const scope = scopeOf(password)
  const before = inputsIn(scope, visible).filter(
    (el) =>
      TEXT_TYPES.has(el.type) &&
      !isOtpField(el) &&
      Boolean(el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING),
  )
  return (
    before.filter((el) => autocompleteHas(el, 'username')).at(-1) ??
    before.filter((el) => autocompleteHas(el, 'email')).at(-1) ??
    before.filter((el) => el.type === 'email').at(-1) ??
    before.filter((el) => USER_HINT.test(hints(el))).at(-1) ??
    before.at(-1) ??
    null
  )
}

export interface LoginFields {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
}

export function loginFields(anchor: HTMLInputElement, visible: Visible): LoginFields {
  if (anchor.type === 'password')
    return { username: usernameFor(anchor, visible), password: anchor }
  const scope = scopeOf(anchor)
  const password =
    passwordsIn(scope, visible).find(
      (el) =>
        Boolean(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        passwordKind(el, visible) === 'login',
    ) ?? null
  return { username: anchor, password }
}

export function newPasswordFields(anchor: HTMLInputElement, visible: Visible): HTMLInputElement[] {
  const all = passwordsIn(scopeOf(anchor), visible).filter(
    (el) => passwordKind(el, visible) === 'new-password',
  )
  return all.includes(anchor) ? all : [anchor]
}

export function otpFields(anchor: HTMLInputElement, visible: Visible): HTMLInputElement[] {
  if (anchor.maxLength !== 1) return [anchor]
  const parent = anchor.parentElement?.parentElement ?? anchor.parentElement
  if (parent === null) return [anchor]
  const boxes = inputsIn(parent, visible).filter(
    (el) => el.maxLength === 1 && OTP_TYPES.has(el.type),
  )
  return boxes.length > 1 ? boxes : [anchor]
}

export function setFieldValue(el: HTMLInputElement, value: string): void {
  if (!Reflect.set(HTMLInputElement.prototype, 'value', value, el)) el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

export function fillOtp(fields: HTMLInputElement[], code: string): void {
  const first = fields[0]
  if (first === undefined) return
  if (fields.length === 1) {
    setFieldValue(first, code)
    return
  }
  fields.forEach((el, i) => {
    setFieldValue(el, code.charAt(i))
  })
}

export interface Captured {
  kind: SafeCaptureKind
  username: string
  password: string
}

export interface CaptureTargets {
  kind: SafeCaptureKind
  username: HTMLInputElement | null
  password: HTMLInputElement
}

function hiddenUsername(scope: ParentNode): HTMLInputElement | null {
  for (const el of Array.from(scope.querySelectorAll('input'))) {
    const tokens = tokensOf(el)
    if ((tokens.includes('username') || tokens.includes('email')) && el.value.trim() !== '')
      return el
  }
  return null
}

function scopeText(scope: ParentNode): string {
  const parts: string[] = []
  if (scope instanceof Element && scope.tagName === 'FORM') {
    parts.push(scope.id, scope.getAttribute('name') ?? '', scope.getAttribute('action') ?? '')
  } else {
    const doc = scope as Document
    parts.push(doc.title)
    for (const h of Array.from(scope.querySelectorAll('h1, h2')).slice(0, 4))
      parts.push(h.textContent ?? '')
  }
  for (const b of Array.from(
    scope.querySelectorAll('button, input[type=submit], [role=button]'),
  ).slice(0, 20))
    parts.push(b instanceof HTMLInputElement ? b.value : (b.textContent ?? ''))
  return parts.join(' ')
}

export function captureTargets(scope: ParentNode, visible: Visible): CaptureTargets | null {
  const all = passwordsIn(scope, visible)
  const passwords = all.filter((el) => el.value !== '')
  if (passwords.length === 0) return null
  const kinds = passwords.map((el) => passwordKind(el, visible))
  const newIndex = kinds.indexOf('new-password')
  const chosen = newIndex >= 0 ? passwords[newIndex] : passwords[0]
  if (chosen === undefined) return null
  const current = passwords.find((_el, i) => kinds[i] === 'login')
  const anchor = current ?? all[0] ?? chosen
  const username = usernameFor(anchor, visible) ?? hiddenUsername(scope)
  let kind: SafeCaptureKind = 'login'
  if (newIndex >= 0) {
    if (current !== undefined) kind = 'change'
    else if (username !== null || SIGNUP_HINT.test(scopeText(scope))) kind = 'signup'
    else kind = 'change'
  }
  return { kind, username, password: chosen }
}

export function readCapture(targets: CaptureTargets): Captured | null {
  const password = targets.password.value
  if (password === '') return null
  return { kind: targets.kind, username: targets.username?.value.trim() ?? '', password }
}

export function captureFrom(scope: ParentNode, visible: Visible): Captured | null {
  const targets = captureTargets(scope, visible)
  return targets === null ? null : readCapture(targets)
}

export function stepUsername(scope: ParentNode, visible: Visible): string | null {
  if (passwordsIn(scope, visible).length > 0) return null
  const fields = inputsIn(scope, visible).filter(
    (el) =>
      TEXT_TYPES.has(el.type) &&
      !isOtpField(el) &&
      !SEARCH_HINT.test(`${el.name} ${el.id}`) &&
      el.value.trim() !== '',
  )
  if (fields.length === 0 || fields.length > 3) return null
  const pick =
    fields.find((el) => autocompleteHas(el, 'username')) ??
    fields.find((el) => autocompleteHas(el, 'email') || el.type === 'email') ??
    fields.find((el) => USER_HINT.test(hints(el)))
  return pick?.value.trim() ?? null
}
