import { randomUUID } from 'node:crypto'
import { webFrameMain, type BrowserWindow, type WebContents, type WebFrameMain } from 'electron'
import {
  IPC,
  type OverlayPart,
  type Point,
  type Rect,
  type SafeField,
  type SafeFieldKind,
  type SafeMenu,
  type SafePageRequest,
  type SafePasskeyReply,
  type SafePasskeyRequest,
  type SafeSheet,
  type SafeSheetAction,
  type SafeSuggestState,
  type SafeTrigger,
  type ShellCommand,
  type Size,
  type ToastIcon,
} from '@ewe/shared'
import type { OverlayController } from '../overlay'
import { sameUser } from './decide'
import { frameKey, frameRef, type FrameRef } from './passkeys'
import type { SafeOutcome, SafeService } from './service'
import { siteOf } from './site'
import {
  checkRpId,
  displayText,
  fail,
  parseCreate,
  parseGet,
  type CreateOptions,
  type GetOptions,
  type WebAuthnError,
} from './webauthn'

export interface SafeWindowHost {
  window: BrowserWindow
  overlay: OverlayController
  safe: SafeService
  activeContents(): WebContents | null
  viewBounds(contents: WebContents): Rect | null
  favicon(contents: WebContents): string | null
  contentSize(): Size
  lastMouse(): Point | null
  toast(message: string, icon: ToastIcon): void
  hideOverlay(): void
}

interface Suggest {
  requestId: string
  contents: WebContents
  ref: FrameRef
  kind: SafeFieldKind
  field: SafeField
  rect: Rect | null
  anchor: Point
  height: number | null
  selected: boolean
  visible: boolean
  bounds: Rect | null
  blurTimer: NodeJS.Timeout | null
}

interface Sheet {
  sheetId: string
  id: string
  mode: 'create' | 'get'
  ref: FrameRef
  contents: WebContents
  rpId: string
  create: CreateOptions | null
  get: GetOptions | null
  offered: Set<string>
  into: string | null
  busy: boolean
  timer: NodeJS.Timeout
  resolve(reply: SafePasskeyReply): void
}

type SafeCommand = Extract<ShellCommand, { type: `safe.${string}` }>

export const SUGGEST_GAP = 4
export const SUGGEST_PAD = 12
export const SUGGEST_MIN_WIDTH = 280
export const SUGGEST_MAX_WIDTH = 420
const SUGGEST_ESTIMATE = 168
const BLUR_GRACE_MS = 200
const SAFE_PROMPT_SETTLE_MS = 400
const SAFE_PROMPT_FALLBACK_MS = 2_500
const SAFE_PROMPT_RETRY_MS = 1_000
const SAFE_PROMPT_RETRIES = 10
const SAFE_PROMPT_SHOW_MS = 60_000
export const SAFE_KEY_WAIT_MS = 600
const GENERATE_ARM_MS = 3_000

const CLOSED: SafeSuggestState = { open: false, visible: false, selected: false }

export function suggestBounds(field: Rect, page: Rect, size: Size, height: number): Rect {
  const listWidth = Math.round(
    Math.min(SUGGEST_MAX_WIDTH, Math.max(SUGGEST_MIN_WIDTH, field.width)),
  )
  const width = listWidth + 2 * SUGGEST_PAD
  const total = Math.round(height) + 2 * SUGGEST_PAD
  const right = Math.min(size.width, page.x + page.width + SUGGEST_PAD)
  const x = Math.max(0, Math.min(Math.round(field.x) - SUGGEST_PAD, right - width))
  const below = field.y + field.height + SUGGEST_GAP
  const roomBelow = page.y + page.height - below
  const roomAbove = field.y - SUGGEST_GAP - page.y
  const fitsBelow = roomBelow >= height || roomBelow >= roomAbove
  const top = fitsBelow ? below - SUGGEST_PAD : field.y - SUGGEST_GAP - height - SUGGEST_PAD
  const y = Math.max(0, Math.min(Math.round(top), size.height - total))
  return { x, y, width, height: Math.min(total, size.height) }
}

export function shouldSuggest(menu: SafeMenu, trigger: SafeTrigger): boolean {
  if (trigger === 'icon' || trigger === 'key') return true
  if (menu.state === 'locked') return true
  if (menu.state !== 'ready') return false
  if (menu.kind === 'new-password') return true
  return menu.items.length > 0 || menu.passkeys.length > 0
}

