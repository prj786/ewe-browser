import { describe, expect, it } from 'vitest'
import { isShellCommand } from './ipc-contract'
import {
  DEFAULT_SAFE_SETTINGS,
  isSafeFill,
  isSafePageRequest,
  isSafePageState,
  isSafePasskeyRequest,
  isSafeSuggestState,
  isSafeWalletFill,
  sanitizeSafeSettings,
  siteHostOf,
} from './safe'

describe('isSafePageRequest', () => {
  it('accepts the page requests', () => {
    expect(isSafePageRequest({ op: 'state' })).toBe(true)
    expect(
      isSafePageRequest({
        op: 'open',
        kind: 'login',
        field: 'username',
        rect: { x: 1, y: 2, width: 3, height: 4 },
        trigger: 'icon',
      }),
    ).toBe(true)
    expect(
      isSafePageRequest({ op: 'open', kind: 'otp', field: 'code', rect: null, trigger: 'focus' }),
    ).toBe(true)
    expect(isSafePageRequest({ op: 'submit', kind: 'login', username: 'sam', password: 'x' })).toBe(
      true,
    )
    expect(isSafePageRequest({ op: 'move', rect: { x: 0, y: 0, width: 9, height: 9 } })).toBe(true)
    expect(isSafePageRequest({ op: 'move', rect: null })).toBe(true)
    expect(isSafePageRequest({ op: 'key', key: 'ArrowDown' })).toBe(true)
    expect(isSafePageRequest({ op: 'key', key: 'Enter' })).toBe(true)
    expect(isSafePageRequest({ op: 'filter', text: 'sa' })).toBe(true)
    for (const op of ['blur', 'focus', 'close']) expect(isSafePageRequest({ op })).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isSafePageRequest(null)).toBe(false)
    expect(isSafePageRequest({ op: 'reveal', id: 'a' })).toBe(false)
    expect(
      isSafePageRequest({
        op: 'open',
        kind: 'card',
        field: 'username',
        rect: null,
        trigger: 'icon',
      }),
    ).toBe(false)
    expect(
      isSafePageRequest({
        op: 'open',
        kind: 'login',
        field: 'username',
        rect: null,
        trigger: 'auto',
      }),
    ).toBe(false)
    expect(isSafePageRequest({ op: 'open', kind: 'login', rect: null, trigger: 'icon' })).toBe(
      false,
    )
    expect(
      isSafePageRequest({
        op: 'open',
        kind: 'login',
        field: 'username',
        rect: { x: 'a' },
        trigger: 'icon',
      }),
    ).toBe(false)
    expect(isSafePageRequest({ op: 'key', key: 'Tab' })).toBe(false)
    expect(isSafePageRequest({ op: 'filter', text: 'x'.repeat(2000) })).toBe(false)
    expect(isSafePageRequest({ op: 'move' })).toBe(false)
    expect(isSafePageRequest({ op: 'submit', kind: 'login', username: 'sam', password: '' })).toBe(
      false,
    )
    expect(
      isSafePageRequest({ op: 'submit', kind: 'login', username: 'x'.repeat(2000), password: 'p' }),
    ).toBe(false)
  })
})

