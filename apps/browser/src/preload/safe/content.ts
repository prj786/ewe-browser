import { ipcRenderer } from 'electron'
import {
  IPC,
  isSafeFill,
  isSafePageState,
  isSafeSuggestState,
  isSafeWalletFill,
  type Rect,
  type SafeField,
  type SafeFieldKind,
  type SafeListKind,
  type SafePageState,
  type SafeSuggestState,
  type SafeTrigger,
  type SafeWalletKind,
} from '@ewe/shared'
import {
  captureFrom,
  classify,
  fillOtp,
  inputsIn,
  loginFields,
  newPasswordFields,
  otpFields,
  passwordsIn,
  scopeOf,
  setFieldValue,
} from './forms'
import { installPasskeys } from './passkeys'
import { stepUsername, type Captured } from './forms'
import { TypedWatch } from './typed'
import { fillAddress, fillCard, walletKindOf } from './wallet'

const STATE_TTL_MS = 2_000
const ARMED_TTL_MS = 120_000
const INTENT_MS = 1_000
const FILTER_MAX = 1024
const ICON_SIZE = 20
const ICON_GAP = 6
const ICON_MIN_FIELD = 96
const HIDE_DELAY_MS = 150

const KEY_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>'

const ICON_CSS = `:host{all:initial;position:fixed;z-index:2147483647;width:${String(ICON_SIZE)}px;height:${String(ICON_SIZE)}px}button{all:initial;display:grid;place-items:center;width:100%;height:100%;border-radius:6px;cursor:pointer;color:#8a857c;background:transparent}button:hover{color:#1a1814;background:#f2c94c}`

const OFF: SafePageState = {
  enabled: false,
  suggest: false,
  capture: false,
  cards: false,
  addresses: false,
}
const CLOSED: SafeSuggestState = { open: false, visible: false, selected: false }

interface Armed {
  el: HTMLInputElement
  kind: SafeListKind
  at: number
}

interface Intent {
  kind: 'pointer' | 'tab'
  at: number
  target: EventTarget | null
}

let state: SafePageState | null = null
let stateAt = 0
let focused: { el: HTMLInputElement; kind: SafeListKind } | null = null
let armed: Armed | null = null
let iconHost: HTMLElement | null = null
let hideTimer = 0
let lastCapture = ''
let menuField: HTMLInputElement | null = null
let menu: SafeSuggestState = CLOSED
let intent: Intent | null = null
let moveQueued = false

function send(request: Record<string, unknown>): void {
  void ipcRenderer.invoke(IPC.safePage, request).catch(() => undefined)
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
}

async function pageState(): Promise<SafePageState> {
  if (state !== null && Date.now() - stateAt < STATE_TTL_MS) return state
  let next = OFF
  try {
    const value: unknown = await ipcRenderer.invoke(IPC.safePage, { op: 'state' })
    if (isSafePageState(value)) next = value
  } catch {
    next = OFF
  }
  state = next
  stateAt = Date.now()
  return next
}

export function topRect(el: HTMLElement): Rect | null {
  const r = el.getBoundingClientRect()
  let x = r.left
  let y = r.top
  try {
    let view: Window = window
    while (view !== view.parent) {
      const frame = view.frameElement
      if (frame === null) return null
      const fr = frame.getBoundingClientRect()
      const style = view.parent.getComputedStyle(frame)
      x += fr.left + frame.clientLeft + (Number.parseFloat(style.paddingLeft) || 0)
      y += fr.top + frame.clientTop + (Number.parseFloat(style.paddingTop) || 0)
      view = view.parent
    }
  } catch {
    return null
  }
  return { x, y, width: r.width, height: r.height }
}

function fieldKind(el: HTMLInputElement, kind: SafeFieldKind): SafeField {
  if (el.type === 'password') return 'password'
  return kind === 'otp' ? 'code' : 'username'
}

function menuOn(el: HTMLInputElement | null): boolean {
  return menu.open && el !== null && el === menuField
}

