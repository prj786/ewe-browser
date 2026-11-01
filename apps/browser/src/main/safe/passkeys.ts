import type { WebContents, WebFrameMain } from 'electron'
import type { SafePasskey, SafePasskeyReply } from '@ewe/shared'
import type { SafeClient, SafeReply } from './client'
import {
  assertionJson,
  b64u,
  clientDataJSON,
  fail,
  registrationJson,
  safeError,
  sha256,
  type CreateOptions,
  type GetOptions,
  type WebAuthnError,
} from './webauthn'

export interface FrameRef {
  contentsId: number
  processId: number
  routingId: number
  origin: string
}

export interface Conditional {
  ref: FrameRef
  id: string
  rpId: string
  options: GetOptions
  resolve(reply: SafePasskeyReply): void
}

const LIST_TIMEOUT_MS = 5_000
const SIGN_TIMEOUT_MS = 30_000
const SAVE_TIMEOUT_MS = 120_000
const LIST_LIMIT = 20

export function frameRef(contents: WebContents, frame: WebFrameMain): FrameRef {
  return {
    contentsId: contents.id,
    processId: frame.processId,
    routingId: frame.routingId,
    origin: frame.origin,
  }
}

export const frameKey = (ref: { processId: number; routingId: number }): string =>
  `${String(ref.processId)}:${String(ref.routingId)}`

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

export function parsePasskeys(reply: SafeReply, rpId: string): SafePasskey[] {
  const list = reply.passkeys
  if (!Array.isArray(list)) return []
  const out: SafePasskey[] = []
  for (const value of list) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    const credentialId = text(v.credential_id)
    if (!/^[A-Za-z0-9_-]{2,1400}$/.test(credentialId) || text(v.rp_id) !== rpId) continue
    if (out.some((p) => p.credentialId === credentialId)) continue
    out.push({
      credentialId,
      title: text(v.title) || rpId,
      username: text(v.username),
      rpId,
    })
    if (out.length >= LIST_LIMIT) break
  }
  return out
}

export class PasskeyBroker {
  private readonly client: SafeClient
  private readonly conditional = new Map<string, Conditional>()

  constructor(client: SafeClient) {
    this.client = client
  }

  async list(rpId: string, allow: string[]): Promise<SafePasskey[] | null> {
    const args: Record<string, unknown> = { rp_id: rpId }
    if (allow.length > 0) args.allow = allow
    const reply = await this.client.call('passkey-list', args, LIST_TIMEOUT_MS)
    if (!reply.ok) return null
    return parsePasskeys(reply, rpId)
  }

  async create(
    origin: string,
    rpId: string,
    options: CreateOptions,
    itemId: string | null,
  ): Promise<SafePasskeyReply> {
    const clientData = clientDataJSON('webauthn.create', options.challenge, origin)
    const args: Record<string, unknown> = {
      rp_id: rpId,
      rp_name: options.rpName || rpId,
      user_id: options.userId,
      user_name: options.userName,
      user_display_name: options.displayName,
      client_data_hash: b64u(sha256(clientData)),
      algorithms: options.algorithms,
      exclude: options.exclude,
      origin,
      user_verified: true,
    }
    if (itemId !== null) args.item_id = itemId
    const reply = await this.client.call('passkey-create', args, SAVE_TIMEOUT_MS)
    if (!reply.ok) return safeError(reply.error, reply.message)
    const credential = registrationJson(reply, clientData, rpId, options.credProps)
    return credential === null
      ? fail('UnknownError', 'ewe Safe answered with a passkey that does not fit this site.')
      : { ok: true, credential }
  }

  async assert(
    origin: string,
    rpId: string,
    challenge: string,
    credentialId: string,
  ): Promise<SafePasskeyReply> {
    const clientData = clientDataJSON('webauthn.get', challenge, origin)
    const reply = await this.client.call(
      'passkey-get',
      {
        rp_id: rpId,
        credential_id: credentialId,
        client_data_hash: b64u(sha256(clientData)),
        user_verified: true,
      },
      SIGN_TIMEOUT_MS,
    )
    if (!reply.ok) return safeError(reply.error, reply.message)
    const credential = assertionJson(reply, clientData, rpId, credentialId)
    return credential === null
      ? fail('UnknownError', 'ewe Safe answered with a signature that does not fit this site.')
      : { ok: true, credential }
  }

  wait(entry: Conditional): void {
    const key = frameKey(entry.ref)
    const old = this.conditional.get(key)
    this.conditional.set(key, entry)
    old?.resolve(fail('NotAllowedError', 'A newer passkey request replaced this one.'))
  }

  conditionalFor(ref: FrameRef): Conditional | null {
    const entry = this.conditional.get(frameKey(ref))
    if (entry === undefined) return null
    if (entry.ref.origin !== ref.origin || entry.ref.contentsId !== ref.contentsId) return null
    return entry
  }

  take(ref: FrameRef, id?: string): Conditional | null {
    const entry = this.conditionalFor(ref)
    if (entry === null || (id !== undefined && entry.id !== id)) return null
    this.conditional.delete(frameKey(ref))
    return entry
  }

  dropFrame(processId: number, routingId: number, error: WebAuthnError): void {
    const key = frameKey({ processId, routingId })
    const entry = this.conditional.get(key)
    if (entry === undefined) return
    this.conditional.delete(key)
    entry.resolve(error)
  }

  prune(alive: (ref: FrameRef) => boolean, error: WebAuthnError): void {
    for (const [key, entry] of this.conditional) {
      if (alive(entry.ref)) continue
      this.conditional.delete(key)
      entry.resolve(error)
    }
  }

  dropContents(contentsId: number, error: WebAuthnError): void {
    for (const [key, entry] of this.conditional) {
      if (entry.ref.contentsId !== contentsId) continue
      this.conditional.delete(key)
      entry.resolve(error)
    }
  }
}