describe('sign-up and wallet page requests', () => {
  it('accepts the new shapes', () => {
    for (const kind of ['login', 'signup', 'change'])
      expect(isSafePageRequest({ op: 'submit', kind, username: '', password: 'p' })).toBe(true)
    expect(
      isSafePageRequest({ op: 'submit', kind: 'new-password', username: '', password: 'p' }),
    ).toBe(false)
    expect(isSafePageRequest({ op: 'wallet', kind: 'card', rect: null, trigger: 'focus' })).toBe(
      true,
    )
    expect(isSafePageRequest({ op: 'wallet', kind: 'address', rect: null, trigger: 'key' })).toBe(
      true,
    )
    expect(isSafePageRequest({ op: 'wallet', kind: 'login', rect: null, trigger: 'key' })).toBe(
      false,
    )
    expect(isSafePageRequest({ op: 'username', username: 'sam@example.com' })).toBe(true)
    expect(isSafePageRequest({ op: 'username', username: '  ' })).toBe(false)
    expect(isSafePageRequest({ op: 'draft', username: 'sam', keep: true })).toBe(true)
    expect(isSafePageRequest({ op: 'draft', username: 'sam' })).toBe(false)
  })

  it('validates wallet fills', () => {
    const card = {
      holder: 'Sam Moe',
      number: '4242424242424242',
      expiryMonth: '08',
      expiryYear: '2029',
      securityCode: '123',
      brand: 'visa',
    }
    expect(isSafeWalletFill({ kind: 'card', card })).toBe(true)
    expect(isSafeWalletFill({ kind: 'card', card: { ...card, number: 4 } })).toBe(false)
    expect(isSafeWalletFill({ kind: 'address', card })).toBe(false)
    const address = {
      fullName: 'Sam Moe',
      givenName: 'Sam',
      familyName: 'Moe',
      organization: '',
      line1: '12 Main St',
      line2: '',
      city: 'Tbilisi',
      region: '',
      postalCode: '0100',
      country: 'GE',
      phone: '',
      email: '',
    }
    expect(isSafeWalletFill({ kind: 'address', address })).toBe(true)
    expect(isSafeWalletFill({ kind: 'address', address: { ...address, city: undefined } })).toBe(
      false,
    )
    expect(isSafeWalletFill({ kind: 'login' })).toBe(false)
  })

  it('accepts Unlock and save on the prompt', () => {
    expect(isShellCommand({ type: 'safe.prompt', promptId: 'p', action: 'unlock' })).toBe(true)
  })
})

describe('isSafeFill and isSafePageState', () => {
  it('validates the shapes', () => {
    expect(isSafeFill({ kind: 'login', username: 'sam', password: 'p' })).toBe(true)
    expect(isSafeFill({ kind: 'otp', otp: '123456' })).toBe(true)
    expect(isSafeFill({ kind: 'login', password: 7 })).toBe(false)
    expect(
      isSafePageState({
        enabled: true,
        suggest: true,
        capture: false,
        cards: true,
        addresses: false,
      }),
    ).toBe(true)
    expect(isSafePageState({ enabled: true, suggest: true, capture: false })).toBe(false)
    expect(isSafePageState({ enabled: true, capture: false })).toBe(false)
    expect(isSafeSuggestState({ open: true, visible: false, selected: false })).toBe(true)
    expect(isSafeSuggestState({ open: true })).toBe(false)
  })
})

describe('siteHostOf', () => {
  it('reduces urls and hosts to a bare host', () => {
    expect(siteHostOf('https://www.Example.com/login')).toBe('example.com')
    expect(siteHostOf('shop.example.com')).toBe('shop.example.com')
    expect(siteHostOf('http://127.0.0.1:8080')).toBe('127.0.0.1')
    expect(siteHostOf('not a host')).toBeNull()
    expect(siteHostOf('')).toBeNull()
  })
})

describe('sanitizeSafeSettings', () => {
  it('keeps valid values and cleans the never-save list', () => {
    expect(
      sanitizeSafeSettings(
        {
          fill: false,
          offerSave: false,
          neverSave: ['https://www.bank.com/x', 'bank.com', 'bad host', 3, 'shop.example.com'],
        },
        DEFAULT_SAFE_SETTINGS,
      ),
    ).toEqual({
      fill: false,
      suggest: true,
      passkeys: true,
      offerSave: false,
      fillCards: true,
      fillAddresses: true,
      neverSave: ['bank.com', 'shop.example.com'],
    })
    expect(
      sanitizeSafeSettings({ fillCards: false, fillAddresses: 'no' }, DEFAULT_SAFE_SETTINGS),
    ).toEqual({ ...DEFAULT_SAFE_SETTINGS, fillCards: false })
    expect(
      sanitizeSafeSettings({ suggest: false, passkeys: false }, DEFAULT_SAFE_SETTINGS),
    ).toEqual({ ...DEFAULT_SAFE_SETTINGS, suggest: false, passkeys: false })
  })

  it('ignores junk', () => {
    expect(sanitizeSafeSettings('x', DEFAULT_SAFE_SETTINGS)).toBe(DEFAULT_SAFE_SETTINGS)
    expect(sanitizeSafeSettings({ fill: 'yes' }, DEFAULT_SAFE_SETTINGS)).toEqual(
      DEFAULT_SAFE_SETTINGS,
    )
  })
})