function open(el: HTMLInputElement, kind: SafeFieldKind, trigger: SafeTrigger): void {
  armed = { el, kind, at: Date.now() }
  menuField = el
  send({ op: 'open', kind, field: fieldKind(el, kind), rect: topRect(el), trigger })
}

const isWallet = (kind: SafeListKind): kind is SafeWalletKind =>
  kind === 'card' || kind === 'address'

function listKind(el: HTMLInputElement): SafeListKind | null {
  const wallet = walletKindOf(el, visible)
  if (wallet === 'card') return 'card'
  const kind = classify(el, visible)
  if (wallet === null) return kind
  if (kind === null) return wallet
  if (kind === 'login' && passwordsIn(scopeOf(el), visible).length === 0) return wallet
  return kind
}

function enabledFor(s: SafePageState, kind: SafeListKind): boolean {
  if (kind === 'card') return s.cards
  if (kind === 'address') return s.addresses
  return s.enabled
}

function openList(el: HTMLInputElement, kind: SafeListKind, trigger: SafeTrigger): void {
  if (!isWallet(kind)) {
    open(el, kind, trigger)
    return
  }
  armed = { el, kind, at: Date.now() }
  menuField = el
  send({ op: 'wallet', kind, rect: topRect(el), trigger })
}

function secureFrame(): boolean {
  const host = location.hostname.toLowerCase()
  if (location.protocol === 'https:') return true
  return location.protocol === 'http:' && (host === 'localhost' || host.endsWith('.localhost'))
}

function onWalletFill(_event: Electron.IpcRendererEvent, value: unknown): void {
  const target = armed
  armed = null
  menu = CLOSED
  if (target === null || !isSafeWalletFill(value) || Date.now() - target.at > ARMED_TTL_MS) return
  if (!target.el.isConnected || value.kind !== target.kind) return
  if (value.kind === 'card') {
    if (secureFrame()) fillCard(target.el, value.card, visible)
  } else fillAddress(target.el, value.address, visible)
  target.el.focus()
}

function placeIcon(): void {
  if (iconHost === null || focused === null) return
  const r = focused.el.getBoundingClientRect()
  if (r.width < ICON_MIN_FIELD || !visible(focused.el)) {
    iconHost.style.display = 'none'
    return
  }
  iconHost.style.display = 'block'
  iconHost.style.left = `${String(Math.round(r.right - ICON_SIZE - ICON_GAP))}px`
  iconHost.style.top = `${String(Math.round(r.top + (r.height - ICON_SIZE) / 2))}px`
}

function ensureIcon(): HTMLElement {
  if (iconHost?.isConnected === true) return iconHost
  const host = document.createElement('ewe-safe-key')
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = ICON_CSS
  const button = document.createElement('button')
  button.type = 'button'
  button.title = 'Fill from ewe Safe'
  button.setAttribute('aria-label', 'Fill from ewe Safe')
  button.innerHTML = KEY_SVG
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.isTrusted || focused === null) return
    openList(focused.el, focused.kind, 'icon')
  })
  root.append(style, button)
  document.documentElement.append(host)
  iconHost = host
  return host
}

function hideIcon(): void {
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (iconHost !== null) iconHost.style.display = 'none'
    focused = null
  }, HIDE_DELAY_MS)
}

function inputOf(target: EventTarget | null): HTMLInputElement | null {
  return target instanceof HTMLInputElement ? target : null
}

function fromUser(el: HTMLInputElement): boolean {
  const last = intent
  intent = null
  if (last === null || Date.now() - last.at > INTENT_MS) return false
  if (last.kind === 'tab') return true
  const target = last.target
  if (target === el) return true
  if (!(target instanceof Node)) return false
  return Array.from(el.labels ?? []).some((label) => label.contains(target))
}