export function crossOrigin(frame: WebFrameMain): boolean {
  let parent = frame.parent
  while (parent !== null) {
    if (parent.origin !== frame.origin) return true
    parent = parent.parent
  }
  return false
}

const aborted = (): WebAuthnError => fail('AbortError', 'The passkey request was aborted.')

export class SafeWindow {
  private readonly host: SafeWindowHost
  private suggest: Suggest | null = null
  private opening = 0
  private sheet: Sheet | null = null
  private readonly wired = new WeakSet<WebContents>()
  private readonly promptPending = new Set<string>()
  private promptId: string | null = null
  private promptTimer: NodeJS.Timeout | null = null
  private readonly keyedAt = new Map<number, number>()
  private keyTimer: NodeJS.Timeout | null = null
  private generateFor: { contentsId: number; frame: string; at: number } | null = null

  constructor(host: SafeWindowHost) {
    this.host = host
    host.overlay.watch((part) => this.onPart(part))
    host.window.on('blur', () => this.closeSuggest())
    host.overlay.webContents.on('focus', () => {
      const s = this.suggest
      if (s !== null && this.host.overlay.part === 'suggest' && !s.contents.isDestroyed())
        s.contents.focus()
    })
  }

  private get safe(): SafeService {
    return this.host.safe
  }

  dispose(): void {
    this.closeSuggest()
    if (this.sheet !== null) this.finish(this.sheet, aborted())
    if (this.promptTimer !== null) clearTimeout(this.promptTimer)
    if (this.keyTimer !== null) clearTimeout(this.keyTimer)
  }

  private onPart(part: OverlayPart): void {
    if (part !== 'suggest' && this.suggest !== null) this.endSuggest()
    const sheet = this.sheet
    if (part !== 'sheet' && sheet !== null && !sheet.busy)
      this.finish(sheet, fail('NotAllowedError', 'The passkey request was closed.'))
  }

  private wire(contents: WebContents): void {
    if (this.wired.has(contents)) return
    this.wired.add(contents)
    contents.on('did-start-navigation', (details) => {
      const s = this.suggest
      if (s?.contents !== contents || details.isSameDocument) return
      const frame = details.frame
      if (details.isMainFrame || (frame !== null && frameKey(frame) === frameKey(s.ref)))
        this.closeSuggest()
    })
    contents.on(
      'did-frame-navigate',
      (_event, _url, _code, _status, isMainFrame, processId, routingId) => {
        if (isMainFrame) this.dropContents(contents)
        else this.dropFrame(contents, processId, routingId)
        this.safe.passkeys.prune((ref) => this.frameOf(ref) !== null, aborted())
      },
    )
    contents.once('destroyed', () => this.dropContents(contents))
  }

  private dropFrame(contents: WebContents, processId: number, routingId: number): void {
    this.safe.passkeys.dropFrame(processId, routingId, aborted())
    const sheet = this.sheet
    if (sheet !== null && frameKey(sheet.ref) === frameKey({ processId, routingId }))
      this.finish(sheet, aborted())
    const s = this.suggest
    if (
      s !== null &&
      s.contents === contents &&
      frameKey(s.ref) === frameKey({ processId, routingId })
    )
      this.closeSuggest()
  }

  private dropContents(contents: WebContents): void {
    this.keyedAt.delete(contents.id)
    this.safe.passkeys.dropContents(contents.id, aborted())
    if (this.sheet?.contents === contents) this.finish(this.sheet, aborted())
    if (this.suggest?.contents === contents) this.closeSuggest()
  }

  private frameOf(ref: FrameRef): WebFrameMain | null {
    const frame = webFrameMain.fromId(ref.processId, ref.routingId)
    if (frame === undefined || frame.isDestroyed() || frame.origin !== ref.origin) return null
    return frame
  }

  private sendState(ref: FrameRef, state: SafeSuggestState): void {
    const frame = this.frameOf(ref)
    if (frame === null) return
    try {
      frame.send(IPC.safeSuggest, state)
    } catch {
      return
    }
  }

