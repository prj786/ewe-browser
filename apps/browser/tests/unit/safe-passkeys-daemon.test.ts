import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SafePasskeyReply } from '@ewe/shared'
import { SafeClient } from '../../src/main/safe/client'
import { PasskeyBroker } from '../../src/main/safe/passkeys'
import { parseSummaries } from '../../src/main/safe/service'
import { b64u, parseCreate, type CreateOptions } from '../../src/main/safe/webauthn'
import { verifyAssertion, verifyRegistration } from '../webauthn-rp'

const SAFED = process.env.EWE_SAFED_BIN
const SAFE = process.env.EWE_SAFE_BIN
const MASTER = 'master-password-1'
const ORIGIN = 'https://example.com'
const RP = 'example.com'

let root = ''
let env: Record<string, string> = {}
let daemon: ChildProcess | null = null
let client: SafeClient
let broker: PasskeyBroker

function cli(args: string[], input = ''): Record<string, unknown> {
  const out = execFileSync(SAFE ?? 'ewe-safe', args, { env, input, encoding: 'utf8' })
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as Record<string, unknown>
}

function options(over: Record<string, unknown> = {}): CreateOptions {
  const r = parseCreate({
    challenge: b64u(Buffer.from('a-challenge-from-the-site')),
    rp: { id: RP, name: 'Example' },
    user: { id: b64u(Buffer.from('user-42')), name: 'sam', displayName: 'Sam' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    ...over,
  })
  if (!r.ok) throw new Error(r.message)
  return r.value
}

function credential(reply: SafePasskeyReply): Record<string, unknown> {
  if (!('ok' in reply) || !reply.ok) throw new Error(JSON.stringify(reply))
  return reply.credential
}

describe.skipIf(SAFED === undefined || SAFE === undefined)(
  'passkeys against the real ewe-safed',
  () => {
    beforeAll(async () => {
      root = mkdtempSync('/tmp/ewe-b1-real-')
      for (const d of ['run', 'state', 'config', 'data', 'home', 'bin']) mkdirSync(join(root, d))
      chmodSync(join(root, 'run'), 0o700)
      writeFileSync(join(root, 'bin', 'ewe-conf'), '#!/bin/sh\n[ "$1" = get ] && exit 1\nexit 0\n')
      chmodSync(join(root, 'bin', 'ewe-conf'), 0o755)
      env = {
        HOME: join(root, 'home'),
        PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
        XDG_RUNTIME_DIR: join(root, 'run'),
        XDG_STATE_HOME: join(root, 'state'),
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_DATA_HOME: join(root, 'data'),
        EWE_SAFE_NO_LOGIND: '1',
        EWE_SAFE_KDF_ITERATIONS: '2',
      }
      daemon = spawn(SAFED ?? 'ewe-safed', [], { env, stdio: 'ignore' })
      const socket = join(root, 'run', 'ewe-safe.sock')
      client = new SafeClient(() => socket)
      broker = new PasskeyBroker(client)
      for (let i = 0; i < 100 && !(await client.call('ping')).ok; i++)
        await new Promise((r) => setTimeout(r, 100))
      expect(cli(['init', '--place', 'local'], `${MASTER}\n${MASTER}\n`).ok).toBe(true)
    }, 30_000)

    afterAll(() => {
      client.stop()
      daemon?.kill()
      rmSync(root, { recursive: true, force: true })
    })

    it('creates a passkey a relying party accepts and signs with it', async () => {
      const o = options()
      const created = credential(await broker.create(ORIGIN, RP, o, null))
      const stored = verifyRegistration(created, {
        challenge: o.challenge,
        origin: ORIGIN,
        rpId: RP,
      })
      const listed = await broker.list(RP, [])
      expect(listed?.map((p) => p.credentialId)).toEqual([stored.credentialId])
      expect(listed?.[0]?.username).toBe('sam')
      const challenge = b64u(Buffer.from('another-challenge-0001'))
      const signed = credential(await broker.assert(ORIGIN, RP, challenge, stored.credentialId))
      verifyAssertion(
        signed,
        { ...stored, userHandle: b64u(Buffer.from('user-42')) },
        {
          challenge,
          origin: ORIGIN,
          rpId: RP,
        },
      )
      const summaries = parseSummaries(await client.call('list', { kind: 'login' }))
      expect(summaries.map((s) => s.passkey)).toEqual(['some'])
    }, 30_000)

    it('saves into a named login and maps the error codes', async () => {
      const added = cli(
        [
          'add',
          '--kind',
          'login',
          '--title',
          'Bo',
          '--username',
          'bo',
          '--url',
          ORIGIN,
          '--password-stdin',
        ],
        'pw\n',
      )
      expect(added.ok).toBe(true)
      const before = parseSummaries(await client.call('list', { kind: 'login' }))
      expect(before.find((s) => s.username === 'bo')?.passkey).toBe('none')
      const o = options({
        user: { id: b64u(Buffer.from('user-bo')), name: 'bo', displayName: 'Bo' },
      })
      const made = credential(await broker.create(ORIGIN, RP, o, String(added.item_id)))
      const after = parseSummaries(await client.call('list', { kind: 'login' }))
      expect(after.find((s) => s.id === added.item_id)?.passkey).toBe('some')
      const again = await broker.create(
        ORIGIN,
        RP,
        options({ excludeCredentials: [{ type: 'public-key', id: made.id }] }),
        null,
      )
      expect(again).toMatchObject({ ok: false, name: 'InvalidStateError' })
      const rsa = await broker.create(
        ORIGIN,
        RP,
        options({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] }),
        null,
      )
      expect(rsa).toMatchObject({ ok: false, name: 'NotSupportedError' })
      expect(await broker.assert(ORIGIN, RP, 'AAAA', b64u(Buffer.from('none')))).toMatchObject({
        ok: false,
        name: 'NotAllowedError',
      })
      expect((await broker.list(RP, [String(made.id)]))?.map((p) => p.credentialId)).toEqual([
        made.id,
      ])
      expect(cli(['lock']).ok).toBe(true)
      expect(await broker.list(RP, [])).toBeNull()
      expect(await broker.create(ORIGIN, RP, options(), null)).toMatchObject({
        ok: false,
        name: 'NotAllowedError',
      })
    }, 30_000)
  },
)
