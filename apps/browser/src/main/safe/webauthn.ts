import { createHash } from 'node:crypto'
import { getDomain } from 'tldts'

export type WebAuthnErrorName =
  | 'NotAllowedError'
  | 'InvalidStateError'
  | 'NotSupportedError'
  | 'AbortError'
  | 'SecurityError'
  | 'TypeError'
  | 'UnknownError'

export interface WebAuthnError {
  ok: false
  name: WebAuthnErrorName
  message: string
}

export type Checked<T> = { ok: true; value: T } | WebAuthnError

export interface CreateOptions {
  challenge: string
  rpId: string | null
  rpName: string
  userId: string
  userName: string
  displayName: string
  algorithms: number[]
  exclude: string[]
  attachment: 'platform' | 'cross-platform' | null
  timeout: number
  credProps: boolean
}

export type Mediation = 'conditional' | 'optional' | 'required' | 'silent'

export interface GetOptions {
  challenge: string
  rpId: string | null
  allow: string[]
  timeout: number
  mediation: Mediation
}

export const DEFAULT_ALGORITHMS = [-7, -257]
export const TRANSPORTS = ['internal', 'hybrid']
export const TIMEOUT_DEFAULT_MS = 300_000
export const TIMEOUT_MIN_MS = 30_000
export const TIMEOUT_MAX_MS = 600_000

const CHALLENGE_MAX = 1024
const CREDENTIAL_ID_MAX = 1023
const USER_ID_MAX = 64
const LIST_MAX = 256
const NAME_MAX = 256
const FLAG_UP = 0x01
const FLAG_AT = 0x40
const AUTH_DATA_MIN = 37

export function fail(name: WebAuthnErrorName, message: string): WebAuthnError {
  return { ok: false, name, message }
}

export function b64u(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString('base64url')
}

export function fromB64u(text: unknown): Buffer | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1)
    return null
  return Buffer.from(text, 'base64url')
}

export function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest()
}

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')
}

function isDomainSyntax(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false
  if (!/^[a-z0-9.-]+$/.test(value)) return false
  return value.split('.').every((label) => label.length > 0 && label.length <= 63)
}

export function checkRpId(origin: string, requested: string | null): Checked<string> {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return fail('SecurityError', 'This page has no origin passkeys can use.')
  }
  const host = url.hostname
  const local = host === 'localhost'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    return fail('SecurityError', 'Passkeys need a secure (https) page.')
  if (host === '' || isIp(host))
    return fail('SecurityError', 'Passkeys need a domain name, not an address.')
  const rpId = requested ?? host
  if (!isDomainSyntax(rpId)) return fail('SecurityError', 'The relying party id is not valid.')
  if (local || rpId === 'localhost')
    return local && rpId === 'localhost'
      ? { ok: true, value: rpId }
      : fail('SecurityError', 'The relying party id does not match this site.')
  if (host !== rpId && !host.endsWith(`.${rpId}`))
    return fail('SecurityError', 'The relying party id does not match this site.')
  const registrable = getDomain(rpId, { allowPrivateDomains: true })
  if (registrable === null || !(rpId === registrable || rpId.endsWith(`.${registrable}`)))
    return fail('SecurityError', 'The relying party id is a public suffix.')
  return { ok: true, value: rpId }
}

const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const DISPLAY_MAX = 64

export function displayText(value: string): string {
  const clean = value.replace(UNSAFE_TEXT, '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(new Intl.Segmenter().segment(clean), (s) => s.segment)
  return chars.length > DISPLAY_MAX ? `${chars.slice(0, DISPLAY_MAX - 1).join('')}…` : clean
}

export function clientDataJSON(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
  origin: string,
): string {
  return JSON.stringify({ type, challenge, origin, crossOrigin: false })
}

export function clampTimeout(value: unknown): number {
  const ms = typeof value === 'number' && Number.isFinite(value) ? value : TIMEOUT_DEFAULT_MS
  return Math.round(Math.min(TIMEOUT_MAX_MS, Math.max(TIMEOUT_MIN_MS, ms)))
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, NAME_MAX) : fallback
}

function bytesField(value: unknown, min: number, max: number): string | null {
  const bytes = fromB64u(value)
  if (bytes === null || bytes.length < min || bytes.length > max) return null
  return b64u(bytes)
}

function credentialIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const entry of value.slice(0, LIST_MAX)) {
    const r = record(entry)
    if (r === null) return null
    if (r.type !== undefined && r.type !== 'public-key') continue
    const id = bytesField(r.id, 1, CREDENTIAL_ID_MAX)
    if (id === null) return null
    out.push(id)
  }
  return out
}

function rpIdField(value: unknown): Checked<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return fail('TypeError', 'The relying party id must be text.')
  return { ok: true, value }
}