  page(contents: WebContents, frame: WebFrameMain, request: SafePageRequest): void {
    this.wire(contents)
    const s = this.suggest
    const same = s !== null && s.contents === contents && frameKey(s.ref) === frameKey(frame)
    switch (request.op) {
      case 'open':
        if (request.trigger === 'key') this.keyedAt.set(contents.id, Date.now())
        void this.open(contents, frame, request)
        return
      case 'move':
        if (!same) return
        s.rect = request.rect
        this.place()
        return
      case 'key':
        if (!same) return
        if (request.key === 'Escape') this.closeSuggest()
        else
          this.host.overlay.sendUi({
            type: 'safe.suggest.key',
            requestId: s.requestId,
            key: request.key,
          })
        return
      case 'filter':
        if (!same) return
        if (s.field !== 'username') this.closeSuggest()
        else
          this.host.overlay.sendUi({
            type: 'safe.suggest.filter',
            requestId: s.requestId,
            text: request.text,
          })
        return
      case 'blur':
        if (!same || s.blurTimer !== null) return
        s.blurTimer = setTimeout(() => {
          s.blurTimer = null
          if (this.suggest === s) this.closeSuggest(false)
        }, BLUR_GRACE_MS)
        return
      case 'focus':
        if (same && s.blurTimer !== null) {
          clearTimeout(s.blurTimer)
          s.blurTimer = null
        }
        return
      case 'close':
        if (same) this.closeSuggest()
        return
      case 'submit':
        this.capture(contents, frame, request.username, request.password)
        return
      case 'state':
        return
    }
  }

  private anchorFor(contents: WebContents): Point {
    const view = this.host.viewBounds(contents) ?? { x: 0, y: 0, width: 0, height: 0 }
    return this.host.lastMouse() ?? { x: view.x + Math.round(view.width / 2), y: view.y + 80 }
  }

  private async open(
    contents: WebContents,
    frame: WebFrameMain,
    request: { kind: SafeFieldKind; field: SafeField; rect: Rect | null; trigger: SafeTrigger },
  ): Promise<void> {
    if (this.host.activeContents() !== contents) return
    const part = this.host.overlay.part
    if (part === 'palette' || part === 'menu' || part === 'sheet') return
    const token = ++this.opening
    const anchor = this.anchorFor(contents)
    const ref = frameRef(contents, frame)
    const menu = await this.safe.menu(contents, frame, request.kind, request.field)
    if (token !== this.opening || !shouldSuggest(menu, request.trigger)) return
    if (this.host.activeContents() !== contents || this.frameOf(ref) === null) return
    const now = this.host.overlay.part
    if (now === 'palette' || now === 'menu' || now === 'sheet') return
    if (this.takeGenerate(contents, ref, menu, request.trigger)) return
    this.show(contents, ref, menu, request.rect, anchor)
  }

  armGenerate(contents: WebContents, frame: { processId: number; routingId: number }): void {
    this.generateFor = { contentsId: contents.id, frame: frameKey(frame), at: Date.now() }
  }

  private takeGenerate(
    contents: WebContents,
    ref: FrameRef,
    menu: SafeMenu,
    trigger: SafeTrigger,
  ): boolean {
    const armed = this.generateFor
    if (armed?.contentsId !== contents.id || armed.frame !== frameKey(ref)) return false
    if (trigger !== 'key') return false
    this.generateFor = null
    if (Date.now() - armed.at > GENERATE_ARM_MS) return false
    if (menu.kind !== 'new-password' || menu.state !== 'ready') return false
    void this.safe.generate(menu.requestId).then((out) => {
      if (out !== null) this.host.toast(out.message, out.ok ? 'check' : 'alert')
    })
    return true
  }

  openForKey(contents: WebContents): void {
    const state = this.safe.pageState()
    if (!state.enabled) {
      this.host.toast(
        this.safe.settings().fill ? 'Safe is not running' : 'Fill from Safe is off in Settings',
        'alert',
      )
      return
    }
    if (!/^https?:/i.test(contents.getURL())) {
      this.host.toast('Safe fills sign-in fields on websites', 'alert')
      return
    }
    const focused = contents.focusedFrame
    const frame =
      focused !== null && !focused.isDestroyed() && /^https?:/i.test(focused.url)
        ? focused
        : contents.mainFrame
    const started = Date.now()
    this.wire(contents)
    try {
      frame.send(IPC.pageAction, { op: 'safe.key' })
    } catch {
      return
    }
    if (this.keyTimer !== null) clearTimeout(this.keyTimer)
    this.keyTimer = setTimeout(() => {
      this.keyTimer = null
      if (contents.isDestroyed() || (this.keyedAt.get(contents.id) ?? 0) >= started) return
      this.host.toast('No sign-in field on this page', 'alert')
    }, SAFE_KEY_WAIT_MS)
  }

