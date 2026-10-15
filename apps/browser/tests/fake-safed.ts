import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'

export const FAKE_AAGUID = Buffer.from('452b824e42d34324bc6c581888ca2851', 'hex')
export const FAKE_MASTER = 'master-password-1'

export interface FakePasskey {
  rpId: string
  credentialId: string
  userHandle: string
  userName: string
  privateKey: KeyObject
  publicKey: KeyObject
}

export interface FakeItem {
  id: string
  title: string
  username: string
  urls: string[]
  password: string
  passkey: FakePasskey | null
}

export interface FakeSafe {
  path: string
  items: FakeItem[]
  calls: { verb: string; args: Record<string, unknown> }[]
  locked: boolean
  lock(): void
  addLogin(title: string, username: string, url: string, password: string): FakeItem
  close(): Promise<void>
}

type Args = Record<string, unknown>
type Reply = Record<string, unknown>

const B64U = /^[A-Za-z0-9_-]*$/

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function bytes(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !B64U.test(value)) return null
  return Buffer.from(value, 'base64url')
}

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n])
  if (n < 0x10000) {
    const b = Buffer.alloc(3)
    b[0] = (major << 5) | 25
    b.writeUInt16BE(n, 1)
    return b
  }
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(n, 1)
  return b
}

export function cbor(value: unknown): Buffer {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('cbor: integers only')
    return value >= 0 ? head(0, value) : head(1, -1 - value)
  }
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8')
    return Buffer.concat([head(3, text.length), text])
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const b = Buffer.from(value)
    return Buffer.concat([head(2, b.length), b])
  }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)])
  if (value instanceof Map) {
    const parts: Buffer[] = [head(5, value.size)]
    for (const [k, v] of value) parts.push(cbor(k), cbor(v))
    return Buffer.concat(parts)
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    const parts: Buffer[] = [head(5, entries.length)]
    for (const [k, v] of entries) parts.push(cbor(k), cbor(v))
    return Buffer.concat(parts)
  }
  throw new Error('cbor: unsupported value')
}

export function coseKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' })
  return cbor(
    new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]),
  )
}

const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 }

function authData(rpId: string, verified: boolean, attested: Buffer | null): Buffer {
  const rpHash = createHash('sha256').update(rpId).digest()
  let flags = FLAGS.UP | FLAGS.BE | FLAGS.BS
  if (verified) flags |= FLAGS.UV
  if (attested !== null) flags |= FLAGS.AT
  const counter = Buffer.alloc(4)
  return Buffer.concat([rpHash, Buffer.from([flags]), counter, attested ?? Buffer.alloc(0)])
}

const validRpId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9.-]{1,253}$/.test(v) && !v.startsWith('.')

function summary(item: FakeItem): Reply {
  return {
    id: item.id,
    kind: 'login',
    title: item.title,
    username: item.username,
    urls: item.urls,
    apps: [],
    tags: [],
    folder: '',
    has_password: item.password !== '',
    has_otp: false,
    modified: new Date().toISOString(),
    passkey:
      item.passkey === null ? null : { rp_id: item.passkey.rpId, username: item.passkey.userName },
  }
}

const LOCKED: Reply = { ok: false, error: 'locked', message: 'Safe is locked.' }

