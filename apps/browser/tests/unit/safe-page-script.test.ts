import { beforeEach, describe, expect, it } from 'vitest'
import { pageScript, type PageBridge } from '../../src/preload/safe/page-script'

class FakeAttestation {
  readonly role = 'attestation'
}
class FakeAssertion {
  readonly role = 'assertion'
}

function credentialClass() {
  class FakeCredential {
    readonly role = 'credential'
  }
  return Object.assign(FakeCredential, {
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(false),
    isConditionalMediationAvailable: () => Promise.resolve(false),
    getClientCapabilities: (): Promise<Record<string, boolean>> =>
      Promise.resolve({ hybridTransport: false }),
  })
}

interface Harness {
  credentials: {
    create(options?: unknown): Promise<unknown>
    get(options?: unknown): Promise<unknown>
  }
  PKC: ReturnType<typeof credentialClass>
  native: { op: string; options: unknown }[]
  bridgeCalls: { op: string; id?: string; options?: unknown; mediation?: string }[]
}

interface Registration {
  id: string
  rawId: ArrayBuffer
  type: string
  authenticatorAttachment: string
  response: {
    clientDataJSON: ArrayBuffer
    attestationObject: ArrayBuffer
    getAuthenticatorData(): ArrayBuffer
    getPublicKey(): ArrayBuffer
    getPublicKeyAlgorithm(): number
    getTransports(): string[]
  }
  getClientExtensionResults(): unknown
  toJSON(): unknown
}

const b64u = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url')
const buf = (value: unknown) => Buffer.from(new Uint8Array(value as ArrayBuffer))

const REGISTRATION = {
  id: b64u('cred-1'),
  rawId: b64u('cred-1'),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    clientDataJSON: b64u('{"type":"webauthn.create"}'),
    attestationObject: b64u('att'),
    authenticatorData: b64u('auth'),
    publicKey: b64u('spki'),
    publicKeyAlgorithm: -7,
    transports: ['internal', 'hybrid'],
  },
  clientExtensionResults: { credProps: { rk: true } },
}

const ASSERTION = {
  id: b64u('cred-1'),
  rawId: b64u('cred-1'),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    clientDataJSON: b64u('{"type":"webauthn.get"}'),
    authenticatorData: b64u('auth'),
    signature: b64u('sig'),
    userHandle: null,
  },
  clientExtensionResults: {},
}

let reply: unknown = { ok: true, credential: REGISTRATION }
let available = true
let hold: Promise<unknown> | null = null

function install(secure = true): Harness {
  const native: Harness['native'] = []
  const bridgeCalls: Harness['bridgeCalls'] = []
  const credentials = {
    create: (options?: unknown) => {
      native.push({ op: 'create', options })
      return Promise.resolve('native-create')
    },
    get: (options?: unknown) => {
      native.push({ op: 'get', options })
      return Promise.resolve('native-get')
    },
  }
  const PKC = credentialClass()
  const win = {
    navigator: { credentials },
    PublicKeyCredential: PKC,
    AuthenticatorAttestationResponse: FakeAttestation,
    AuthenticatorAssertionResponse: FakeAssertion,
    isSecureContext: secure,
    Uint8Array,
    ArrayBuffer,
    String,
    btoa,
    atob,
    DOMException,
    TypeError,
    Promise,
    AbortController,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
  }
  const bridge: PageBridge = {
    available: () => Promise.resolve(available),
    create: (id, options) => {
      bridgeCalls.push({ op: 'create', id, options })
      return hold ?? Promise.resolve(reply)
    },
    get: (id, options, mediation) => {
      bridgeCalls.push({ op: 'get', id, options, mediation })
      return hold ?? Promise.resolve(reply)
    },
    abort: (id) => {
      bridgeCalls.push({ op: 'abort', id })
    },
  }
  const scope = globalThis as unknown as { window?: unknown }
  scope.window = win
  try {
    pageScript(bridge)
  } finally {
    delete scope.window
  }
  return { credentials, PKC, native, bridgeCalls }
}