  private show(
    contents: WebContents,
    ref: FrameRef,
    menu: SafeMenu,
    rect: Rect | null,
    anchor: Point,
  ): void {
    if (this.suggest !== null) this.endSuggest()
    menu.favicon = this.host.favicon(contents)
    const session: Suggest = {
      requestId: menu.requestId,
      contents,
      ref,
      kind: menu.kind,
      field: menu.field,
      rect,
      anchor,
      height: null,
      selected: false,
      visible: true,
      bounds: null,
      blurTimer: null,
    }
    const bounds = this.boundsFor(session)
    if (bounds === null) return
    session.bounds = bounds
    this.suggest = session
    this.host.overlay.show(
      'suggest',
      this.host.contentSize(),
      { type: 'safe.suggest', menu },
      bounds,
    )
    this.sendState(ref, { open: true, visible: true, selected: false })
  }

  private fieldInWindow(s: Suggest): Rect | null {
    const view = this.host.viewBounds(s.contents)
    if (view === null) return null
    if (s.rect === null)
      return { x: s.anchor.x, y: s.anchor.y, width: SUGGEST_MIN_WIDTH, height: 0 }
    const zoom = s.contents.getZoomFactor()
    const r = {
      x: view.x + s.rect.x * zoom,
      y: view.y + s.rect.y * zoom,
      width: s.rect.width * zoom,
      height: s.rect.height * zoom,
    }
    const visible =
      r.y + r.height > view.y &&
      r.y < view.y + view.height &&
      r.x + r.width > view.x &&
      r.x < view.x + view.width
    return visible ? r : null
  }

  private boundsFor(s: Suggest): Rect | null {
    const view = this.host.viewBounds(s.contents)
    const field = this.fieldInWindow(s)
    if (view === null || field === null) return null
    return suggestBounds(field, view, this.host.contentSize(), s.height ?? SUGGEST_ESTIMATE)
  }

  private place(): void {
    const s = this.suggest
    if (s === null) return
    const bounds = s.height === 0 ? null : this.boundsFor(s)
    this.host.overlay.place('suggest', bounds)
    const before = s.bounds
    s.bounds = bounds
    const moved = bounds !== null && (before?.x !== bounds.x || before.y !== bounds.y)
    if (moved) this.host.overlay.sendUi({ type: 'safe.suggest.moved', requestId: s.requestId })
    const visible = bounds !== null
    if (visible !== s.visible) {
      s.visible = visible
      this.sendState(s.ref, { open: true, visible, selected: s.selected && visible })
    }
  }

  private endSuggest(): void {
    const s = this.suggest
    if (s === null) return
    this.suggest = null
    if (s.blurTimer !== null) clearTimeout(s.blurTimer)
    this.sendState(s.ref, CLOSED)
  }

  closeSuggest(cancelPending = true): void {
    if (cancelPending) this.opening++
    if (this.suggest === null) return
    this.endSuggest()
    if (this.host.overlay.part === 'suggest') this.host.overlay.hide()
  }

