import {
  captureTargets,
  readCapture,
  scopeOf,
  type CaptureTargets,
  type Captured,
  type Visible,
} from './forms'

export const TYPED_WINDOW_MS = 10_000
const CHECK_DELAY_MS = 80
const DRAFT_DELAY_MS = 400

export interface TypedHooks {
  visible: Visible
  capture(found: Captured): void
  draft(username: string, keep: boolean): void
}

interface Typed {
  scope: ParentNode
  targets: CaptureTargets
  at: number
  generated: string | null
}

export class TypedWatch {
  private readonly hooks: TypedHooks
  private current: Typed | null = null
  private observer: MutationObserver | null = null
  private checkTimer = 0
  private expireTimer = 0
  private draftTimer = 0

  constructor(hooks: TypedHooks) {
    this.hooks = hooks
  }

  install(): void {
    const nav = (window as unknown as { navigation?: EventTarget }).navigation
    nav?.addEventListener('currententrychange', () => this.fire('nav'))
    window.addEventListener('popstate', () => this.fire('nav'))
    window.addEventListener('hashchange', () => this.fire('nav'))
    window.addEventListener('pagehide', () => this.fire('unload'))
  }

  clear(): void {
    this.current = null
    this.observer?.disconnect()
    this.observer = null
    window.clearTimeout(this.checkTimer)
    window.clearTimeout(this.expireTimer)
    window.clearTimeout(this.draftTimer)
    this.checkTimer = 0
  }

  input(el: HTMLInputElement): void {
    const cur = this.current
    if (el.type === 'password' || cur?.targets.password === el) {
      const scope = scopeOf(el)
      const targets = captureTargets(scope, this.hooks.visible)
      if (targets === null) {
        if (cur?.targets.password === el) this.drop()
        return
      }
      let generated = cur?.scope === scope ? cur.generated : null
      if (generated !== null && targets.password.value !== generated) {
        generated = null
        this.hooks.draft('', false)
      }
      this.arm({ scope, targets, at: Date.now(), generated })
      return
    }
    if (cur?.scope !== scopeOf(el)) return
    cur.at = Date.now()
    if (cur.generated !== null && el === cur.targets.username) this.queueDraft()
    this.rearm()
  }

  generated(anchor: HTMLInputElement, value: string): void {
    const scope = scopeOf(anchor)
    const targets = captureTargets(scope, this.hooks.visible)
    if (targets?.password.value !== value) return
    this.arm({ scope, targets, at: Date.now(), generated: value })
    this.sendDraft()
  }

  private drop(): void {
    if (this.current?.generated !== null) this.hooks.draft('', false)
    this.clear()
  }

  private arm(typed: Typed): void {
    this.current = typed
    if (this.observer === null) {
      this.observer = new MutationObserver(() => this.queueCheck())
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      })
    }
    this.rearm()
  }

  private rearm(): void {
    window.clearTimeout(this.expireTimer)
    if (this.current?.generated !== null) return
    this.expireTimer = window.setTimeout(() => {
      if (this.current?.generated === null) this.clear()
    }, TYPED_WINDOW_MS)
  }

  private queueCheck(): void {
    if (this.checkTimer !== 0 || this.current === null) return
    this.checkTimer = window.setTimeout(() => {
      this.checkTimer = 0
      const cur = this.current
      if (cur === null) return
      const field = cur.targets.password
      if (!field.isConnected || !this.hooks.visible(field)) this.fire('leave')
    }, CHECK_DELAY_MS)
  }

  private queueDraft(): void {
    window.clearTimeout(this.draftTimer)
    this.draftTimer = window.setTimeout(() => this.sendDraft(), DRAFT_DELAY_MS)
  }

  private sendDraft(): void {
    const cur = this.current
    if (cur === null) return
    if (cur.generated === null) return
    if (cur.targets.password.value !== cur.generated) {
      cur.generated = null
      this.hooks.draft('', false)
      this.rearm()
      return
    }
    this.hooks.draft(cur.targets.username?.value.trim() ?? '', true)
  }

  private fire(reason: 'leave' | 'nav' | 'unload'): void {
    const cur = this.current
    if (cur === null) return
    if (cur.generated !== null) {
      if (reason === 'unload') {
        window.clearTimeout(this.draftTimer)
        this.sendDraft()
        return
      }
    } else if (Date.now() - cur.at > TYPED_WINDOW_MS) {
      this.clear()
      return
    }
    const found = readCapture(cur.targets)
    this.clear()
    if (found !== null) this.hooks.capture(found)
  }
}
