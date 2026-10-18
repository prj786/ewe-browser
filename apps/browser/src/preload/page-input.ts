import { ipcRenderer } from 'electron'
import {
  IPC,
  SWIPE_END_MS,
  SwipeTracker,
  isPageAction,
  type PageAction,
  type PageInput,
  type SafeFieldKind,
  type SwipeDirection,
  type SwipeEvent,
} from '@ewe/shared'

export type SafeOp = 'fill' | 'generate' | 'key'

export interface SafeHooks {
  open(target: Element | null, op: SafeOp): void
  probe(target: HTMLInputElement): SafeFieldKind | null
}

export interface PageInputOptions {
  swipe: boolean
  keys?: boolean | undefined
  safe?: SafeHooks | undefined
}

const SCROLLABLE = new Set(['auto', 'scroll', 'overlay'])
const FUNCTION_KEY = /^F([1-9]|1[0-2])$/
const LINE_PX = 16

let lastTarget: Element | null = null

function report(input: PageInput): Promise<unknown> {
  return ipcRenderer.invoke(IPC.pageInput, input).catch(() => false)
}

function targetOf(event: Event): Element | null {
  const first = event.composedPath()[0]
  return first instanceof Element ? first : null
}

function parentOf(el: Element): Element | null {
  if (el.parentElement !== null) return el.parentElement
  const root = el.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

function rootScrolls(): boolean {
  const hidden = (el: Element | null) => el !== null && getComputedStyle(el).overflowX === 'hidden'
  return !hidden(document.documentElement) && !hidden(document.body)
}

export function canScroll(el: Element, dir: SwipeDirection): boolean {
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return false
  const style = getComputedStyle(el)
  if (el === document.scrollingElement ? !rootScrolls() : !SCROLLABLE.has(style.overflowX))
    return false
  const left = el.scrollLeft
  if (style.direction === 'rtl') return dir === 'back' ? left > 1 - max : left < -1
  return dir === 'back' ? left > 1 : left < max - 1
}

function blockedAt(target: Element | null, dir: SwipeDirection): boolean {
  for (let el = target; el !== null; el = parentOf(el)) if (canScroll(el, dir)) return true
  const root = document.scrollingElement
  return root !== null && canScroll(root, dir)
}

function installSwipe(): void {
  const tracker = new SwipeTracker()
  let allowed: boolean | null = null
  let held: PageInput | null = null
  let sent = -1
  let timer = 0

  const deliver = (input: PageInput) => {
    if (allowed === false) return
    if (allowed === null) {
      held = input
      return
    }
    if (input.kind === 'swipe' && input.phase === 'move') {
      if (input.progress === sent) return
      sent = input.progress
    }
    void report(input)
  }

  const handle = (event: SwipeEvent) => {
    if (event.type === 'start') {
      allowed = null
      held = null
      sent = event.progress
      const start: PageInput = {
        kind: 'swipe',
        phase: 'start',
        dir: event.dir,
        progress: event.progress,
      }
      void report(start).then((ok) => {
        allowed = ok === true
        const next = held
        held = null
        if (allowed && next !== null) void report(next)
      })
      return
    }
    deliver(
      event.type === 'cancel'
        ? { kind: 'swipe', phase: 'cancel', dir: event.dir, progress: 0 }
        : { kind: 'swipe', phase: event.type, dir: event.dir, progress: event.progress },
    )
  }

  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.isTrusted) return
      const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? window.innerWidth : 1
      const target = targetOf(e)
      const events = tracker.wheel(
        {
          dx: e.deltaX * scale,
          dy: e.deltaY * scale,
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          time: e.timeStamp,
        },
        (dir) => e.defaultPrevented || blockedAt(target, dir),
      )
      for (const event of events) handle(event)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const ended = tracker.idle(performance.now())
        if (ended !== null) handle(ended)
      }, SWIPE_END_MS + 10)
    },
    { passive: true },
  )
}

export function installSideButtons(): void {
  window.addEventListener('mouseup', (e) => {
    if (!e.isTrusted || (e.button !== 3 && e.button !== 4) || e.defaultPrevented) return
    void report({ kind: 'button', dir: e.button === 3 ? 'back' : 'forward' })
  })
}

function mediaOf(target: Element | null): HTMLMediaElement | null {
  if (target instanceof HTMLMediaElement) return target
  const found = target?.closest('video, audio')
  return found instanceof HTMLMediaElement ? found : null
}

function deepActive(): Element | null {
  let el: Element | null = document.activeElement
  while (el?.shadowRoot?.activeElement != null) el = el.shadowRoot.activeElement
  return el
}

function runMedia(op: PageAction): void {
  const media = mediaOf(lastTarget)
  if (media === null) return
  switch (op) {
    case 'media.play':
      void media.play().catch(() => undefined)
      return
    case 'media.pause':
      media.pause()
      return
    case 'media.mute':
    case 'media.unmute':
      media.muted = op === 'media.mute'
      return
    case 'media.loop':
    case 'media.unloop':
      media.loop = op === 'media.loop'
      return
    case 'media.controls':
    case 'media.nocontrols':
      media.controls = op === 'media.controls'
      return
    default:
      return
  }
}

function installKeys(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted || e.repeat) return
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !FUNCTION_KEY.test(e.code)) return
      window.setTimeout(() => {
        if (!e.defaultPrevented) void report({ kind: 'key', code: e.code })
      }, 0)
    },
    true,
  )
}

export function installPageInput(options: PageInputOptions): void {
  if (options.swipe) installSwipe()
  if (options.keys === true) installKeys()
  const safe = options.safe
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!e.isTrusted) return
      const target = targetOf(e)
      lastTarget = target
      if (!(target instanceof HTMLInputElement)) return
      window.setTimeout(() => {
        if (!e.defaultPrevented) void report({ kind: 'probe', safe: safe?.probe(target) ?? null })
      }, 0)
    },
    true,
  )
  ipcRenderer.on(IPC.pageAction, (_event, value: unknown) => {
    if (!isPageAction(value)) return
    const op = value.op
    if (op === 'safe.fill' || op === 'safe.generate' || op === 'safe.key') {
      safe?.open(op === 'safe.key' ? deepActive() : lastTarget, op.slice(5) as SafeOp)
      return
    }
    runMedia(op)
  })
}