  command(command: SafeCommand): void {
    const report = (out: SafeOutcome | null) => {
      if (out !== null) this.host.toast(out.message, out.ok ? 'check' : 'alert')
    }
    const s = this.suggest
    const mine = (requestId: string) => s !== null && s.requestId === requestId
    switch (command.type) {
      case 'safe.fit':
        if (s === null || !mine(command.requestId)) return
        s.height = Math.max(0, Math.min(command.height, this.host.contentSize().height))
        this.place()
        return
      case 'safe.selected':
        if (s === null || !mine(command.requestId)) return
        s.selected = command.selected
        this.sendState(s.ref, { open: true, visible: s.visible, selected: s.selected })
        return
      case 'safe.close':
        if (mine(command.requestId)) this.closeSuggest()
        return
      case 'safe.choose':
        this.closeSuggest()
        void this.safe.choose(command.requestId, command.id).then(report)
        return
      case 'safe.generate':
        this.closeSuggest()
        void this.safe.generate(command.requestId).then(report)
        return
      case 'safe.passkey':
        this.closeSuggest()
        void this.safe.usePasskey(command.requestId, command.credentialId).then(report)
        return
      case 'safe.unlock':
        this.unlockSuggest(command.requestId)
        return
      case 'safe.openApp':
        this.closeSuggest()
        if (this.host.overlay.part !== 'none') this.host.hideOverlay()
        if (!this.safe.openApp()) this.host.toast('Safe is not installed', 'alert')
        return
      case 'safe.prompt':
        this.settlePrompt(command.promptId, command.action, report)
        return
      case 'safe.sheet':
        void this.sheetAction(command.sheetId, command.action, command.credentialId)
        return
    }
  }

  private unlockSuggest(requestId: string): void {
    const s = this.suggest
    const target = this.safe.frameOf(requestId)
    const session = s !== null && s.requestId === requestId ? s : null
    this.closeSuggest()
    void this.safe.unlock().then((ok) => {
      if (!ok) {
        this.host.toast('Safe is still locked', 'alert')
        return
      }
      if (session === null || target === null) return
      const ref = frameRef(target.contents, target.frame)
      void this.safe
        .menu(target.contents, target.frame, session.kind, session.field)
        .then((menu) => {
          if (this.host.activeContents() !== target.contents || this.frameOf(ref) === null) return
          this.show(target.contents, ref, menu, session.rect, session.anchor)
        })
    })
  }

  async passkey(
    contents: WebContents,
    frame: WebFrameMain,
    request: SafePasskeyRequest,
  ): Promise<SafePasskeyReply | boolean> {
    this.wire(contents)
    if (request.op === 'available') return this.safe.passkeysReady()
    if (request.op === 'abort') {
      this.abort(frameRef(contents, frame), request.id)
      return true
    }
    if (!(await this.safe.passkeysReady())) return { native: true }
    if (frame.origin === 'null' || frame.origin === '')
      return fail('NotAllowedError', 'This frame has no origin passkeys can use.')
    if (crossOrigin(frame))
      return fail('NotAllowedError', 'Passkeys in a frame from another site are not supported.')
    if (request.origin !== frame.origin)
      return fail('NotAllowedError', 'The page changed while it asked for a passkey.')
    const ref = frameRef(contents, frame)
    if (request.op === 'create') return this.create(contents, ref, request.id, request.options)
    return this.get(contents, ref, request.id, request.options, request.mediation)
  }

  private create(
    contents: WebContents,
    ref: FrameRef,
    id: string,
    raw: Record<string, unknown>,
  ): Promise<SafePasskeyReply> | SafePasskeyReply {
    const parsed = parseCreate(raw)
    if (!parsed.ok) return parsed
    if (parsed.value.attachment === 'cross-platform') return { native: true }
    const rp = checkRpId(ref.origin, parsed.value.rpId)
    if (!rp.ok) return rp
    return this.openSheet(contents, ref, id, rp.value, 'create', parsed.value, null)
  }

  private get(
    contents: WebContents,
    ref: FrameRef,
    id: string,
    raw: Record<string, unknown>,
    mediation: string,
  ): Promise<SafePasskeyReply> | SafePasskeyReply {
    const parsed = parseGet(raw, mediation)
    if (!parsed.ok) return parsed
    const rp = checkRpId(ref.origin, parsed.value.rpId)
    if (!rp.ok) return rp
    if (parsed.value.mediation === 'silent')
      return fail('NotAllowedError', 'Safe needs a click to use a passkey.')
    if (parsed.value.mediation === 'conditional') {
      const options = parsed.value
      return new Promise((resolve) => {
        this.safe.passkeys.wait({ ref, id, rpId: rp.value, options, resolve })
      })
    }
    return this.openSheet(contents, ref, id, rp.value, 'get', null, parsed.value)
  }