describe('Safe shell commands', () => {
  it('validates them', () => {
    expect(isShellCommand({ type: 'safe.choose', requestId: 'r', id: 'i' })).toBe(true)
    expect(isShellCommand({ type: 'safe.choose', requestId: 'r' })).toBe(false)
    expect(isShellCommand({ type: 'safe.generate', requestId: 'r' })).toBe(true)
    expect(isShellCommand({ type: 'safe.unlock', requestId: 'r' })).toBe(true)
    expect(isShellCommand({ type: 'safe.openApp' })).toBe(true)
    expect(isShellCommand({ type: 'safe.prompt', promptId: 'p', action: 'save' })).toBe(true)
    expect(isShellCommand({ type: 'safe.prompt', promptId: 'p', action: 'delete' })).toBe(false)
    expect(isShellCommand({ type: 'overlay.request', part: 'prompt' })).toBe(false)
    expect(isShellCommand({ type: 'overlay.request', part: 'suggest' })).toBe(false)
    expect(isShellCommand({ type: 'overlay.request', part: 'sheet' })).toBe(false)
    expect(isShellCommand({ type: 'safe.fit', requestId: 'r', height: 120 })).toBe(true)
    expect(isShellCommand({ type: 'safe.fit', requestId: 'r', height: Number.NaN })).toBe(false)
    expect(isShellCommand({ type: 'safe.selected', requestId: 'r', selected: true })).toBe(true)
    expect(isShellCommand({ type: 'safe.close', requestId: 'r' })).toBe(true)
    expect(isShellCommand({ type: 'safe.passkey', requestId: 'r', credentialId: 'c' })).toBe(true)
    expect(isShellCommand({ type: 'safe.passkey', requestId: 'r' })).toBe(false)
    expect(isShellCommand({ type: 'safe.sheet', sheetId: 's', action: 'save' })).toBe(true)
    expect(
      isShellCommand({ type: 'safe.sheet', sheetId: 's', action: 'pick', credentialId: 'c' }),
    ).toBe(true)
    expect(isShellCommand({ type: 'safe.sheet', sheetId: 's', action: 'sign' })).toBe(false)
  })
})

describe('isSafePasskeyRequest', () => {
  it('accepts the bridge requests', () => {
    expect(isSafePasskeyRequest({ op: 'available' })).toBe(true)
    expect(isSafePasskeyRequest({ op: 'abort', id: 'a' })).toBe(true)
    expect(
      isSafePasskeyRequest({ op: 'create', id: 'a', origin: 'https://a.b', options: {} }),
    ).toBe(true)
    expect(
      isSafePasskeyRequest({
        op: 'get',
        id: 'a',
        origin: 'https://a.b',
        options: {},
        mediation: 'conditional',
      }),
    ).toBe(true)
    expect(isSafePasskeyRequest({ op: 'create', id: 'a', options: {} })).toBe(false)
  })

  it('refuses malformed ones', () => {
    const o = 'https://a.b'
    expect(isSafePasskeyRequest({ op: 'create', id: '', origin: o, options: {} })).toBe(false)
    expect(isSafePasskeyRequest({ op: 'create', id: 'x'.repeat(65), origin: o, options: {} })).toBe(
      false,
    )
    expect(isSafePasskeyRequest({ op: 'create', id: 'a', origin: o, options: [] })).toBe(false)
    expect(isSafePasskeyRequest({ op: 'get', id: 'a', origin: o, options: {} })).toBe(false)
    expect(isSafePasskeyRequest({ op: 'sign', id: 'a' })).toBe(false)
    expect(isSafePasskeyRequest(null)).toBe(false)
  })
})
