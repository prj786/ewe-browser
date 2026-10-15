export interface PageBridge {
  available(): Promise<boolean>
  create(id: string, options: Record<string, unknown>): Promise<unknown>
  get(id: string, options: Record<string, unknown>, mediation: string): Promise<unknown>
  abort(id: string): void
}

type Json = Record<string, unknown>
type Native = (this: unknown, ...args: unknown[]) => unknown

export function pageScript(bridge: PageBridge): void {
  const w = window
  const creds = w.navigator.credentials as CredentialsContainer | undefined
  const PKC = w.PublicKeyCredential as typeof PublicKeyCredential | undefined
  if (creds === undefined || typeof PKC !== 'function' || !w.isSecureContext) return
  const apply = Reflect.apply
  const take = (target: object, key: string): Native | undefined => {
    const value: unknown = Reflect.get(target, key)
    return typeof value === 'function' ? (value as Native) : undefined
  }
  const call = (fn: Native, self: unknown, args: unknown[]): unknown => apply(fn, self, args)
  const nativeCreate = take(creds, 'create')
  const nativeGet = take(creds, 'get')
  const nativeUvpaa = take(PKC, 'isUserVerifyingPlatformAuthenticatorAvailable')
  const nativeCma = take(PKC, 'isConditionalMediationAvailable')
  const nativeCaps = take(PKC, 'getClientCapabilities')
  const isViewNative = take(w.ArrayBuffer, 'isView')
  const toTag = take(Object.prototype, 'toString')
  if (nativeCreate === undefined || nativeGet === undefined || toTag === undefined) return
  const createNative: Native = nativeCreate
  const getNative: Native = nativeGet
  const tagOf: Native = toTag
  const AttestationProto: unknown = w.AuthenticatorAttestationResponse.prototype
  const AssertionProto: unknown = w.AuthenticatorAssertionResponse.prototype
  const CredentialProto: unknown = PKC.prototype
  const defineProperty = Object.defineProperty
  const setProto = Object.setPrototypeOf
  const arrayFrom = Array.from
  const isArray = Array.isArray
  const stringify = JSON.stringify
  const parse = JSON.parse
  const Bytes = w.Uint8Array
  const fromCharCode = w.String.fromCharCode
  const encode = w.btoa.bind(w)
  const decode = w.atob.bind(w)
  const Exception = w.DOMException
  const TypeErr = w.TypeError
  const PromiseCtor = w.Promise
  const Controller = w.AbortController
  const uuid = w.crypto.randomUUID.bind(w.crypto)
  const setTimer = w.setTimeout.bind(w)
  const clearTimer = w.clearTimeout.bind(w)
  const TIMEOUT_DEFAULT = 300_000
  const TIMEOUT_MIN = 30_000
  const TIMEOUT_MAX = 600_000
  const REFUSED = 'The operation either timed out or was not allowed.'

  const record = (value: unknown): Json | null =>
    typeof value === 'object' && value !== null ? (value as Json) : null

  const text = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
      return String(value)
    return ''
  }

  const optionalText = (value: unknown): string | undefined =>
    value === undefined || value === null ? undefined : text(value)

  const isView = (value: unknown): value is ArrayBufferView =>
    isViewNative !== undefined && call(isViewNative, w.ArrayBuffer, [value]) === true

  const b64u = (source: unknown): string => {
    let bytes: Uint8Array
    if (isView(source)) bytes = new Bytes(source.buffer, source.byteOffset, source.byteLength)
    else if (call(tagOf, source, []) === '[object ArrayBuffer]')
      bytes = new Bytes(source as ArrayBuffer)
    else throw new TypeErr('Expected an ArrayBuffer or a typed array.')
    let binary = ''
    for (const byte of bytes) binary += fromCharCode(byte)
    return encode(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  const fromB64u = (value: unknown): ArrayBuffer => {
    const binary = decode(text(value).replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Bytes(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out.buffer
  }

  const descriptors = (list: unknown): Json[] => {
    if (list === undefined || list === null) return []
    if (typeof list !== 'object') throw new TypeErr('Expected a list of credentials.')
    return arrayFrom(list as Iterable<unknown>).map((entry) => {
      const d = record(entry)
      if (d === null) throw new TypeErr('Expected a credential descriptor.')
      return { type: text(d.type), id: b64u(d.id) }
    })
  }

  const params = (list: unknown): Json[] => {
    if (list === undefined || list === null) return []
    if (typeof list !== 'object') throw new TypeErr('Expected a list of key types.')
    return arrayFrom(list as Iterable<unknown>).map((entry) => {
      const p = record(entry) ?? {}
      return { type: text(p.type), alg: Number(p.alg) }
    })
  }

  const createData = (pk: Json): Json => {
    const rp = record(pk.rp)
    const user = record(pk.user)
    if (rp === null || user === null)
      throw new TypeErr('The relying party and the user are required.')
    const selection = record(pk.authenticatorSelection)
    const extensions = record(pk.extensions)
    return {
      challenge: b64u(pk.challenge),
      rp: { id: optionalText(rp.id), name: text(rp.name) },
      user: { id: b64u(user.id), name: text(user.name), displayName: text(user.displayName) },
      pubKeyCredParams: params(pk.pubKeyCredParams),
      excludeCredentials: descriptors(pk.excludeCredentials),
      authenticatorSelection:
        selection === null
          ? undefined
          : {
              authenticatorAttachment: optionalText(selection.authenticatorAttachment),
              residentKey: optionalText(selection.residentKey),
              userVerification: optionalText(selection.userVerification),
            },
      attestation: optionalText(pk.attestation),
      timeout: pk.timeout === undefined ? undefined : Number(pk.timeout),
      extensions: extensions === null ? undefined : { credProps: extensions.credProps === true },
    }
  }

  const getData = (pk: Json): Json => ({
    challenge: b64u(pk.challenge),
    rpId: optionalText(pk.rpId),
    allowCredentials: descriptors(pk.allowCredentials),
    userVerification: optionalText(pk.userVerification),
    timeout: pk.timeout === undefined ? undefined : Number(pk.timeout),
  })

  const copy = (value: unknown): Json => parse(stringify(value ?? {})) as Json

  const registration = (c: Json): object => {
    const r = record(c.response) ?? {}
    const transports = isArray(r.transports) ? r.transports.map(text) : []
    const response = {
      clientDataJSON: fromB64u(r.clientDataJSON),
      attestationObject: fromB64u(r.attestationObject),
      getAuthenticatorData: () => fromB64u(r.authenticatorData),
      getPublicKey: () => fromB64u(r.publicKey),
      getPublicKeyAlgorithm: () => Number(r.publicKeyAlgorithm),
      getTransports: () => transports.slice(),
    }
    setProto(response, AttestationProto as object)
    const credential = {
      id: text(c.id),
      rawId: fromB64u(c.rawId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response,
      getClientExtensionResults: () => copy(c.clientExtensionResults),
      toJSON: () => copy(c),
    }
    setProto(credential, CredentialProto as object)
    return credential
  }

  const assertion = (c: Json): object => {
    const r = record(c.response) ?? {}
    const response = {
      clientDataJSON: fromB64u(r.clientDataJSON),
      authenticatorData: fromB64u(r.authenticatorData),
      signature: fromB64u(r.signature),
      userHandle:
        r.userHandle === null || r.userHandle === undefined ? null : fromB64u(r.userHandle),
    }
    setProto(response, AssertionProto as object)
    const credential = {
      id: text(c.id),
      rawId: fromB64u(c.rawId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response,
      getClientExtensionResults: () => copy(c.clientExtensionResults),
      toJSON: () => copy(c),
    }
    setProto(credential, CredentialProto as object)
    return credential
  }

  const failure = (reply: Json): Error => {
    const message = text(reply.message) || REFUSED
    const name = text(reply.name) || 'NotAllowedError'
    return name === 'TypeError' ? new TypeErr(message) : new Exception(message, name)
  }

  const settle = (reply: unknown, build: (c: Json) => object): object | null => {
    const r = record(reply)
    if (r === null) throw new Exception('Safe did not answer.', 'NotAllowedError')
    if (r.native === true) return null
    const credential = record(r.credential)
    if (r.ok === true && credential !== null) return build(credential)
    throw failure(r)
  }

  const abortReason = (signal: AbortSignal): Error => {
    const reason: unknown = signal.reason
    return reason instanceof Error
      ? reason
      : new Exception('The operation was aborted.', 'AbortError')
  }

  const watched = (signal: AbortSignal | undefined | null, id: string, work: Promise<unknown>) => {
    if (signal === undefined || signal === null) return work
    return new PromiseCtor<unknown>((resolve, reject) => {
      const onAbort = () => {
        bridge.abort(id)
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      work.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(error instanceof Error ? error : new Exception(REFUSED, 'NotAllowedError'))
        },
      )
    })
  }

  const timeoutOf = (pk: Json): number => {
    const ms = Number(pk.timeout)
    const value = Number.isFinite(ms) && ms > 0 ? ms : TIMEOUT_DEFAULT
    return Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, value))
  }

  const native = (
    fn: Native,
    options: CredentialCreationOptions | CredentialRequestOptions,
    pk: Json,
  ): Promise<unknown> => {
    const controller = new Controller()
    const outer = options.signal
    const timer = setTimer(() => {
      controller.abort(new Exception(REFUSED, 'NotAllowedError'))
    }, timeoutOf(pk))
    if (outer !== undefined && outer !== null) {
      if (outer.aborted) controller.abort(abortReason(outer))
      else
        outer.addEventListener('abort', () => controller.abort(abortReason(outer)), { once: true })
    }
    const pending = call(fn, creds, [{ ...options, signal: controller.signal }]) as Promise<unknown>
    return pending.then(
      (value) => {
        clearTimer(timer)
        return value
      },
      (error: unknown) => {
        clearTimer(timer)
        throw error
      },
    )
  }

  async function create(options?: CredentialCreationOptions): Promise<unknown> {
    const pk = record(options?.publicKey)
    if (options === undefined || pk === null) return call(createNative, creds, [options])
    const signal = options.signal
    if (signal?.aborted === true) throw abortReason(signal)
    const data = createData(pk)
    const id = uuid()
    const reply = await watched(signal, id, bridge.create(id, data))
    const result = settle(reply, registration)
    return result ?? native(createNative, options, pk)
  }

  async function get(options?: CredentialRequestOptions): Promise<unknown> {
    const pk = record(options?.publicKey)
    if (options === undefined || pk === null) return call(getNative, creds, [options])
    const signal = options.signal
    if (signal?.aborted === true) throw abortReason(signal)
    const mediation = typeof options.mediation === 'string' ? options.mediation : 'optional'
    const data = getData(pk)
    const id = uuid()
    const reply = await watched(signal, id, bridge.get(id, data, mediation))
    const result = settle(reply, assertion)
    return result ?? native(getNative, options, pk)
  }

  const available = async (): Promise<boolean> => {
    try {
      const value: unknown = await bridge.available()
      return value === true
    } catch {
      return false
    }
  }

  async function isUserVerifyingPlatformAuthenticatorAvailable(): Promise<unknown> {
    if (await available()) return true
    return nativeUvpaa === undefined ? false : call(nativeUvpaa, PKC, [])
  }

  async function isConditionalMediationAvailable(): Promise<unknown> {
    if (await available()) return true
    return nativeCma === undefined ? false : call(nativeCma, PKC, [])
  }

  async function getClientCapabilities(): Promise<Json> {
    let base: Json = {}
    if (nativeCaps !== undefined) {
      try {
        base = record(await call(nativeCaps, PKC, [])) ?? {}
      } catch {
        base = {}
      }
    }
    if (!(await available())) return base
    return {
      ...base,
      conditionalGet: true,
      passkeyPlatformAuthenticator: true,
      userVerifyingPlatformAuthenticator: true,
      'extension:credProps': true,
    }
  }

  const install = (target: object, key: string, value: unknown) => {
    defineProperty(target, key, { value, writable: true, configurable: true, enumerable: false })
  }
  install(creds, 'create', create)
  install(creds, 'get', get)
  install(
    PKC,
    'isUserVerifyingPlatformAuthenticatorAvailable',
    isUserVerifyingPlatformAuthenticatorAvailable,
  )
  install(PKC, 'isConditionalMediationAvailable', isConditionalMediationAvailable)
  install(PKC, 'getClientCapabilities', getClientCapabilities)
}
