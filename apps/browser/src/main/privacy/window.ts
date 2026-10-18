import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  PERMISSION_KINDS,
  originHost,
  type PermissionDecision,
  type PermissionKind,
  type PermissionPrompt,
  type Point,
  type Rect,
  type Size,
  type ToastIcon,
} from '@ewe/shared'
import type { OverlayController } from '../overlay'
import { PROMPT_CALLBACKS_MAX, type PermissionStore } from './permissions'
import type { PrivacyService } from './service'

export const PERMISSION_VIEW_WIDTH = 384
export const PERMISSION_CARD_START = 220
export const PERMISSION_GUARD_MS = 500

export interface PrivacyWindowHost {
  overlay: OverlayController
  permissions: PermissionStore
  service: PrivacyService
  activeContents(): WebContents | null
  activeUrl(): string
  pageBounds(): Rect
  contentSize(): Size
  toast(message: string, icon?: ToastIcon): void
}

interface Pending {
  promptId: string
  contents: WebContents
  origin: string
  kinds: PermissionKind[]
  callbacks: ((granted: boolean) => void)[]
  shownAt: number
  cleanup(): void
}

export function permissionRect(page: Rect, height: number): Rect {
  return {
    x: Math.round(page.x),
    y: Math.round(page.y),
    width: Math.round(Math.max(0, Math.min(PERMISSION_VIEW_WIDTH, page.width))),
    height: Math.round(Math.max(0, Math.min(height, page.height))),
  }
}

export class PrivacyWindow {
  private readonly host: PrivacyWindowHost
  private readonly pending = new Map<number, Pending>()
  private shown: Pending | null = null
  private height = PERMISSION_CARD_START
  private siteInfoOpen = false
  private readonly offStore: () => void
  private disposed = false

  constructor(host: PrivacyWindowHost) {
    this.host = host
    host.overlay.watch((part) => {
      if (part !== 'permission') this.shown = null
      if (part !== 'siteinfo') this.siteInfoOpen = false
      if (part === 'none') setTimeout(() => this.refresh(), 0)
    })
    const onChange = () => this.updateSiteInfo()
    host.permissions.on('change', onChange)
    this.offStore = () => host.permissions.off('change', onChange)
  }

  ask(
    contents: WebContents,
    origin: string,
    kinds: PermissionKind[],
    callback: (granted: boolean) => void,
  ): boolean {
    if (this.disposed || contents.isDestroyed()) return false
    let entry = this.pending.get(contents.id)
    if (entry !== undefined && entry.origin !== origin) {
      this.settle(entry, false)
      entry = undefined
    }
    if (entry === undefined) {
      const created: Pending = {
        promptId: randomUUID(),
        contents,
        origin,
        kinds: [],
        callbacks: [],
        shownAt: 0,
        cleanup: () => undefined,
      }
      const onNavigate = (
        details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
      ) => {
        if (details.isMainFrame && !details.isSameDocument) this.settle(created, false)
      }
      const onGone = () => this.settle(created, false)
      contents.on('did-start-navigation', onNavigate)
      contents.once('destroyed', onGone)
      created.cleanup = () => {
        if (contents.isDestroyed()) return
        contents.off('did-start-navigation', onNavigate)
        contents.off('destroyed', onGone)
      }
      this.pending.set(contents.id, created)
      entry = created
    }
    if (entry.callbacks.length >= PROMPT_CALLBACKS_MAX) return false
    const merged = new Set([...entry.kinds, ...kinds])
    entry.kinds = PERMISSION_KINDS.filter((k) => merged.has(k))
    entry.callbacks.push(callback)
    if (this.shown === entry) {
      entry.shownAt = Date.now()
      this.show(entry)
    } else this.refresh()
    return true
  }

  refresh(): void {
    if (this.disposed) return
    const active = this.host.activeContents()
    const entry = active === null ? undefined : this.pending.get(active.id)
    const part = this.host.overlay.part
    if (entry === undefined) {
      if (part === 'permission') this.host.overlay.hide()
      return
    }
    if (part !== 'none' && part !== 'toast' && part !== 'permission') return
    if (this.shown === entry && part === 'permission') return
    this.show(entry)
  }

  fit(promptId: string, height: number): void {
    if (this.shown?.promptId !== promptId) return
    const next = Math.round(Math.min(Math.max(height, 80), 600))
    if (next === this.height) return
    this.height = next
    this.place()
  }

  decide(promptId: string, decision: PermissionDecision): void {
    const entry = [...this.pending.values()].find((p) => p.promptId === promptId)
    if (entry === undefined) return
    if (
      decision !== 'dismiss' &&
      (entry.shownAt === 0 || Date.now() - entry.shownAt < PERMISSION_GUARD_MS)
    )
      return
    if (decision === 'dismiss') this.host.service.dismissals.note(entry.origin)
    else {
      this.host.permissions.set(entry.origin, entry.kinds, decision)
      this.host.service.dismissals.forget(entry.origin)
    }
    this.settle(entry, decision === 'allow')
  }

  openSiteInfo(at: Point): void {
    const url = this.host.activeUrl()
    if (!/^(https?|file):/i.test(url)) return
    const info = this.host.service.siteInfo(url)
    this.host.overlay.show('siteinfo', this.host.contentSize(), {
      type: 'siteinfo.open',
      info,
      x: at.x,
      y: at.y,
    })
    this.siteInfoOpen = true
  }

  setPermission(origin: string, kind: PermissionKind, value: 'ask' | 'allow' | 'block'): void {
    this.host.permissions.set(origin, [kind], value)
  }

  async clearData(origin: string): Promise<void> {
    const contents = this.host.activeContents()
    if (contents === null) return
    await this.host.service.clearSiteData(origin, contents.session).catch(() => undefined)
    if (this.host.overlay.part === 'siteinfo') this.host.overlay.hide()
    setTimeout(() => this.host.toast(`Cleared site data for ${originHost(origin)}`, 'check'), 200)
    if (!contents.isDestroyed() && contents.getURL().startsWith(origin)) contents.reload()
  }

  dispose(): void {
    this.disposed = true
    this.offStore()
    for (const entry of [...this.pending.values()]) this.settle(entry, false)
  }

  private updateSiteInfo(): void {
    if (!this.siteInfoOpen || this.host.overlay.part !== 'siteinfo') return
    this.host.overlay.sendUi({
      type: 'siteinfo.update',
      info: this.host.service.siteInfo(this.host.activeUrl()),
    })
  }

  private prompt(entry: Pending): PermissionPrompt {
    return {
      promptId: entry.promptId,
      origin: entry.origin,
      host: originHost(entry.origin),
      kinds: [...entry.kinds],
    }
  }

  private show(entry: Pending): void {
    if (this.shown !== entry) {
      this.height = PERMISSION_CARD_START
      entry.shownAt = Date.now()
    }
    this.shown = entry
    this.host.overlay.show(
      'permission',
      this.host.contentSize(),
      { type: 'permission.prompt', prompt: this.prompt(entry) },
      permissionRect(this.host.pageBounds(), this.height),
    )
  }

  place(): void {
    if (this.shown === null || this.host.overlay.part !== 'permission') return
    this.host.overlay.place('permission', permissionRect(this.host.pageBounds(), this.height))
  }

  private settle(entry: Pending, granted: boolean): void {
    if (this.pending.get(entry.contents.id) !== entry) return
    this.pending.delete(entry.contents.id)
    entry.cleanup()
    for (const callback of entry.callbacks) callback(granted)
    if (this.shown === entry) {
      this.shown = null
      if (this.host.overlay.part === 'permission') this.host.overlay.hide()
    }
  }
}
