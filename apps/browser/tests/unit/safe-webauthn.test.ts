import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertionJson,
  b64u,
  checkRpId,
  clampTimeout,
  clientDataJSON,
  displayText,
  fromB64u,
  parseCreate,
  parseGet,
  registrationJson,
  safeError,
} from '../../src/main/safe/webauthn'

const ok = (origin: string, rpId: string | null) => {
  const r = checkRpId(origin, rpId)
  return r.ok ? r.value : null
}

describe('checkRpId', () => {
  const table: [string, string | null, string | null][] = [
    ['https://github.com', null, 'github.com'],
    ['https://github.com', 'github.com', 'github.com'],
    ['https://www.github.com', 'github.com', 'github.com'],
    ['https://login.example.co.uk', 'example.co.uk', 'example.co.uk'],
    ['https://login.example.co.uk', 'login.example.co.uk', 'login.example.co.uk'],
    ['https://a.b.example.com:8443', 'b.example.com', 'b.example.com'],
    ['http://localhost:4321', null, 'localhost'],
    ['http://localhost:4321', 'localhost', 'localhost'],
    ['https://localhost', 'localhost', 'localhost'],
    ['https://alice.github.io', 'alice.github.io', 'alice.github.io'],
    ['https://github.com', 'com', null],
    ['https://example.co.uk', 'co.uk', null],
    ['https://alice.github.io', 'github.io', null],
    ['https://github.com', 'gitlab.com', null],
    ['https://github.com', 'ithub.com', null],
    ['https://evilgithub.com', 'github.com', null],
    ['https://github.com', 'login.github.com', null],
    ['https://github.com', 'GitHub.com', null],
    ['https://github.com', 'github.com.', null],
    ['https://github.com', '', null],
    ['http://github.com', 'github.com', null],
    ['http://127.0.0.1:8080', null, null],
    ['https://127.0.0.1', '127.0.0.1', null],
    ['https://[::1]', null, null],
    ['http://localhost:4321', 'example.com', null],
    ['https://example.com', 'localhost', null],
    ['http://app.localhost', 'localhost', null],
    ['file:///etc/passwd', null, null],
    ['null', null, null],
  ]
  it.each(table)('%s with %s', (origin, rpId, expected) => {
    expect(ok(origin, rpId)).toBe(expected)
  })

  it('answers SecurityError for a refused id', () => {
    const r = checkRpId('https://github.com', 'com')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.name).toBe('SecurityError')
  })
})

describe('clientDataJSON', () => {
  it('has the exact key order browsers use and crossOrigin false', () => {
    expect(clientDataJSON('webauthn.create', 'Y2hhbA', 'https://github.com')).toBe(
      '{"type":"webauthn.create","challenge":"Y2hhbA","origin":"https://github.com","crossOrigin":false}',
    )
    expect(JSON.parse(clientDataJSON('webauthn.get', 'AA', 'http://localhost:9'))).toEqual({
      type: 'webauthn.get',
      challenge: 'AA',
      origin: 'http://localhost:9',
      crossOrigin: false,
    })
  })
})

describe('base64url', () => {
  it('round-trips and refuses other alphabets', () => {
    const bytes = Uint8Array.from([0, 251, 255, 62, 63])
    expect(b64u(bytes)).toBe('APv_Pj8')
    expect(fromB64u('APv_Pj8')?.equals(Buffer.from(bytes))).toBe(true)
    expect(fromB64u('AP+/Pj8=')).toBeNull()
    expect(fromB64u('A')).toBeNull()
    expect(fromB64u(7)).toBeNull()
  })
})

const create = (over: Record<string, unknown> = {}) => ({
  challenge: b64u(Buffer.alloc(32, 1)),
  rp: { name: 'Example', id: 'example.com' },
  user: { id: b64u(Buffer.from('user-1')), name: 'sam', displayName: 'Sam' },
  pubKeyCredParams: [
    { type: 'public-key', alg: -7 },
    { type: 'public-key', alg: '-257' },
  ],
  ...over,
})

