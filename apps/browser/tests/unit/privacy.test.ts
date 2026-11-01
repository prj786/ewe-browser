import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HttpsOnlyState, httpsUpgrade, isLocalHost } from '../../src/main/privacy/https-only'
import {
  DISMISS_QUIET_MS,
  Dismissals,
  PermissionStore,
  kindsFor,
  sanitizeSites,
  verdict,
} from '../../src/main/privacy/permissions'
import { PrivacyService } from '../../src/main/privacy/service'
import {
  NO_DNS_PREFETCH,
  blinkSettingSwitch,
  featureSwitch,
  privacyAtStartup,
} from '../../src/main/privacy/startup'
import { SettingsStore } from '../../src/main/storage/settings-store'
import { permissionRect } from '../../src/main/privacy/window'
import { privacyPage } from '../../src/preload/privacy'

describe('site permissions', () => {
  it('maps what Chromium asks for to the kinds people decide on', () => {
    expect(kindsFor('media', ['video', 'audio'])).toEqual(['camera', 'microphone'])
    expect(kindsFor('media', ['audio'])).toEqual(['microphone'])
    expect(kindsFor('media', [])).toEqual([])
    expect(kindsFor('geolocation')).toEqual(['location'])
    expect(kindsFor('notifications')).toEqual(['notifications'])
    expect(kindsFor('clipboard-read')).toEqual(['clipboard'])
    expect(kindsFor('midiSysex')).toEqual(['midi'])
    expect(kindsFor('local-network-access')).toEqual(['local-network'])
    expect(kindsFor('window-management')).toEqual(['windows'])
    expect(kindsFor('idle-detection')).toEqual(['idle'])
    expect(kindsFor('usb')).toEqual([])
    expect(kindsFor('openExternal')).toEqual([])
  })

  it('allows only when every kind is allowed, blocks when any is blocked, else asks', () => {
    expect(verdict(undefined, ['camera'])).toBe('ask')
    expect(verdict({ camera: 'allow' }, ['camera', 'microphone'])).toBe('ask')
    expect(verdict({ camera: 'allow', microphone: 'allow' }, ['camera', 'microphone'])).toBe(
      'allow',
    )
    expect(verdict({ camera: 'allow', microphone: 'block' }, ['camera', 'microphone'])).toBe(
      'block',
    )
    expect(verdict({ camera: 'allow' }, [])).toBe('block')
  })

  it('remembers, changes and forgets decisions per origin in permissions.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-perm-'))
    const store = new PermissionStore(dir)
    await store.load()
    let changes = 0
    store.on('change', () => changes++)
    store.set('https://meet.example', ['camera', 'microphone'], 'allow', 10)
    store.set('https://news.example', ['notifications'], 'block', 20)
    store.set('app://settings', ['camera'], 'allow', 30)
    expect(store.value('https://meet.example', 'camera')).toBe('allow')
    expect(store.value('https://meet.example', 'location')).toBe('ask')
    expect(store.list().map((s) => s.origin)).toEqual([
      'https://news.example',
      'https://meet.example',
    ])
    store.set('https://meet.example', ['camera'], 'ask', 40)
    expect(store.get('https://meet.example')).toEqual({ microphone: 'allow' })
    store.set('https://meet.example', ['microphone'], 'ask', 50)
    expect(store.get('https://meet.example')).toBeUndefined()
    store.forget('https://news.example')
    expect(store.list()).toEqual([])
    expect(changes).toBe(5)
    store.set('https://meet.example', ['camera'], 'block', 60)
    await store.flush()
    const file = JSON.parse(readFileSync(join(dir, 'permissions.json'), 'utf8')) as unknown
    expect(file).toEqual({
      version: 1,
      sites: [{ origin: 'https://meet.example', permissions: { camera: 'block' }, updated: 60 }],
    })
    const again = new PermissionStore(dir)
    await again.load()
    expect(again.value('https://meet.example', 'camera')).toBe('block')
  })

  it('drops broken entries from the file', () => {
    expect(
      sanitizeSites([
        { origin: 'https://a.example', permissions: { camera: 'allow', usb: 'allow' }, updated: 2 },
        { origin: 'https://a.example', permissions: { camera: 'block' }, updated: 3 },
        { origin: 'https://b.example/', permissions: { camera: 'allow' }, updated: 1 },
        { origin: 'https://c.example', permissions: { camera: 'maybe' }, updated: 1 },
        { origin: 'https://d.example', permissions: { midi: 'block' } },
        'junk',
      ]),
    ).toEqual([
      { origin: 'https://a.example', permissions: { camera: 'allow' }, updated: 2 },
      { origin: 'https://d.example', permissions: { midi: 'block' }, updated: 0 },
    ])
  })

  it('puts the prompt card at the top left of the page', () => {
    expect(permissionRect({ x: 272, y: 8, width: 1000, height: 700 }, 190)).toEqual({
      x: 272,
      y: 8,
      width: 384,
      height: 190,
    })
    expect(permissionRect({ x: 0, y: 0, width: 300, height: 100 }, 190)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 100,
    })
  })
})