  private openSheet(
    contents: WebContents,
    ref: FrameRef,
    id: string,
    rpId: string,
    mode: 'create' | 'get',
    create: CreateOptions | null,
    get: GetOptions | null,
  ): Promise<SafePasskeyReply> | SafePasskeyReply {
    if (this.sheet !== null)
      return fail('NotAllowedError', 'Another passkey request is already open.')
    if (this.host.activeContents() !== contents)
      return fail('NotAllowedError', 'Passkeys work only in the tab you are looking at.')
    const timeout = create?.timeout ?? get?.timeout ?? 0
    return new Promise((resolve) => {
      const sheet: Sheet = {
        sheetId: randomUUID(),
        id,
        mode,
        ref,
        contents,
        rpId,
        create,
        get,
        offered: new Set(),
        into: null,
        busy: true,
        timer: setTimeout(() => {
          this.finish(sheet, fail('NotAllowedError', 'The passkey request timed out.'))
        }, timeout),
        resolve,
      }
      this.sheet = sheet
      void this.showSheet(sheet)
    })
  }

  private async loginFor(
    origin: string,
    userName: string,
  ): Promise<{
    id: string
    title: string
    username: string
  } | null> {
    const site = siteOf(origin)
    if (site === null || userName.trim() === '') return null
    const logins = await this.safe.logins(site, 'login')
    const found = logins?.find(
      (l) => l.match === 'exact' && l.passkey === 'none' && sameUser(l.username, userName),
    )
    return found === undefined
      ? null
      : { id: found.id, title: found.title, username: found.username }
  }

  private async showSheet(sheet: Sheet): Promise<void> {
    const state = await this.safe.state()
    if (this.sheet !== sheet) return
    if (state === 'unavailable' || state === 'not-set-up') {
      this.finish(sheet, { native: true })
      return
    }
    const model: SafeSheet = {
      sheetId: sheet.sheetId,
      mode: sheet.mode,
      state: state === 'locked' ? 'locked' : 'ready',
      rpId: sheet.rpId,
      userName: displayText(sheet.create?.userName ?? ''),
      displayName: displayText(sheet.create?.displayName ?? ''),
      into: null,
      passkeys: [],
    }
    if (model.state === 'ready' && sheet.get !== null) {
      const list = await this.safe.passkeys.list(sheet.rpId, sheet.get.allow)
      if (list === null) model.state = 'locked'
      else {
        model.passkeys = list
        sheet.offered = new Set(list.map((p) => p.credentialId))
        if (list.length === 0) model.state = 'empty'
      }
    }
    if (model.state === 'ready' && sheet.create !== null) {
      const into = await this.loginFor(sheet.ref.origin, sheet.create.userName)
      sheet.into = into?.id ?? null
      model.into = into === null ? null : { title: into.title, username: into.username }
    }
    if (this.sheet !== sheet) return
    if (this.host.activeContents() !== sheet.contents || this.frameOf(sheet.ref) === null) {
      this.finish(sheet, fail('NotAllowedError', 'The page is no longer in front.'))
      return
    }
    this.closeSuggest()
    this.host.overlay.show('sheet', this.host.contentSize(), { type: 'safe.sheet', sheet: model })
    sheet.busy = false
  }

  private async sheetAction(
    sheetId: string,
    action: SafeSheetAction,
    credentialId: string | undefined,
  ): Promise<void> {
    const sheet = this.sheet
    if (sheet?.sheetId !== sheetId || sheet.busy) return
    switch (action) {
      case 'cancel':
        this.finish(sheet, fail('NotAllowedError', 'The passkey request was cancelled.'))
        return
      case 'native':
        this.finish(sheet, { native: true })
        return
      case 'unlock': {
        sheet.busy = true
        this.host.hideOverlay()
        const ok = await this.safe.unlock()
        if (this.sheet !== sheet) return
        if (!ok) this.host.toast('Safe is still locked', 'alert')
        await this.showSheet(sheet)
        return
      }
      case 'save': {
        if (sheet.create === null) return
        if (this.frameOf(sheet.ref) === null) {
          this.finish(sheet, fail('NotAllowedError', 'The page changed.'))
          return
        }
        sheet.busy = true
        this.host.hideOverlay()
        const reply = await this.safe.passkeys.create(
          sheet.ref.origin,
          sheet.rpId,
          sheet.create,
          sheet.into,
        )
        if (this.sheet !== sheet) return
        this.finish(sheet, reply)
        this.reportPasskey(reply, 'Passkey saved in Safe')
        return
      }
      case 'pick': {
        if (sheet.get === null || credentialId === undefined || !sheet.offered.has(credentialId))
          return
        if (this.frameOf(sheet.ref) === null) {
          this.finish(sheet, fail('NotAllowedError', 'The page changed.'))
          return
        }
        sheet.busy = true
        this.host.hideOverlay()
        const reply = await this.safe.passkeys.assert(
          sheet.ref.origin,
          sheet.rpId,
          sheet.get.challenge,
          credentialId,
        )
        if (this.sheet !== sheet) return
        this.finish(sheet, reply)
        this.reportPasskey(reply, null)
        return
      }
    }
  }

