import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { FAKE_AAGUID, decodeCbor } from './fake-safed'

export interface Expected {
  challenge: string
  origin: string
  rpId: string
}

export interface Stored {
  credentialId: string
  publicKey: KeyObject
  userHandle: string
}

type Json = Record<string, unknown>

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest()

function b64(value: unknown, what: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error(`${what}: not base64url`)
  return Buffer.from(value, 'base64url')
}

function record(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null) throw new Error(`${what}: missing`)
  return value as Json
}

function checkClientData(raw: Buffer, type: string, expected: Expected): void {
  const data = JSON.parse(raw.toString('utf8')) as Json
  if (data.type !== type) throw new Error(`clientData.type ${String(data.type)}`)
  if (data.challenge !== expected.challenge) throw new Error('clientData.challenge differs')
  if (data.origin !== expected.origin) throw new Error(`clientData.origin ${String(data.origin)}`)
  if (data.crossOrigin !== false) throw new Error('clientData.crossOrigin is not false')
}

function checkAuthData(data: Buffer, rpId: string, need: number): number {
  if (data.length < 37) throw new Error('authData too short')
  if (!data.subarray(0, 32).equals(sha256(rpId))) throw new Error('rpIdHash differs')
  const flags = data[32] ?? 0
  if ((flags & need) !== need)
    throw new Error(`flags ${flags.toString(2)} lack ${need.toString(2)}`)
  return flags
}

export function verifyRegistration(credential: Json, expected: Expected): Stored {
  if (credential.type !== 'public-key') throw new Error('type is not public-key')
  const response = record(credential.response, 'response')
  checkClientData(b64(response.clientDataJSON, 'clientDataJSON'), 'webauthn.create', expected)
  const attestation = decodeCbor(b64(response.attestationObject, 'attestationObject')).value
  if (!(attestation instanceof Map)) throw new Error('attestationObject is not a map')
  if (attestation.get('fmt') !== 'none') throw new Error('fmt is not none')
  const authData: unknown = attestation.get('authData')
  if (!Buffer.isBuffer(authData)) throw new Error('authData missing')
  checkAuthData(authData, expected.rpId, 0x01 | 0x04 | 0x08 | 0x10 | 0x40)
  if (!authData.subarray(37, 53).equals(FAKE_AAGUID)) throw new Error('aaguid differs')
  const idLength = authData.readUInt16BE(53)
  const credentialId = authData.subarray(55, 55 + idLength).toString('base64url')
  if (credentialId !== credential.id || credentialId !== credential.rawId)
    throw new Error('credential id differs')
  const cose = decodeCbor(authData, 55 + idLength).value
  if (!(cose instanceof Map)) throw new Error('cose key is not a map')
  const x: unknown = cose.get(-2)
  const y: unknown = cose.get(-3)
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || cose.get(3) !== -7) throw new Error('not ES256')
  const publicKey = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') },
    format: 'jwk',
  })
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  if (spki !== response.publicKey) throw new Error('publicKey differs from the attested key')
  if (response.publicKeyAlgorithm !== -7) throw new Error('publicKeyAlgorithm is not -7')
  return { credentialId, publicKey, userHandle: '' }
}

export function verifyAssertion(credential: Json, stored: Stored, expected: Expected): void {
  if (credential.id !== stored.credentialId) throw new Error('unknown credential')
  const response = record(credential.response, 'response')
  const clientData = b64(response.clientDataJSON, 'clientDataJSON')
  checkClientData(clientData, 'webauthn.get', expected)
  const authData = b64(response.authenticatorData, 'authenticatorData')
  checkAuthData(authData, expected.rpId, 0x01 | 0x04)
  const signature = b64(response.signature, 'signature')
  const ok = verify(
    'sha256',
    Buffer.concat([authData, sha256(clientData)]),
    stored.publicKey,
    signature,
  )
  if (!ok) throw new Error('signature does not verify')
  if (stored.userHandle !== '' && response.userHandle !== stored.userHandle)
    throw new Error('userHandle differs')
}
