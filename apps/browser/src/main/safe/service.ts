import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  webContents as allContents,
  webFrameMain,
  type WebContents,
  type WebFrameMain,
} from 'electron'
import {
  IPC,
  siteHostOf,
  type SafeCaptureKind,
  type SafeField,
  type SafeFieldKind,
  type SafeFill,
  type SafeLogin,
  type SafeMenu,
  type SafeMenuState,
  type SafePageState,
  type SafePasskey,
  type SafePrompt,
  type SafePromptAction,
  type SafeSettings,
} from '@ewe/shared'
import type { SettingsStore } from '../storage/settings-store'
import { SafeClient, parseLine, type SafeReply } from './client'
import { candidatesToCheck, decideSave, type SaveDecision } from './decide'
import { PasskeyBroker, frameRef } from './passkeys'
import { SignupMemory, type Draft, type DraftFrame } from './signup'
import { displayHost, matchLogins, matchSite, siteOf, type Site, type SiteMatch } from './site'
import { SafeWallet, type WalletRef, type WalletTarget } from './wallet'

export interface Summary {
  id: string
  title: string
  username: string
  urls: string[]
  hasOtp: boolean
  passkey: 'none' | 'some' | 'unknown'
}

interface MenuRequest {
  contentsId: number
  processId: number
  routingId: number
  origin: string
  kind: SafeFieldKind
  logins: Map<string, string>
  passkeys: Set<string>
  conditional: string | null
  created: number
}

interface Capture {
  contentsId: number
  origin: string
  site: Site
  kind: SafeCaptureKind
  username: string
  password: string
  decision: SaveDecision | null
  created: number
  busy: boolean
}

export interface CaptureInput {
  kind: SafeCaptureKind
  username: string
  password: string
}

export type UnlockSave =
  { kind: 'done'; outcome: SafeOutcome | null } | { kind: 'prompt'; prompt: SafePrompt }

export interface SafeOutcome {
  ok: boolean
  message: string
}

export interface SafeTools {
  cli(): string | null
  app(): string | null
}

const STATUS_TIMEOUT_MS = 5_000
const READY_TTL_MS = 2_000
const PASSKEY_LIMIT = 10
const REQUEST_TTL_MS = 120_000
const CAPTURE_TTL_MS = 120_000
const UNLOCK_TIMEOUT_MS = 300_000
const MENU_LIMIT = 30
const GENERATE_LENGTH = 20
const DUPLICATE_WINDOW_MS = 3_000

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

export function parseSummaries(reply: SafeReply): Summary[] {
  const items = reply.items
  if (!Array.isArray(items)) return []
  return items.flatMap((value): Summary[] => {
    if (typeof value !== 'object' || value === null) return []
    const v = value as Record<string, unknown>
    const id = text(v.id)
    if (id === '' || (v.kind !== undefined && v.kind !== 'login')) return []
    const urls = Array.isArray(v.urls)
      ? v.urls.filter((u): u is string => typeof u === 'string')
      : []
    return [
      {
        id,
        title: text(v.title) || id,
        username: text(v.username),
        urls,
        hasOtp: v.has_otp === true,
        passkey: v.passkey === null ? 'none' : v.passkey === undefined ? 'unknown' : 'some',
      },
    ]
  })
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findTool(
  name: string,
  override: string | undefined,
  pathEnv = process.env.PATH ?? '',
): string | null {
  if (override !== undefined && override !== '') return executable(override) ? override : null
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (executable(candidate)) return candidate
  }
  return null
}

const defaultTools: SafeTools = {
  cli: () => findTool('ewe-safe', process.env.EWE_SAFE_BIN),
  app: () => findTool('ewe-safe-app', process.env.EWE_SAFE_APP),
}

function hostOfUrl(page: Site, urls: string[]): string {
  for (const url of urls) {
    if (matchSite(page, url) === null) continue
    const site = siteOf(url)
    if (site !== null) return displayHost(site)
  }
  return displayHost(page)
}