export async function startFakeSafe(path: string): Promise<FakeSafe> {
  const items: FakeItem[] = []
  const calls: FakeSafe['calls'] = []
  const subscribers = new Set<Socket>()
  const sockets = new Set<Socket>()
  const state = { locked: false }

  const emit = (event: Reply) => {
    for (const s of subscribers) s.write(`${JSON.stringify({ v: 1, ...event })}\n`)
  }

  const find = (id: unknown) => items.find((i) => i.id === id)

  const addLogin = (title: string, username: string, url: string, password: string): FakeItem => {
    const item: FakeItem = {
      id: randomUUID(),
      title,
      username,
      urls: [url],
      password,
      passkey: null,
    }
    items.push(item)
    return item
  }

  const passkeyCreate = (a: Args): Reply => {
    if (!validRpId(a.rp_id)) return { ok: false, error: 'bad-request', message: 'rp_id' }
    const hash = bytes(a.client_data_hash)
    if (hash?.length !== 32) return { ok: false, error: 'bad-request', message: 'hash' }
    const userId = bytes(a.user_id)
    if (userId === null || userId.length === 0)
      return { ok: false, error: 'bad-request', message: 'user' }
    const algorithms = Array.isArray(a.algorithms) ? a.algorithms : []
    if (!algorithms.includes(-7))
      return { ok: false, error: 'unsupported', message: 'No algorithm.' }
    const exclude = Array.isArray(a.exclude) ? a.exclude : []
    if (
      items.some(
        (i) =>
          i.passkey !== null &&
          i.passkey.rpId === a.rp_id &&
          exclude.includes(i.passkey.credentialId),
      )
    )
      return { ok: false, error: 'excluded', message: 'Already in Safe.' }
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const credentialId = randomBytes(16)
    const lengthBytes = Buffer.alloc(2)
    lengthBytes.writeUInt16BE(credentialId.length)
    const attested = Buffer.concat([FAKE_AAGUID, lengthBytes, credentialId, coseKey(publicKey)])
    const data = authData(a.rp_id, a.user_verified === true, attested)
    const passkey: FakePasskey = {
      rpId: a.rp_id,
      credentialId: credentialId.toString('base64url'),
      userHandle: userId.toString('base64url'),
      userName: typeof a.user_name === 'string' ? a.user_name : '',
      privateKey,
      publicKey,
    }
    let item = typeof a.item_id === 'string' ? find(a.item_id) : undefined
    if (item === undefined) {
      const title = typeof a.rp_name === 'string' && a.rp_name !== '' ? a.rp_name : a.rp_id
      item = addLogin(title, passkey.userName, `https://${a.rp_id}`, '')
    }
    item.passkey = passkey
    const attestation = cbor({ fmt: 'none', attStmt: {}, authData: data })
    return {
      ok: true,
      item_id: item.id,
      credential_id: passkey.credentialId,
      attestation_object: attestation.toString('base64url'),
      authenticator_data: data.toString('base64url'),
      public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      public_key_algorithm: -7,
      sync: { state: 'local', pending: false },
    }
  }

  const passkeyGet = (a: Args): Reply => {
    if (!validRpId(a.rp_id)) return { ok: false, error: 'bad-request', message: 'rp_id' }
    const hash = bytes(a.client_data_hash)
    if (hash?.length !== 32) return { ok: false, error: 'bad-request', message: 'hash' }
    const item = items.find(
      (i) =>
        i.passkey !== null &&
        i.passkey.rpId === a.rp_id &&
        i.passkey.credentialId === a.credential_id,
    )
    const passkey = item?.passkey
    if (item === undefined || passkey === null || passkey === undefined)
      return { ok: false, error: 'not-found', message: 'No such passkey.' }
    const data = authData(passkey.rpId, a.user_verified === true, null)
    const signature = sign('sha256', Buffer.concat([data, hash]), passkey.privateKey)
    return {
      ok: true,
      item_id: item.id,
      credential_id: passkey.credentialId,
      authenticator_data: data.toString('base64url'),
      signature: signature.toString('base64url'),
      user_handle: passkey.userHandle,
    }
  }

  const answer = (verb: string, a: Args): Reply => {
    switch (verb) {
      case 'status':
        return {
          ok: true,
          set_up: true,
          locked: state.locked,
          items: state.locked ? null : items.length,
        }
      case 'unlock':
        if (a.password !== FAKE_MASTER) return { ok: false, error: 'wrong-key', message: 'Wrong.' }
        state.locked = false
        emit({ event: 'unlocked' })
        return { ok: true, items: items.length }
      case 'lock':
        state.locked = true
        emit({ event: 'locked', reason: 'user' })
        return { ok: true, locked: true }
      case 'generate':
        return { ok: true, value: randomBytes(15).toString('base64url'), bits: 120 }
    }
    if (state.locked) return LOCKED
    switch (verb) {
      case 'list':
        return { ok: true, items: items.map(summary) }
      case 'reveal': {
        const item = find(a.id)
        if (item === undefined) return { ok: false, error: 'not-found', message: 'No item.' }
        return { ok: true, value: a.field === 'username' ? item.username : item.password }
      }
      case 'add': {
        const urls = Array.isArray(a.url) ? a.url.map(String) : []
        const item = addLogin(str(a.title), str(a.username), urls[0] ?? '', str(a.password_value))
        item.urls = urls
        emit({ event: 'changed' })
        return { ok: true, item_id: item.id }
      }
      case 'edit': {
        const item = find(a.id)
        if (item === undefined) return { ok: false, error: 'not-found', message: 'No item.' }
        if (typeof a.password_value === 'string') item.password = a.password_value
        return { ok: true }
      }
      case 'passkey-list': {
        const allow = Array.isArray(a.allow) ? a.allow : []
        const passkeys = items
          .filter((i) => i.passkey?.rpId === a.rp_id)
          .filter((i) => allow.length === 0 || allow.includes(i.passkey?.credentialId))
          .map((i) => ({
            item_id: i.id,
            title: i.title,
            username: i.passkey?.userName ?? '',
            rp_id: i.passkey?.rpId ?? '',
            credential_id: i.passkey?.credentialId ?? '',
          }))
        return { ok: true, passkeys }
      }
      case 'passkey-create':
        return passkeyCreate(a)
      case 'passkey-get':
        return passkeyGet(a)
      default:
        return { ok: false, error: 'bad-request', message: `unknown verb ${verb}` }
    }
  }

  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
      subscribers.delete(socket)
    })
    socket.on('error', () => undefined)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
        let req: Record<string, unknown>
        try {
          req = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
        const verb = typeof req.verb === 'string' ? req.verb : ''
        const args = (typeof req.args === 'object' && req.args !== null ? req.args : {}) as Args
        calls.push({ verb, args })
        if (verb === 'subscribe') {
          subscribers.add(socket)
          socket.write(`${JSON.stringify({ v: 1, id: req.id, ok: true })}\n`)
          continue
        }
        socket.write(`${JSON.stringify({ v: 1, ...answer(verb, args), id: req.id })}\n`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  return {
    path,
    items,
    calls,
    get locked() {
      return state.locked
    },
    set locked(value: boolean) {
      state.locked = value
    },
    lock: () => {
      state.locked = true
      emit({ event: 'locked', reason: 'user' })
    },
    addLogin,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}

export interface CborReader {
  value: unknown
  end: number
}

export function decodeCbor(data: Buffer, at = 0): CborReader {
  const first = data[at] ?? 0
  const major = first >> 5
  const info = first & 31
  let pos = at + 1
  let n = info
  if (info === 24) {
    n = data[pos] ?? 0
    pos += 1
  } else if (info === 25) {
    n = data.readUInt16BE(pos)
    pos += 2
  } else if (info === 26) {
    n = data.readUInt32BE(pos)
    pos += 4
  }
  switch (major) {
    case 0:
      return { value: n, end: pos }
    case 1:
      return { value: -1 - n, end: pos }
    case 2:
      return { value: data.subarray(pos, pos + n), end: pos + n }
    case 3:
      return { value: data.subarray(pos, pos + n).toString('utf8'), end: pos + n }
    case 4: {
      const out: unknown[] = []
      for (let i = 0; i < n; i++) {
        const r = decodeCbor(data, pos)
        out.push(r.value)
        pos = r.end
      }
      return { value: out, end: pos }
    }
    case 5: {
      const out = new Map<unknown, unknown>()
      for (let i = 0; i < n; i++) {
        const k = decodeCbor(data, pos)
        const v = decodeCbor(data, k.end)
        out.set(k.value, v.value)
        pos = v.end
      }
      return { value: out, end: pos }
    }
    default:
      throw new Error(`cbor: major type ${String(major)} not supported`)
  }
}