describe('HTTPS-Only', () => {
  it('leaves local and private addresses alone', () => {
    for (const host of [
      'localhost',
      'printer.local',
      'app.localhost',
      'nas.home.arpa',
      'router',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.9',
      '172.31.255.1',
      '192.168.1.1',
      '169.254.0.1',
      '100.100.1.1',
      '[::1]',
      '[fd00::1]',
      '[fe80::1]',
    ])
      expect(isLocalHost(host), host).toBe(true)
    for (const host of ['example.com', '172.32.0.1', '8.8.8.8', 'flock.example', '[2606:4700::1]'])
      expect(isLocalHost(host), host).toBe(false)
  })

  it('upgrades default-port http urls of other hosts', () => {
    const none = new Set<string>()
    expect(httpsUpgrade('http://example.com/a?b=1#c', none)).toBe('https://example.com/a?b=1#c')
    expect(httpsUpgrade('http://example.com:80/', none)).toBe('https://example.com/')
    expect(httpsUpgrade('http://example.com:8080/', none)).toBeNull()
    expect(httpsUpgrade('https://example.com/', none)).toBeNull()
    expect(httpsUpgrade('http://192.168.1.1/', none)).toBeNull()
    expect(httpsUpgrade('http://example.com/', new Set(['example.com']))).toBeNull()
  })

  it('remembers upgrades per tab, maps a failure back to the http url and allows a host', () => {
    let on = true
    const state = new HttpsOnlyState(() => on)
    expect(state.upgrade(7, 'http://plain.example/page', true)).toBe('https://plain.example/page')
    expect(state.failed(7, 'https://other.example/')).toBeNull()
    expect(state.failed(7, 'https://plain.example/elsewhere')).toBe('http://plain.example/page')
    expect(state.failed(7, 'https://plain.example/page')).toBeNull()
    expect(state.upgrade(8, 'http://frame.example/', false)).toBe('https://frame.example/')
    expect(state.failed(8, 'https://frame.example/')).toBeNull()
    state.upgrade(9, 'http://plain.example/', true)
    state.forget(9)
    expect(state.failed(9, 'https://plain.example/')).toBeNull()
    expect(state.allow('http://Plain.Example/x')).toBe('plain.example')
    expect(state.isAllowed('plain.example')).toBe(true)
    expect(state.upgrade(7, 'http://plain.example/page', true)).toBeNull()
    expect(state.allow('https://plain.example/')).toBeNull()
    on = false
    expect(state.upgrade(7, 'http://new.example/', true)).toBeNull()
  })
})

describe('third-party cookies at startup', () => {
  it('reads the setting before the app is ready and appends one feature', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-privacy-start-'))
    expect(privacyAtStartup(dir).blockThirdPartyCookies).toBe(true)
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ privacy: { blockThirdPartyCookies: false } }),
    )
    expect(privacyAtStartup(dir).blockThirdPartyCookies).toBe(false)
    writeFileSync(join(dir, 'settings.json'), '{broken')
    expect(privacyAtStartup(dir).blockThirdPartyCookies).toBe(true)
    expect(featureSwitch('', 'X')).toBe('X')
    expect(featureSwitch('A,X,B', 'X')).toBe('A,B,X')
    expect(blinkSettingSwitch('', NO_DNS_PREFETCH)).toBe('dnsPrefetchingEnabled=false')
    expect(
      blinkSettingSwitch('imagesEnabled=false,dnsPrefetchingEnabled=true', NO_DNS_PREFETCH),
    ).toBe('imagesEnabled=false,dnsPrefetchingEnabled=false')
  })
})