function resolveFrame(ref: WalletRef): WalletTarget | null {
  const contents = allContents.fromId(ref.contentsId)
  if (contents === undefined || contents.isDestroyed()) return null
  const frame = webFrameMain.fromId(ref.processId, ref.routingId)
  if (frame === undefined || frame.isDestroyed() || frame.origin !== ref.origin) return null
  return {
    send: (channel, value) => {
      frame.send(channel, value)
    },
    focus: () => {
      contents.focus()
    },
  }
}

export class SafeService {
  readonly client: SafeClient
  readonly passkeys: PasskeyBroker
  readonly wallet: SafeWallet
  readonly signup = new SignupMemory()
  private readonly store: SettingsStore
  private readonly tools: SafeTools
  private readonly requests = new Map<string, MenuRequest>()
  private readonly captures = new Map<string, Capture>()
  private ready: { at: number; value: boolean } | null = null

  constructor(
    store: SettingsStore,
    client = new SafeClient(),
    tools: SafeTools = defaultTools,
    resolve: (ref: WalletRef) => WalletTarget | null = resolveFrame,
  ) {
    this.store = store
    this.client = client
    this.tools = tools
    this.passkeys = new PasskeyBroker(client)
    this.wallet = new SafeWallet({
      client,
      settings: () => this.settings(),
      cli: () => this.tools.cli(),
      state: () => this.state(),
      resolve,
    })
    this.client.on('event', (event) => {
      if (event.event === 'locked' || event.event === 'gone') {
        this.requests.clear()
        this.wallet.clear()
      }
      this.ready = null
    })
  }

  settings(): SafeSettings {
    return this.store.get().safe
  }

  pageState(): SafePageState {
    const settings = this.settings()
    const reachable = this.client.available()
    return {
      enabled: settings.fill && reachable,
      suggest: settings.fill && settings.suggest && reachable,
      capture: settings.offerSave && reachable,
      cards: settings.fill && settings.fillCards && reachable,
      addresses: settings.fill && settings.fillAddresses && reachable,
    }
  }