const createOptions = (extra: Record<string, unknown> = {}) => ({
  publicKey: {
    challenge: new Uint8Array([1, 2, 3, 4]),
    rp: { name: 'Example', id: 'example.com' },
    user: { id: new TextEncoder().encode('user-1'), name: 'sam', displayName: 'Sam' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    excludeCredentials: [{ type: 'public-key', id: new Uint8Array([9, 9]).buffer }],
    extensions: { credProps: true },
  },
  ...extra,
})

beforeEach(() => {
  reply = { ok: true, credential: REGISTRATION }
  available = true
  hold = null
})

describe('the main-world passkey script', () => {
  it('sends the options as base64url and builds a PublicKeyCredential-like object', async () => {
    const h = install()
    const cred = (await h.credentials.create(createOptions())) as Registration
    expect(h.bridgeCalls[0]?.options).toMatchObject({
      challenge: b64u(Uint8Array.from([1, 2, 3, 4])),
      rp: { id: 'example.com', name: 'Example' },
      user: { id: b64u('user-1'), name: 'sam', displayName: 'Sam' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ type: 'public-key', id: b64u(Uint8Array.from([9, 9])) }],
      extensions: { credProps: true },
    })
    expect(cred).toBeInstanceOf(h.PKC)
    expect(cred.response).toBeInstanceOf(FakeAttestation)
    expect(cred.id).toBe(b64u('cred-1'))
    expect(cred.type).toBe('public-key')
    expect(cred.authenticatorAttachment).toBe('platform')
    expect(buf(cred.rawId).toString()).toBe('cred-1')
    expect(buf(cred.response.clientDataJSON).toString()).toBe('{"type":"webauthn.create"}')
    expect(buf(cred.response.attestationObject).toString()).toBe('att')
    expect(buf(cred.response.getAuthenticatorData()).toString()).toBe('auth')
    expect(buf(cred.response.getPublicKey()).toString()).toBe('spki')
    expect(cred.response.getPublicKeyAlgorithm()).toBe(-7)
    expect(cred.response.getTransports()).toEqual(['internal', 'hybrid'])
    expect(cred.getClientExtensionResults()).toEqual({ credProps: { rk: true } })
    expect(cred.toJSON()).toEqual(REGISTRATION)
    expect(JSON.parse(JSON.stringify(cred))).toEqual(REGISTRATION)
    expect(h.native).toEqual([])
  })

  it('builds an assertion with a null user handle', async () => {
    reply = { ok: true, credential: ASSERTION }
    const h = install()
    const cred = (await h.credentials.get({
      publicKey: { challenge: new Uint8Array(8), rpId: 'example.com' },
      mediation: 'conditional',
    })) as Record<string, unknown> & { response: Record<string, unknown> }
    expect(h.bridgeCalls[0]).toMatchObject({ op: 'get', mediation: 'conditional' })
    expect(cred).toBeInstanceOf(h.PKC)
    expect(cred.response).toBeInstanceOf(FakeAssertion)
    expect(buf(cred.response.signature).toString()).toBe('sig')
    expect(cred.response.userHandle).toBeNull()
  })

  it('leaves everything that is not a publicKey request to the browser', async () => {
    const h = install()
    const options = { password: true }
    expect(await h.credentials.get(options)).toBe('native-get')
    expect(await h.credentials.create(undefined)).toBe('native-create')
    expect(h.native.map((n) => n.options)).toEqual([options, undefined])
    expect(h.bridgeCalls).toEqual([])
  })

  it('falls back to the browser when main says so, with its own timeout signal', async () => {
    reply = { native: true }
    const h = install()
    expect(await h.credentials.create(createOptions())).toBe('native-create')
    const passed = h.native[0]?.options as { signal?: AbortSignal; publicKey?: unknown }
    expect(passed.publicKey).toBeDefined()
    expect(passed.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns refusals into the right exceptions', async () => {
    reply = { ok: false, name: 'InvalidStateError', message: 'already there' }
    const h = install()
    await expect(h.credentials.create(createOptions())).rejects.toMatchObject({
      name: 'InvalidStateError',
      message: 'already there',
    })
    reply = { ok: false, name: 'TypeError', message: 'bad' }
    await expect(h.credentials.create(createOptions())).rejects.toBeInstanceOf(TypeError)
    await expect(
      h.credentials.create({ publicKey: { rp: {}, user: { id: new Uint8Array(1) } } }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(h.bridgeCalls).toHaveLength(2)
  })

  it('honours AbortSignal before and during the request', async () => {
    const h = install()
    const early = new AbortController()
    early.abort()
    await expect(
      h.credentials.create(createOptions({ signal: early.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.bridgeCalls).toEqual([])
    hold = new Promise(() => undefined)
    const late = new AbortController()
    const pending = h.credentials.get({
      publicKey: { challenge: new Uint8Array(8) },
      mediation: 'conditional',
      signal: late.signal,
    })
    late.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const id = h.bridgeCalls[0]?.id
    expect(h.bridgeCalls[1]).toEqual({ op: 'abort', id })
  })

  it('answers the capability checks from Safe, else from the browser', async () => {
    const h = install()
    expect(await h.PKC.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(true)
    expect(await h.PKC.isConditionalMediationAvailable()).toBe(true)
    expect(await h.PKC.getClientCapabilities()).toEqual({
      hybridTransport: false,
      conditionalGet: true,
      passkeyPlatformAuthenticator: true,
      userVerifyingPlatformAuthenticator: true,
      'extension:credProps': true,
    })
    available = false
    expect(await h.PKC.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(false)
    expect(await h.PKC.isConditionalMediationAvailable()).toBe(false)
    expect(await h.PKC.getClientCapabilities()).toEqual({ hybridTransport: false })
  })

  it('stays out of insecure pages', async () => {
    const h = install(false)
    expect(await h.credentials.create(createOptions())).toBe('native-create')
    expect(h.bridgeCalls).toEqual([])
  })
})
