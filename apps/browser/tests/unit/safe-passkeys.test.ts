import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SafeMenu, SafePasskeyReply } from '@ewe/shared'
import { SafeClient } from '../../src/main/safe/client'
import { PasskeyBroker, parsePasskeys, type FrameRef } from '../../src/main/safe/passkeys'
import { b64u, parseCreate, parseGet, type CreateOptions } from '../../src/main/safe/webauthn'
import { shouldSuggest, suggestBounds, SUGGEST_PAD } from '../../src/main/safe/window'
import { startFakeSafe, type FakeSafe } from '../fake-safed'
import { verifyAssertion, verifyRegistration } from '../webauthn-rp'

let dir = ''
let fake: FakeSafe
let broker: PasskeyBroker

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ewe-pk-'))
  fake = await startFakeSafe(join(dir, 's.sock'))
  broker = new PasskeyBroker(new SafeClient(() => fake.path))
})

afterEach(async () => {
  await fake.close()
  rmSync(dir, { recursive: true, force: true })
})

const ORIGIN = 'https://example.com'
const RP = 'example.com'

function createOptions(over: Record<string, unknown> = {}): CreateOptions {
  const r = parseCreate({
    challenge: b64u(Buffer.from('challenge-create-0001')),
    rp: { id: RP, name: 'Example' },
    user: { id: b64u(Buffer.from('user-77')), name: 'sam@example.com', displayName: 'Sam' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    extensions: { credProps: true },
    ...over,
  })
  if (!r.ok) throw new Error(r.message)
  return r.value
}

function credential(reply: SafePasskeyReply): Record<string, unknown> {
  if (!('ok' in reply) || !reply.ok)
    throw new Error(`expected a credential, got ${JSON.stringify(reply)}`)
  return reply.credential
}

describe('PasskeyBroker against a fake ewe-safed', () => {
  it('registers a passkey a relying party accepts, then signs in with it', async () => {
    const options = createOptions()
    const created = credential(await broker.create(ORIGIN, RP, options, null))
    const stored = verifyRegistration(created, {
      challenge: options.challenge,
      origin: ORIGIN,
      rpId: RP,
    })
    expect(created.clientExtensionResults).toEqual({ credProps: { rk: true } })
    const call = fake.calls.find((c) => c.verb === 'passkey-create')
    expect(call?.args).toMatchObject({
      rp_id: RP,
      rp_name: 'Example',
      user_name: 'sam@example.com',
      user_display_name: 'Sam',
      algorithms: [-7],
      exclude: [],
      origin: ORIGIN,
      user_verified: true,
    })
    expect(call?.args.item_id).toBeUndefined()

    const listed = await broker.list(RP, [])
    expect(listed).toEqual([
      {
        credentialId: stored.credentialId,
        title: 'Example',
        username: 'sam@example.com',
        rpId: RP,
      },
    ])
    const challenge = b64u(Buffer.from('challenge-get-000002'))
    const signed = credential(await broker.assert(ORIGIN, RP, challenge, stored.credentialId))
    verifyAssertion(
      signed,
      { ...stored, userHandle: b64u(Buffer.from('user-77')) },
      {
        challenge,
        origin: ORIGIN,
        rpId: RP,
      },
    )
  })

  it('puts the passkey on a named login', async () => {
    const login = fake.addLogin('Example', 'sam@example.com', ORIGIN, 'pw')
    credential(await broker.create(ORIGIN, RP, createOptions(), login.id))
    expect(login.passkey?.rpId).toBe(RP)
    expect(fake.items).toHaveLength(1)
  })

  it('maps excluded, unsupported, not-found and locked', async () => {
    const first = credential(await broker.create(ORIGIN, RP, createOptions(), null))
    const again = await broker.create(
      ORIGIN,
      RP,
      createOptions({ excludeCredentials: [{ type: 'public-key', id: first.id }] }),
      null,
    )
    expect(again).toMatchObject({ ok: false, name: 'InvalidStateError' })
    const rsaOnly = await broker.create(
      ORIGIN,
      RP,
      createOptions({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] }),
      null,
    )
    expect(rsaOnly).toMatchObject({ ok: false, name: 'NotSupportedError' })
    const missing = await broker.assert(ORIGIN, RP, 'AAAA', b64u(Buffer.from('nope')))
    expect(missing).toMatchObject({ ok: false, name: 'NotAllowedError' })
    fake.lock()
    expect(await broker.list(RP, [])).toBeNull()
    expect(await broker.create(ORIGIN, RP, createOptions(), null)).toMatchObject({
      ok: false,
      name: 'NotAllowedError',
    })
  })

  it('applies allowCredentials and never lists another relying party', async () => {
    const a = credential(await broker.create(ORIGIN, RP, createOptions(), null))
    credential(
      await broker.create(
        ORIGIN,
        RP,
        createOptions({ user: { id: b64u(Buffer.from('u2')), name: 'bo', displayName: '' } }),
        null,
      ),
    )
    credential(
      await broker.create(
        'https://other.org',
        'other.org',
        createOptions({ rp: { id: 'other.org' } }),
        null,
      ),
    )
    expect((await broker.list(RP, []))?.map((p) => p.username).sort()).toEqual([
      'bo',
      'sam@example.com',
    ])
    expect((await broker.list(RP, [String(a.id)]))?.map((p) => p.credentialId)).toEqual([a.id])
  })
})