  async passkeysReady(): Promise<boolean> {
    if (!this.settings().passkeys || !this.client.available()) return false
    const now = Date.now()
    if (this.ready !== null && now - this.ready.at < READY_TTL_MS) return this.ready.value
    this.client.watch()
    const status = await this.client.call('status', {}, STATUS_TIMEOUT_MS)
    const value = status.ok && status.set_up === true
    this.ready = { at: now, value }
    return value
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, r] of this.requests)
      if (now - r.created > REQUEST_TTL_MS) this.requests.delete(id)
    for (const [id, c] of this.captures) {
      if (!c.busy && now - c.created > CAPTURE_TTL_MS) {
        c.password = ''
        this.captures.delete(id)
      }
    }
  }

  async state(): Promise<SafeMenuState> {
    this.client.watch()
    const status = await this.client.call('status', {}, STATUS_TIMEOUT_MS)
    if (!status.ok) return 'unavailable'
    if (status.set_up !== true) return 'not-set-up'
    if (status.locked === true) return 'locked'
    return 'ready'
  }

  async logins(
    site: Site,
    kind: SafeFieldKind,
  ): Promise<(Summary & { match: SiteMatch })[] | null> {
    const reply = await this.client.call('list', { kind: 'login' }, STATUS_TIMEOUT_MS)
    if (!reply.ok) return null
    const all = parseSummaries(reply).filter((s) => kind !== 'otp' || s.hasOtp)
    return matchLogins(site, all)
  }

  async menu(
    contents: WebContents,
    frame: WebFrameMain,
    kind: SafeFieldKind,
    field: SafeField,
  ): Promise<SafeMenu> {
    this.prune()
    const requestId = randomUUID()
    const site = siteOf(frame.origin)
    const menu: SafeMenu = {
      requestId,
      kind,
      field,
      state: 'unavailable',
      host: site === null ? '' : displayHost(site),
      favicon: null,
      items: [],
      passkeys: [],
    }
    if (site === null || !this.settings().fill) return menu
    menu.state = await this.state()
    const logins = new Map<string, string>()
    const offered = new Set<string>()
    let conditional: string | null = null
    if (menu.state === 'ready' && kind !== 'new-password') {
      const found = await this.logins(site, kind)
      if (found === null) menu.state = 'locked'
      else {
        const items: SafeLogin[] = found.slice(0, MENU_LIMIT).map((s) => ({
          id: s.id,
          title: s.title,
          username: s.username,
          host: hostOfUrl(site, s.urls),
        }))
        for (const item of items) logins.set(item.id, item.username)
        menu.items = items
        if (kind === 'login') {
          const found = await this.conditionalPasskeys(contents, frame)
          menu.passkeys = found.passkeys
          conditional = found.id
        }
        for (const p of menu.passkeys) offered.add(p.credentialId)
        if (items.length === 0 && menu.passkeys.length === 0) menu.state = 'empty'
      }
    }
    this.requests.set(requestId, {
      contentsId: contents.id,
      processId: frame.processId,
      routingId: frame.routingId,
      origin: frame.origin,
      kind,
      logins,
      passkeys: offered,
      conditional,
      created: Date.now(),
    })
    return menu
  }

  private async conditionalPasskeys(
    contents: WebContents,
    frame: WebFrameMain,
  ): Promise<{ id: string | null; passkeys: SafePasskey[] }> {
    const none = { id: null, passkeys: [] }
    if (!this.settings().passkeys) return none
    const pending = this.passkeys.conditionalFor(frameRef(contents, frame))
    if (pending === null) return none
    const list = await this.passkeys.list(pending.rpId, pending.options.allow)
    return { id: pending.id, passkeys: (list ?? []).slice(0, PASSKEY_LIMIT) }
  }

  async usePasskey(requestId: string, credentialId: string): Promise<SafeOutcome | null> {
    const t = this.target(requestId)
    if (t === null) return { ok: false, message: 'The page changed. Try again.' }
    if (!t.request.passkeys.has(credentialId))
      return { ok: false, message: 'That passkey is not for this site.' }
    const ref = frameRef(t.contents, t.frame)
    const pending = this.passkeys.conditionalFor(ref)
    if (pending?.id !== t.request.conditional || pending === null)
      return { ok: false, message: 'The site stopped waiting for a passkey.' }
    this.requests.delete(requestId)
    const reply = await this.passkeys.assert(
      ref.origin,
      pending.rpId,
      pending.options.challenge,
      credentialId,
    )
    if (this.passkeys.take(ref, pending.id) === null) return null
    pending.resolve(reply)
    if ('ok' in reply && !reply.ok) return { ok: false, message: reply.message }
    return null
  }

  private target(
    requestId: string,
  ): { request: MenuRequest; contents: WebContents; frame: WebFrameMain } | null {
    this.prune()
    const request = this.requests.get(requestId)
    if (request === undefined) return null
    const contents = allContents.fromId(request.contentsId)
    if (contents === undefined || contents.isDestroyed()) return null
    const frame = webFrameMain.fromId(request.processId, request.routingId)
    if (frame === undefined || frame.isDestroyed() || frame.origin !== request.origin) return null
    return { request, contents, frame }
  }

  private send(frame: WebFrameMain, fill: SafeFill): void {
    frame.send(IPC.safeFill, fill)
  }

  async choose(requestId: string, id: string): Promise<SafeOutcome | null> {
    if (this.wallet.has(requestId)) return this.wallet.choose(requestId, id)
    const t = this.target(requestId)
    if (t === null) return { ok: false, message: 'The page changed. Try again.' }
    const username = t.request.logins.get(id)
    if (username === undefined || t.request.kind === 'new-password')
      return { ok: false, message: 'That login is not for this site.' }
    const field = t.request.kind === 'otp' ? 'otp' : 'password'
    const reply = await this.client.call('reveal', { id, field }, STATUS_TIMEOUT_MS)
    if (!reply.ok || typeof reply.value !== 'string')
      return { ok: false, message: reply.message ?? 'Safe could not open that login.' }
    const again = this.target(requestId)
    if (again === null) return { ok: false, message: 'The page changed. Try again.' }
    this.requests.delete(requestId)
    this.send(
      again.frame,
      t.request.kind === 'otp'
        ? { kind: 'otp', otp: reply.value }
        : { kind: 'login', username, password: reply.value },
    )
    again.contents.focus()
    return null
  }

  async generate(requestId: string): Promise<SafeOutcome | null> {
    const t = this.target(requestId)
    if (t === null) return { ok: false, message: 'The page changed. Try again.' }
    const reply = await this.client.call('generate', { length: GENERATE_LENGTH }, STATUS_TIMEOUT_MS)
    if (!reply.ok || typeof reply.value !== 'string')
      return { ok: false, message: reply.message ?? 'Safe could not make a password.' }
    const again = this.target(requestId)
    if (again === null) return { ok: false, message: 'The page changed. Try again.' }
    this.requests.delete(requestId)
    this.send(again.frame, { kind: 'new-password', password: reply.value })
    this.signup.generated(frameRef(again.contents, again.frame), reply.value)
    again.contents.focus()
    return null
  }

  requestAlive(requestId: string): boolean {
    return this.target(requestId) !== null
  }

  frameOf(requestId: string): { contents: WebContents; frame: WebFrameMain } | null {
    const ref = this.wallet.refOf(requestId)
    if (ref !== null) {
      const contents = allContents.fromId(ref.contentsId)
      const frame = webFrameMain.fromId(ref.processId, ref.routingId)
      if (contents === undefined || contents.isDestroyed()) return null
      if (frame === undefined || frame.isDestroyed() || frame.origin !== ref.origin) return null
      return { contents, frame }
    }
    const t = this.target(requestId)
    return t === null ? null : { contents: t.contents, frame: t.frame }
  }

  kindOf(requestId: string): SafeFieldKind | null {
    return this.requests.get(requestId)?.kind ?? null
  }

  unlock(): Promise<boolean> {
    const cli = this.tools.cli()
    if (cli === null) return Promise.resolve(false)
    return new Promise((resolve) => {
      execFile(
        cli,
        ['unlock', '--ask'],
        { timeout: UNLOCK_TIMEOUT_MS, encoding: 'utf8' },
        (_error, stdout) => {
          const value = parseLine(stdout.trim().split('\n').pop() ?? '')
          resolve(value?.ok === true)
        },
      )
    })
  }

  openApp(): boolean {
    const app = this.tools.app()
    if (app === null) return false
    const child = spawn(app, [], { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
    return true
  }

  capture(contentsId: number, origin: string, input: CaptureInput): string | null {
    this.prune()
    const settings = this.settings()
    if (!settings.offerSave) return null
    const site = siteOf(origin)
    const neverHost = siteHostOf(origin)
    if (site === null || neverHost === null || settings.neverSave.includes(neverHost)) return null
    this.signup.drop(contentsId, origin)
    const typed = input.username.trim()
    const username = typed === '' ? this.signup.usernameFor(contentsId, origin) : typed
    const now = Date.now()
    for (const [id, c] of this.captures) {
      if (
        c.contentsId === contentsId &&
        c.origin === origin &&
        c.username === username &&
        c.password === input.password &&
        now - c.created < DUPLICATE_WINDOW_MS
      )
        return id
    }
    const promptId = randomUUID()
    this.captures.set(promptId, {
      contentsId,
      origin,
      site,
      kind: input.kind,
      username,
      password: input.password,
      decision: null,
      created: now,
      busy: false,
    })
    return promptId
  }

  captureDraft(draft: Draft): string | null {
    if (draft.password === '') return null
    return this.capture(draft.contentsId, draft.origin, {
      kind: 'signup',
      username: draft.username,
      password: draft.password,
    })
  }

  rememberUsername(contentsId: number, origin: string, username: string): void {
    if (!this.settings().offerSave) return
    this.signup.rememberUsername(contentsId, origin, username)
  }

  draft(frame: DraftFrame, username: string, keep: boolean): void {
    this.signup.draft(frame, username, keep)
  }

  drop(promptId: string): void {
    const c = this.captures.get(promptId)
    if (c === undefined) return
    c.password = ''
    this.captures.delete(promptId)
  }

  contentsOfCapture(promptId: string): number | null {
    return this.captures.get(promptId)?.contentsId ?? null
  }

  private async decide(c: Capture): Promise<SaveDecision | null> {
    const logins = await this.logins(c.site, 'login')
    if (logins === null) return null
    const candidates = []
    for (const login of candidatesToCheck(c.username, logins, 5, c.kind)) {
      const reply = await this.client.call(
        'reveal',
        { id: login.id, field: 'password' },
        STATUS_TIMEOUT_MS,
      )
      candidates.push({
        id: login.id,
        title: login.title,
        username: login.username,
        samePassword: reply.ok && reply.value === c.password,
        exact: login.match === 'exact',
      })
    }
    return decideSave(c.username, candidates, c.kind)
  }

  private promptOf(promptId: string, c: Capture, locked: boolean): SafePrompt {
    const host = displayHost(c.site)
    const decision = c.decision
    return {
      promptId,
      mode: decision?.mode === 'update' ? 'update' : 'save',
      host,
      username: c.username,
      title: decision?.mode === 'update' ? decision.title : host,
      locked,
    }
  }

  async prompt(promptId: string): Promise<SafePrompt | null> {
    const c = this.captures.get(promptId)
    if (c === undefined) return null
    const state = await this.state()
    if (state === 'locked' && this.captures.has(promptId)) {
      c.decision = null
      return this.promptOf(promptId, c, true)
    }
    if (state !== 'ready') {
      this.drop(promptId)
      return null
    }
    const decision = await this.decide(c)
    if (decision === null || decision.mode === 'none' || !this.captures.has(promptId)) {
      this.drop(promptId)
      return null
    }
    c.decision = decision
    return this.promptOf(promptId, c, false)
  }

  async unlockAndSave(promptId: string): Promise<UnlockSave> {
    const c = this.captures.get(promptId)
    if (c === undefined) return { kind: 'done', outcome: null }
    c.busy = true
    const ok = await this.unlock()
    c.busy = false
    c.created = Date.now()
    if (!this.captures.has(promptId)) return { kind: 'done', outcome: null }
    if (!ok) {
      this.drop(promptId)
      return {
        kind: 'done',
        outcome: { ok: false, message: 'Safe is still locked. The login was not saved.' },
      }
    }
    const decision = await this.decide(c)
    if (decision === null || !this.captures.has(promptId)) {
      this.drop(promptId)
      return { kind: 'done', outcome: { ok: false, message: 'Safe could not save the login.' } }
    }
    c.decision = decision
    if (decision.mode === 'none') {
      this.drop(promptId)
      return { kind: 'done', outcome: { ok: true, message: 'This login is already in Safe' } }
    }
    if (decision.mode === 'update')
      return { kind: 'prompt', prompt: this.promptOf(promptId, c, false) }
    return { kind: 'done', outcome: await this.settle(promptId, 'save') }
  }

  async settle(promptId: string, action: SafePromptAction): Promise<SafeOutcome | null> {
    const c = this.captures.get(promptId)
    if (c === undefined) return null
    this.captures.delete(promptId)
    const password = c.password
    c.password = ''
    const host = displayHost(c.site)
    if (action === 'dismiss' || action === 'unlock') return null
    if (action === 'never') {
      const neverHost = siteHostOf(c.origin)
      if (neverHost === null) return null
      const safe = this.settings()
      if (!safe.neverSave.includes(neverHost))
        this.store.update({ safe: { ...safe, neverSave: [...safe.neverSave, neverHost] } })
      return { ok: true, message: `Safe won't offer to save on ${host}` }
    }
    const decision = c.decision
    if (decision === null || decision.mode === 'none') return null
    if (action === 'update' && decision.mode === 'update') {
      const reply = await this.client.call(
        'edit',
        { id: decision.id, password_value: password },
        UNLOCK_TIMEOUT_MS,
      )
      return reply.ok
        ? { ok: true, message: 'Password updated in Safe' }
        : { ok: false, message: reply.message ?? 'Safe could not update the login.' }
    }
    if (action === 'save' && decision.mode === 'save') {
      const args: Record<string, unknown> = {
        kind: 'login',
        title: host,
        url: [c.origin],
        password_value: password,
      }
      if (c.username !== '') args.username = c.username
      const reply = await this.client.call('add', args, UNLOCK_TIMEOUT_MS)
      return reply.ok
        ? { ok: true, message: 'Saved to Safe' }
        : { ok: false, message: reply.message ?? 'Safe could not save the login.' }
    }
    return null
  }
}