describe('the page side of privacy', () => {
  class Status {
    state = 'denied'
  }
  const scope = () => {
    const Navigator = { prototype: {} }
    const Permissions = class {
      query(descriptor: { name: string }): Promise<Status> {
        const status = new Status()
        if (descriptor.name === 'geolocation') status.state = 'granted'
        return Promise.resolve(status)
      }
    }
    const Notification = Object.defineProperty({}, 'permission', {
      get: () => 'denied',
      configurable: true,
    }) as { permission: string }
    return { Navigator, Permissions, Notification }
  }

  it('adds navigator.globalPrivacyControl when GPC is on', () => {
    const s = scope()
    privacyPage({ gpc: true, ask: [] }, s)
    expect(
      Reflect.get(Object.create(s.Navigator.prototype) as object, 'globalPrivacyControl'),
    ).toBe(true)
    const off = scope()
    privacyPage({ gpc: false, ask: [] }, off)
    expect('globalPrivacyControl' in off.Navigator.prototype).toBe(false)
  })

  it('reports undecided permissions as prompt instead of denied', async () => {
    const s = scope()
    privacyPage({ gpc: false, ask: ['camera', 'notifications'] }, s)
    const permissions = new s.Permissions()
    const camera = await permissions.query({ name: 'camera' })
    expect(camera.state).toBe('prompt')
    expect(camera).toBeInstanceOf(Status)
    expect((await permissions.query({ name: 'microphone' })).state).toBe('denied')
    expect((await permissions.query({ name: 'geolocation' })).state).toBe('granted')
    expect(s.Notification.permission).toBe('default')
  })
})

describe('asking again after Not now', () => {
  it('stays quiet for ten minutes after two dismissals of an origin', () => {
    const d = new Dismissals()
    d.note('https://spam.example', 0)
    expect(d.quiet('https://spam.example', 1)).toBe(false)
    d.note('https://spam.example', 10)
    expect(d.quiet('https://spam.example', 11)).toBe(true)
    expect(d.quiet('https://other.example', 11)).toBe(false)
    expect(d.quiet('https://spam.example', 10 + DISMISS_QUIET_MS + 1)).toBe(false)
    d.note('https://spam.example', 20)
    d.forget('https://spam.example')
    d.note('https://spam.example', 30)
    expect(d.quiet('https://spam.example', 31)).toBe(false)
  })
})

describe('Secure DNS', () => {
  it('keeps the last good configuration when the new one is invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-dns-'))
    const settings = new SettingsStore(dir)
    await settings.load()
    const permissions = new PermissionStore(dir)
    const applied: unknown[] = []
    const service = new PrivacyService({
      settings,
      permissions,
      thirdPartyBlocked: true,
      ask: () => false,
      configureHostResolver: (options) => applied.push(options),
    })
    service.applyDns()
    expect(applied).toEqual([{ secureDnsMode: 'off' }])
    const privacy = settings.get().privacy
    settings.update({ privacy: { ...privacy, secureDns: 'secure', dnsProvider: 'quad9' } })
    expect(applied.at(-1)).toEqual({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://dns.quad9.net/dns-query'],
    })
    settings.update({
      privacy: { ...settings.get().privacy, dnsProvider: 'custom', dnsTemplate: 'http://bad/' },
    })
    expect(applied).toHaveLength(2)
    expect(service.status().dnsError).toContain('https://')
    settings.update({ privacy: { ...settings.get().privacy, dnsProvider: 'quad9' } })
    expect(applied).toHaveLength(2)
    expect(service.status().dnsError).toBeNull()
    settings.update({ privacy: { ...settings.get().privacy, secureDns: 'off' } })
    expect(applied.at(-1)).toEqual({ secureDnsMode: 'off' })
  })

  it('applies the system resolver when the first configuration is already invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ewe-dns-bad-'))
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ privacy: { secureDns: 'secure', dnsProvider: 'nextdns', nextdnsId: '' } }),
    )
    const settings = new SettingsStore(dir)
    await settings.load()
    const applied: unknown[] = []
    const service = new PrivacyService({
      settings,
      permissions: new PermissionStore(dir),
      thirdPartyBlocked: false,
      ask: () => false,
      configureHostResolver: (options) => applied.push(options),
    })
    service.applyDns()
    expect(applied).toEqual([{ secureDnsMode: 'off' }])
    expect(service.status()).toEqual({
      thirdPartyBlocked: false,
      dnsError: 'Enter your NextDNS configuration ID.',
    })
  })
})