async function onFocusIn(event: FocusEvent): Promise<void> {
  const el = inputOf(event.target)
  if (el === null) return
  if (menuOn(el)) send({ op: 'focus' })
  const kind = listKind(el)
  if (kind === null) return
  const user = fromUser(el)
  const s = await pageState()
  if (!enabledFor(s, kind) || document.activeElement !== el) return
  window.clearTimeout(hideTimer)
  focused = { el, kind }
  ensureIcon()
  placeIcon()
  if (user && s.suggest && !menuOn(el)) openList(el, kind, 'focus')
}

function onFocusOut(event: FocusEvent): void {
  hideIcon()
  if (menuOn(inputOf(event.target))) send({ op: 'blur' })
}

function onPointerDown(event: PointerEvent): void {
  if (!event.isTrusted || event.button !== 0) return
  intent = { kind: 'pointer', at: Date.now(), target: event.target }
  const el = inputOf(event.target)
  if (el === null || document.activeElement !== el || menuOn(el)) return
  if (state?.suggest !== true) return
  const kind = listKind(el)
  if (kind !== null && enabledFor(state, kind)) openList(el, kind, 'click')
}

function onKeyDown(event: KeyboardEvent): void {
  if (!event.isTrusted) return
  const el = inputOf(event.target)
  if (event.key === 'Tab') {
    intent = { kind: 'tab', at: Date.now(), target: null }
    if (menuOn(el)) send({ op: 'close' })
    return
  }
  if (el === null) return
  const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  if (menuOn(el) && menu.visible && plain) {
    const key = event.key
    const take =
      key === 'ArrowDown' ||
      key === 'ArrowUp' ||
      key === 'Escape' ||
      (key === 'Enter' && menu.selected)
    if (take) {
      event.preventDefault()
      event.stopImmediatePropagation()
      send({ op: 'key', key })
      if (key === 'Enter' || key === 'Escape') menu = CLOSED
      return
    }
    if (key === 'Enter') send({ op: 'close' })
  }
  if (event.key === 'ArrowDown' && plain && el.value === '' && !menuOn(el)) {
    const kind = listKind(el)
    if (kind !== null && state !== null && enabledFor(state, kind)) {
      event.preventDefault()
      openList(el, kind, 'key')
    }
    return
  }
  if (event.key === 'Enter') submitted(scopeOf(el))
}

function onInput(event: Event): void {
  if (!event.isTrusted) return
  const el = inputOf(event.target)
  if (el === null) return
  typed.input(el)
  if (!menuOn(el)) return
  if (el.type === 'password' || armed?.kind === 'otp' || armed?.kind === 'card')
    send({ op: 'close' })
  else send({ op: 'filter', text: el.value.slice(0, FILTER_MAX) })
}

function onViewport(event: Event): void {
  if (!event.isTrusted) return
  placeIcon()
  if (!menu.open || menuField === null || moveQueued) return
  moveQueued = true
  window.requestAnimationFrame(() => {
    moveQueued = false
    const el = menuField
    if (!menu.open || el === null) return
    send({ op: 'move', rect: el.isConnected ? topRect(el) : null })
  })
}

const SUBMIT_TEXT =
  /log ?in|sign ?in|sign ?up|continue|next|submit|save|create|register|join|verify|update|change|get ?started|confirm|finish/i

function isSubmitButton(el: Element): boolean {
  if (el instanceof HTMLAnchorElement) {
    const href = el.getAttribute('href') ?? ''
    if (href !== '' && !href.startsWith('#') && !/^javascript:/i.test(href)) return false
  }
  if (el instanceof HTMLInputElement) return el.type === 'submit' || el.type === 'image'
  if (el instanceof HTMLButtonElement) {
    if (el.type === 'submit' && el.form !== null) return true
    if (el.type === 'button' || el.type === 'reset') return SUBMIT_TEXT.test(el.textContent ?? '')
    return true
  }
  return SUBMIT_TEXT.test(`${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`)
}

function onClick(event: MouseEvent): void {
  if (!event.isTrusted) return
  const target = event.target instanceof Element ? event.target : null
  const button = target?.closest('button, input[type=submit], input[type=image], [role=button], a')
  if (button === null || button === undefined || !isSubmitButton(button)) return
  const form = button.closest('form')
  const scope: ParentNode = form ?? document
  submitted(scope)
}