export function parseCreate(raw: unknown): Checked<CreateOptions> {
  const o = record(raw)
  if (o === null) return fail('TypeError', 'The passkey options are missing.')
  const challenge = bytesField(o.challenge, 1, CHALLENGE_MAX)
  if (challenge === null) return fail('TypeError', 'The challenge is missing or too long.')
  const rp = record(o.rp)
  if (rp === null) return fail('TypeError', 'The relying party is missing.')
  const rpId = rpIdField(rp.id)
  if (!rpId.ok) return rpId
  const user = record(o.user)
  if (user === null) return fail('TypeError', 'The user is missing.')
  const userId = bytesField(user.id, 1, USER_ID_MAX)
  if (userId === null) return fail('TypeError', 'The user id must be 1 to 64 bytes.')
  const params = o.pubKeyCredParams
  if (params !== undefined && !Array.isArray(params))
    return fail('TypeError', 'The key types are not a list.')
  const algorithms: number[] = []
  for (const entry of Array.isArray(params) ? params.slice(0, LIST_MAX) : []) {
    const p = record(entry)
    if (p?.type !== 'public-key') continue
    const alg = Number(p.alg)
    if (Number.isInteger(alg) && !algorithms.includes(alg)) algorithms.push(alg)
  }
  if (Array.isArray(params) && params.length > 0 && algorithms.length === 0)
    return fail('NotSupportedError', 'None of the key types the site asks for is supported.')
  const exclude = credentialIds(o.excludeCredentials)
  if (exclude === null) return fail('TypeError', 'The excluded credentials are not valid.')
  const selection = record(o.authenticatorSelection)
  const attachment = selection?.authenticatorAttachment
  const extensions = record(o.extensions)
  return {
    ok: true,
    value: {
      challenge,
      rpId: rpId.value,
      rpName: text(rp.name),
      userId,
      userName: text(user.name),
      displayName: text(user.displayName),
      algorithms: algorithms.length > 0 ? algorithms : DEFAULT_ALGORITHMS,
      exclude,
      attachment: attachment === 'platform' || attachment === 'cross-platform' ? attachment : null,
      timeout: clampTimeout(o.timeout),
      credProps: extensions?.credProps === true,
    },
  }
}

export function parseGet(raw: unknown, mediation: string): Checked<GetOptions> {
  const o = record(raw)
  if (o === null) return fail('TypeError', 'The passkey options are missing.')
  const challenge = bytesField(o.challenge, 1, CHALLENGE_MAX)
  if (challenge === null) return fail('TypeError', 'The challenge is missing or too long.')
  const rpId = rpIdField(o.rpId)
  if (!rpId.ok) return rpId
  const allow = credentialIds(o.allowCredentials)
  if (allow === null) return fail('TypeError', 'The allowed credentials are not valid.')
  const mode: Mediation =
    mediation === 'conditional' || mediation === 'required' || mediation === 'silent'
      ? mediation
      : 'optional'
  return {
    ok: true,
    value: {
      challenge,
      rpId: rpId.value,
      allow,
      timeout: clampTimeout(o.timeout),
      mediation: mode,
    },
  }
}

function authDataFits(authData: Buffer, rpId: string, flags: number): boolean {
  if (authData.length < AUTH_DATA_MIN) return false
  if (!authData.subarray(0, 32).equals(sha256(rpId))) return false
  const actual = authData[32] ?? 0
  return (actual & flags) === flags
}

export function registrationJson(
  reply: Record<string, unknown>,
  clientData: string,
  rpId: string,
  credProps: boolean,
): Record<string, unknown> | null {
  const id = fromB64u(reply.credential_id)
  const attestation = fromB64u(reply.attestation_object)
  const authData = fromB64u(reply.authenticator_data)
  const publicKey = fromB64u(reply.public_key)
  const algorithm = reply.public_key_algorithm
  if (id === null || id.length === 0 || id.length > CREDENTIAL_ID_MAX) return null
  if (attestation === null || attestation.length === 0) return null
  if (authData === null || !authDataFits(authData, rpId, FLAG_UP | FLAG_AT)) return null
  if (publicKey === null || publicKey.length === 0) return null
  if (typeof algorithm !== 'number' || !Number.isInteger(algorithm)) return null
  return {
    id: b64u(id),
    rawId: b64u(id),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: b64u(clientData),
      attestationObject: b64u(attestation),
      authenticatorData: b64u(authData),
      publicKey: b64u(publicKey),
      publicKeyAlgorithm: algorithm,
      transports: TRANSPORTS,
    },
    clientExtensionResults: credProps ? { credProps: { rk: true } } : {},
  }
}

export function assertionJson(
  reply: Record<string, unknown>,
  clientData: string,
  rpId: string,
  credentialId: string,
): Record<string, unknown> | null {
  const id = fromB64u(reply.credential_id)
  const authData = fromB64u(reply.authenticator_data)
  const signature = fromB64u(reply.signature)
  const handle = reply.user_handle === null ? Buffer.alloc(0) : fromB64u(reply.user_handle)
  if (id === null || b64u(id) !== credentialId) return null
  if (authData === null || !authDataFits(authData, rpId, FLAG_UP)) return null
  if (signature === null || signature.length === 0) return null
  if (handle === null) return null
  return {
    id: b64u(id),
    rawId: b64u(id),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: b64u(clientData),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
      userHandle: handle.length === 0 ? null : b64u(handle),
    },
    clientExtensionResults: {},
  }
}

export function safeError(error: string | undefined, message: string | undefined): WebAuthnError {
  switch (error) {
    case 'excluded':
      return fail('InvalidStateError', 'A passkey for this account is already in Safe.')
    case 'unsupported':
      return fail('NotSupportedError', 'None of the key types the site asks for is supported.')
    case 'not-found':
      return fail('NotAllowedError', 'That passkey is not in Safe.')
    case 'locked':
      return fail('NotAllowedError', 'Safe is locked.')
    default:
      return fail('NotAllowedError', message ?? 'Safe could not use the passkey.')
  }
}