  private reportPasskey(reply: SafePasskeyReply, success: string | null): void {
    if ('native' in reply) return
    if (reply.ok) {
      if (success !== null) this.host.toast(success, 'check')
      return
    }
    this.host.toast(reply.message, 'alert')
  }

  private finish(sheet: Sheet, reply: SafePasskeyReply): void {
    if (this.sheet !== sheet) return
    clearTimeout(sheet.timer)
    this.sheet = null
    sheet.resolve(reply)
    if (this.host.overlay.part === 'sheet') this.host.hideOverlay()
  }

  private abort(ref: FrameRef, id: string): void {
    const sheet = this.sheet
    if (sheet !== null && sheet.id === id && frameKey(sheet.ref) === frameKey(ref))
      this.finish(sheet, aborted())
    this.safe.passkeys.take(ref, id)?.resolve(aborted())
  }

  capture(contents: WebContents, frame: WebFrameMain, username: string, password: string): void {
    const promptId = this.safe.capture(contents, frame, username, password)
    if (promptId === null || this.promptPending.has(promptId)) return
    this.promptPending.add(promptId)
    let fired = false
    const fire = () => {
      if (fired) return
      fired = true
      clearTimeout(fallback)
      if (!contents.isDestroyed()) {
        contents.off('did-navigate', onNavigate)
        contents.off('did-navigate-in-page', onNavigate)
      }
      setTimeout(() => void this.showPrompt(promptId, 0), SAFE_PROMPT_SETTLE_MS)
    }
    const onNavigate = () => fire()
    contents.on('did-navigate', onNavigate)
    contents.on('did-navigate-in-page', onNavigate)
    const fallback = setTimeout(fire, SAFE_PROMPT_FALLBACK_MS)
  }

  private async showPrompt(promptId: string, attempt: number): Promise<void> {
    if (this.host.window.isDestroyed()) return
    const part = this.host.overlay.part
    if (part !== 'none' && part !== 'toast') {
      if (attempt >= SAFE_PROMPT_RETRIES) {
        this.promptPending.delete(promptId)
        this.safe.drop(promptId)
        return
      }
      setTimeout(() => void this.showPrompt(promptId, attempt + 1), SAFE_PROMPT_RETRY_MS)
      return
    }
    const prompt = await this.safe.prompt(promptId)
    this.promptPending.delete(promptId)
    if (prompt === null || this.host.window.isDestroyed()) return
    const now = this.host.overlay.part
    if (now !== 'none' && now !== 'toast') {
      this.safe.drop(promptId)
      return
    }
    if (this.promptId !== null) this.safe.drop(this.promptId)
    this.promptId = promptId
    this.host.overlay.show('prompt', this.host.contentSize(), { type: 'safe.prompt', prompt })
    if (this.promptTimer !== null) clearTimeout(this.promptTimer)
    this.promptTimer = setTimeout(() => {
      this.promptTimer = null
      if (this.promptId !== promptId) return
      this.promptId = null
      this.safe.drop(promptId)
      if (this.host.overlay.part === 'prompt') this.host.overlay.hide()
    }, SAFE_PROMPT_SHOW_MS)
  }

  private settlePrompt(
    promptId: string,
    action: 'save' | 'update' | 'never' | 'dismiss',
    report: (out: SafeOutcome | null) => void,
  ): void {
    if (this.promptId === promptId) {
      this.promptId = null
      if (this.promptTimer !== null) clearTimeout(this.promptTimer)
      this.promptTimer = null
      if (this.host.overlay.part === 'prompt') this.host.overlay.hide()
    }
    void this.safe.settle(promptId, action).then(report)
  }
}