function onSubmit(event: Event): void {
  if (event.isTrusted && event.target instanceof HTMLFormElement) submitted(event.target)
}

function captureOff(): boolean {
  return state !== null && Date.now() - stateAt < STATE_TTL_MS && !state.capture
}

function submitted(scope: ParentNode): void {
  if (capture(scope)) return
  const username = stepUsername(scope, visible)
  if (username !== null && !captureOff()) send({ op: 'username', username })
}

function sendCapture(found: Captured): void {
  const key = `${found.kind}\u0000${found.username}\u0000${found.password}`
  if (key === lastCapture) return
  lastCapture = key
  if (captureOff()) return
  send({ op: 'submit', ...found })
}

function capture(scope: ParentNode): boolean {
  const found = captureFrom(scope, visible)
  if (found === null) return false
  typed.clear()
  sendCapture(found)
  return true
}

const typed = new TypedWatch({
  visible,
  capture: sendCapture,
  draft: (username, keep) => send({ op: 'draft', username: username.slice(0, FILTER_MAX), keep }),
})

function onSuggest(_event: Electron.IpcRendererEvent, value: unknown): void {
  if (isSafeSuggestState(value)) menu = value
}

function onFill(_event: Electron.IpcRendererEvent, value: unknown): void {
  const target = armed
  armed = null
  menu = CLOSED
  if (target === null || !isSafeFill(value) || Date.now() - target.at > ARMED_TTL_MS) return
  if (!target.el.isConnected || value.kind !== target.kind) return
  if (value.kind === 'login') {
    const { username, password } = loginFields(target.el, visible)
    if (username !== null && value.username !== undefined && value.username !== '')
      setFieldValue(username, value.username)
    if (password !== null && value.password !== undefined) setFieldValue(password, value.password)
    ;(password ?? username)?.focus()
    return
  }
  if (value.kind === 'new-password' && value.password !== undefined) {
    for (const el of newPasswordFields(target.el, visible)) setFieldValue(el, value.password)
    target.el.focus()
    typed.generated(target.el, value.password)
    return
  }
  if (value.kind === 'otp' && value.otp !== undefined) {
    fillOtp(otpFields(target.el, visible), value.otp)
  }
}

function inputIn(target: Element | null): HTMLInputElement | null {
  if (target instanceof HTMLInputElement) return target
  const inner = target?.shadowRoot?.activeElement ?? null
  return inner instanceof HTMLInputElement ? inner : null
}

function firstField(): { el: HTMLInputElement; kind: SafeFieldKind } | null {
  let found: { el: HTMLInputElement; kind: SafeFieldKind } | null = null
  for (const el of inputsIn(document, visible)) {
    const kind = classify(el, visible)
    if (kind === null) continue
    if (kind === 'login') return { el, kind }
    found ??= { el, kind }
  }
  return found
}

export function safeKindOf(el: HTMLInputElement): SafeFieldKind | null {
  return classify(el, visible)
}

export function openSafeAt(target: Element | null, op: 'fill' | 'generate' | 'key'): void {
  void (async () => {
    if (!(await pageState()).enabled) return
    const el = inputIn(target)
    const kind = el === null ? null : classify(el, visible)
    const field = el !== null && kind !== null ? { el, kind } : op === 'key' ? firstField() : null
    if (field === null) return
    if (document.activeElement !== field.el) field.el.focus({ preventScroll: false })
    open(field.el, field.kind, 'key')
  })()
}

export function installSafe(): void {
  installPasskeys()
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('focusin', (e) => void onFocusIn(e), true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('input', onInput, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('submit', onSubmit, true)
  window.addEventListener('scroll', onViewport, true)
  window.addEventListener('resize', onViewport)
  ipcRenderer.on(IPC.safeFill, onFill)
  ipcRenderer.on(IPC.safeSuggest, onSuggest)
  ipcRenderer.on(IPC.safeWalletFill, onWalletFill)
  typed.install()
}