describe('parseCreate', () => {
  it('reads the options the site sends', () => {
    const r = parseCreate({
      ...create(),
      excludeCredentials: [{ type: 'public-key', id: b64u(Buffer.from('old')) }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required' },
      timeout: 5_000,
      extensions: { credProps: true },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rpId).toBe('example.com')
    expect(r.value.algorithms).toEqual([-7, -257])
    expect(r.value.exclude).toEqual([b64u(Buffer.from('old'))])
    expect(r.value.attachment).toBe('platform')
    expect(r.value.timeout).toBe(30_000)
    expect(r.value.credProps).toBe(true)
  })

  it('defaults the key types and the timeout', () => {
    const r = parseCreate(create({ pubKeyCredParams: [], rp: { name: 'X' } }))
    expect(r.ok && r.value.algorithms).toEqual([-7, -257])
    expect(r.ok && r.value.rpId).toBeNull()
    expect(r.ok && r.value.timeout).toBe(300_000)
    expect(clampTimeout(10_000_000)).toBe(600_000)
  })

  it('refuses what a browser refuses', () => {
    const name = (raw: unknown) => {
      const r = parseCreate(raw)
      return r.ok ? 'ok' : r.name
    }
    expect(name(null)).toBe('TypeError')
    expect(name(create({ challenge: undefined }))).toBe('TypeError')
    expect(name(create({ challenge: 'not base64!' }))).toBe('TypeError')
    expect(name(create({ user: { id: '', name: 'x' } }))).toBe('TypeError')
    expect(name(create({ user: { id: b64u(Buffer.alloc(65)), name: 'x' } }))).toBe('TypeError')
    expect(name(create({ rp: { id: 7 } }))).toBe('TypeError')
    expect(name(create({ pubKeyCredParams: [{ type: 'other', alg: -7 }] }))).toBe(
      'NotSupportedError',
    )
    expect(name(create({ excludeCredentials: [{ type: 'public-key', id: '***' }] }))).toBe(
      'TypeError',
    )
  })
})

describe('parseGet', () => {
  it('reads conditional and modal requests', () => {
    const r = parseGet(
      {
        challenge: b64u(Buffer.alloc(16, 2)),
        rpId: 'example.com',
        allowCredentials: [{ type: 'public-key', id: b64u(Buffer.from('c1')) }],
      },
      'conditional',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mediation).toBe('conditional')
    expect(r.value.allow).toEqual([b64u(Buffer.from('c1'))])
    const modal = parseGet({ challenge: b64u(Buffer.alloc(16)) }, 'whatever')
    expect(modal.ok && modal.value.mediation).toBe('optional')
    expect(modal.ok && modal.value.rpId).toBeNull()
    expect(parseGet({}, 'optional').ok).toBe(false)
  })
})

const rpHash = (rpId: string) => createHash('sha256').update(rpId).digest()
const authData = (rpId: string, flags: number) =>
  Buffer.concat([rpHash(rpId), Buffer.from([flags]), Buffer.alloc(4)])

describe('registrationJson', () => {
  const clientData = clientDataJSON('webauthn.create', 'AA', 'https://example.com')
  const reply = (over: Record<string, unknown> = {}) => ({
    credential_id: b64u(Buffer.from('cred')),
    attestation_object: b64u(Buffer.from('att')),
    authenticator_data: b64u(authData('example.com', 0x5d)),
    public_key: b64u(Buffer.from('spki')),
    public_key_algorithm: -7,
    ...over,
  })

  it('builds the WebAuthn JSON shape', () => {
    const json = registrationJson(reply(), clientData, 'example.com', true)
    expect(json).toEqual({
      id: b64u(Buffer.from('cred')),
      rawId: b64u(Buffer.from('cred')),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64u(clientData),
        attestationObject: b64u(Buffer.from('att')),
        authenticatorData: b64u(authData('example.com', 0x5d)),
        publicKey: b64u(Buffer.from('spki')),
        publicKeyAlgorithm: -7,
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: { credProps: { rk: true } },
    })
    expect(
      registrationJson(reply(), clientData, 'example.com', false)?.clientExtensionResults,
    ).toEqual({})
  })

  it('refuses a reply for another site or without the right flags', () => {
    expect(registrationJson(reply(), clientData, 'other.com', false)).toBeNull()
    const noAt = reply({ authenticator_data: b64u(authData('example.com', 0x1d)) })
    expect(registrationJson(noAt, clientData, 'example.com', false)).toBeNull()
    expect(
      registrationJson(reply({ credential_id: '' }), clientData, 'example.com', false),
    ).toBeNull()
    expect(
      registrationJson(reply({ public_key_algorithm: 'x' }), clientData, 'example.com', false),
    ).toBeNull()
  })
})

describe('assertionJson', () => {
  const clientData = clientDataJSON('webauthn.get', 'AA', 'https://example.com')
  const id = b64u(Buffer.from('cred'))
  const reply = (over: Record<string, unknown> = {}) => ({
    credential_id: id,
    authenticator_data: b64u(authData('example.com', 0x1d)),
    signature: b64u(Buffer.from('sig')),
    user_handle: b64u(Buffer.from('user-1')),
    ...over,
  })

  it('builds the WebAuthn JSON shape', () => {
    expect(assertionJson(reply(), clientData, 'example.com', id)).toEqual({
      id,
      rawId: id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authData('example.com', 0x1d)),
        signature: b64u(Buffer.from('sig')),
        userHandle: b64u(Buffer.from('user-1')),
      },
      clientExtensionResults: {},
    })
    const empty = assertionJson(reply({ user_handle: '' }), clientData, 'example.com', id)
    expect((empty?.response as Record<string, unknown>).userHandle).toBeNull()
  })

  it('refuses another credential, another site or no user presence', () => {
    expect(assertionJson(reply(), clientData, 'example.com', b64u(Buffer.from('x')))).toBeNull()
    expect(assertionJson(reply(), clientData, 'evil.com', id)).toBeNull()
    const noUp = reply({ authenticator_data: b64u(authData('example.com', 0x1c)) })
    expect(assertionJson(noUp, clientData, 'example.com', id)).toBeNull()
    expect(assertionJson(reply({ signature: '' }), clientData, 'example.com', id)).toBeNull()
  })
})

describe('safeError', () => {
  it('maps Safe error codes to WebAuthn names', () => {
    expect(safeError('excluded', undefined).name).toBe('InvalidStateError')
    expect(safeError('unsupported', undefined).name).toBe('NotSupportedError')
    expect(safeError('not-found', undefined).name).toBe('NotAllowedError')
    expect(safeError('locked', undefined).name).toBe('NotAllowedError')
    expect(safeError('internal', 'boom')).toEqual({
      ok: false,
      name: 'NotAllowedError',
      message: 'boom',
    })
  })
})

describe('displayText', () => {
  it('strips control, bidi and invisible characters and shortens long names', () => {
    expect(displayText('sam\u202e\u200bmoc.elgoog')).toBe('sammoc.elgoog')
    expect(displayText(' a\nb\u0000c ')).toBe('abc')
    expect(displayText('  two   words ')).toBe('two words')
    const long = displayText('x'.repeat(200))
    expect(Array.from(long)).toHaveLength(64)
    expect(long.endsWith('…')).toBe(true)
    expect(displayText('სამი')).toBe('სამი')
  })
})
