import { ipcRenderer } from 'electron'
import {
  IPC,
  isSafeFill,
  isSafePageState,
  isSafeSuggestState,
  type Rect,
  type SafeField,
  type SafeFieldKind,
  type SafePageState,
  type SafeSuggestState,
  type SafeTrigger,
} from '@ewe/shared'
import {
  captureFrom,
  classify,
  fillOtp,
  loginFields,
  newPasswordFields,
  otpFields,
  passwordsIn,
  scopeOf,
  setFieldValue,
} from './forms'
import { installPasskeys } from './passkeys'

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

const OFF: SafePageState = { enabled: false, suggest: false, capture: false }
const CLOSED: SafeSuggestState = { open: false, visible: false, selected: false }

interface Armed {
  el: HTMLInputElement
  kind: SafeFieldKind
  at: number
}

interface Intent {
  kind: 'pointer' | 'tab'
  at: number
  target: EventTarget | null
}

let state: SafePageState | null = null
let stateAt = 0
let focused: { el: HTMLInputElement; kind: SafeFieldKind } | null = null
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
  button.title = 'Fill from Safe'
  button.setAttribute('aria-label', 'Fill from Safe')
  button.innerHTML = KEY_SVG
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.isTrusted || focused === null) return
    open(focused.el, focused.kind, 'icon')
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
  const kind = classify(el, visible)
  if (kind === null) return
  const user = fromUser(el)
  const s = await pageState()
  if (!s.enabled || document.activeElement !== el) return
  window.clearTimeout(hideTimer)
  focused = { el, kind }
  ensureIcon()
  placeIcon()
  if (user && s.suggest && !menuOn(el)) open(el, kind, 'focus')
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
  const kind = classify(el, visible)
  if (kind !== null) open(el, kind, 'click')
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
    const kind = classify(el, visible)
    if (kind !== null && state?.enabled === true) {
      event.preventDefault()
      open(el, kind, 'key')
    }
    return
  }
  if (event.key === 'Enter' && passwordsIn(scopeOf(el), visible).length > 0)
    void capture(scopeOf(el))
}

function onInput(event: Event): void {
  if (!event.isTrusted) return
  const el = inputOf(event.target)
  if (el === null || !menuOn(el)) return
  if (el.type === 'password' || armed?.kind === 'otp') send({ op: 'close' })
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
  /log ?in|sign ?in|sign ?up|continue|next|submit|save|create|register|join|verify|update|change/i

function isSubmitButton(el: Element): boolean {
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
  const button = target?.closest('button, input[type=submit], input[type=image], [role=button]')
  if (button === null || button === undefined || !isSubmitButton(button)) return
  const form = button.closest('form')
  const scope: ParentNode = form ?? document
  if (passwordsIn(scope, visible).some((el) => el.value !== '')) void capture(scope)
}

function onSubmit(event: Event): void {
  if (event.isTrusted && event.target instanceof HTMLFormElement) void capture(event.target)
}

async function capture(scope: ParentNode): Promise<void> {
  const found = captureFrom(scope, visible)
  if (found === null) return
  const key = `${found.kind}\u0000${found.username}\u0000${found.password}`
  if (key === lastCapture) return
  lastCapture = key
  if (!(await pageState()).capture) return
  send({ op: 'submit', ...found })
}

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
    return
  }
  if (value.kind === 'otp' && value.otp !== undefined) {
    fillOtp(otpFields(target.el, visible), value.otp)
  }
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
}