describe('parsePasskeys', () => {
  it('keeps only well-formed entries of the asked relying party', () => {
    const list = parsePasskeys(
      {
        ok: true,
        passkeys: [
          { item_id: '1', title: 'A', username: 'a', rp_id: RP, credential_id: 'Y3JlZA' },
          { item_id: '2', title: 'B', username: 'b', rp_id: 'evil.com', credential_id: 'Y3JlZQ' },
          { item_id: '3', title: 'C', username: 'c', rp_id: RP, credential_id: 'no spaces' },
          { item_id: '4', title: 'D', username: 'd', rp_id: RP, credential_id: 'Y3JlZA' },
          'junk',
        ],
      },
      RP,
    )
    expect(list).toEqual([{ credentialId: 'Y3JlZA', title: 'A', username: 'a', rpId: RP }])
  })
})

describe('the conditional request registry', () => {
  const ref = (over: Partial<FrameRef> = {}): FrameRef => ({
    contentsId: 1,
    processId: 10,
    routingId: 20,
    origin: ORIGIN,
    ...over,
  })
  const options = () => {
    const r = parseGet({ challenge: b64u(Buffer.alloc(16)) }, 'conditional')
    if (!r.ok) throw new Error(r.message)
    return r.value
  }

  it('keeps one request per frame and answers the replaced one', () => {
    const answers: string[] = []
    broker.wait({
      ref: ref(),
      id: 'a',
      rpId: RP,
      options: options(),
      resolve: () => answers.push('a'),
    })
    broker.wait({
      ref: ref(),
      id: 'b',
      rpId: RP,
      options: options(),
      resolve: () => answers.push('b'),
    })
    expect(answers).toEqual(['a'])
    expect(broker.conditionalFor(ref())?.id).toBe('b')
    expect(broker.conditionalFor(ref({ origin: 'https://evil.com' }))).toBeNull()
    expect(broker.conditionalFor(ref({ contentsId: 2 }))).toBeNull()
    expect(broker.take(ref(), 'a')).toBeNull()
    expect(broker.take(ref(), 'b')?.id).toBe('b')
    expect(broker.conditionalFor(ref())).toBeNull()
  })

  it('aborts requests of a navigated frame or a closed tab', () => {
    const seen: string[] = []
    broker.wait({
      ref: ref(),
      id: 'a',
      rpId: RP,
      options: options(),
      resolve: (r) => seen.push(JSON.stringify(r)),
    })
    broker.wait({
      ref: ref({ routingId: 21 }),
      id: 'b',
      rpId: RP,
      options: options(),
      resolve: () => seen.push('b'),
    })
    broker.dropFrame(10, 20, { ok: false, name: 'AbortError', message: 'gone' })
    expect(seen[0]).toContain('AbortError')
    broker.dropContents(1, { ok: false, name: 'AbortError', message: 'gone' })
    expect(seen).toHaveLength(2)
    expect(broker.conditionalFor(ref({ routingId: 21 }))).toBeNull()
  })
})

describe('the inline list placement', () => {
  const page = { x: 272, y: 8, width: 1000, height: 700 }
  const size = { width: 1280, height: 716 }

  it('drops under the field, as wide as the field within limits', () => {
    const field = { x: 400, y: 100, width: 320, height: 32 }
    expect(suggestBounds(field, page, size, 120)).toEqual({
      x: 400 - SUGGEST_PAD,
      y: 100 + 32 + 4 - SUGGEST_PAD,
      width: 320 + 2 * SUGGEST_PAD,
      height: 120 + 2 * SUGGEST_PAD,
    })
    expect(suggestBounds({ ...field, width: 100 }, page, size, 120).width).toBe(
      280 + 2 * SUGGEST_PAD,
    )
    expect(suggestBounds({ ...field, width: 900 }, page, size, 120).width).toBe(
      420 + 2 * SUGGEST_PAD,
    )
  })

  it('flips above a field near the bottom and stays inside the window', () => {
    const field = { x: 1200, y: 640, width: 320, height: 32 }
    const r = suggestBounds(field, page, size, 200)
    expect(r.y + r.height - SUGGEST_PAD).toBe(640 - 4)
    expect(r.x + r.width).toBeLessThanOrEqual(size.width)
  })
})

describe('shouldSuggest', () => {
  const menu = (over: Partial<SafeMenu>): SafeMenu => ({
    requestId: 'r',
    kind: 'login',
    field: 'username',
    state: 'ready',
    host: 'example.com',
    favicon: null,
    items: [],
    passkeys: [],
    ...over,
  })
  const login = { id: 'i', title: 'A', username: 'a', host: 'example.com' }
  const passkey = { credentialId: 'c', title: 'A', username: 'a', rpId: RP }

  it('opens on focus only when there is something to do', () => {
    expect(shouldSuggest(menu({ items: [login] }), 'focus')).toBe(true)
    expect(shouldSuggest(menu({ passkeys: [passkey] }), 'focus')).toBe(true)
    expect(shouldSuggest(menu({}), 'focus')).toBe(false)
    expect(shouldSuggest(menu({ state: 'empty' }), 'click')).toBe(false)
    expect(shouldSuggest(menu({ state: 'locked' }), 'focus')).toBe(true)
    expect(shouldSuggest(menu({ kind: 'new-password' }), 'focus')).toBe(true)
    expect(shouldSuggest(menu({ state: 'unavailable' }), 'focus')).toBe(false)
    expect(shouldSuggest(menu({ state: 'unavailable' }), 'icon')).toBe(true)
    expect(shouldSuggest(menu({ state: 'empty' }), 'key')).toBe(true)
  })
})
