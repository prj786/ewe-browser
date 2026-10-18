import { describe, expect, it } from 'vitest'
import { isShellCommand } from './ipc-contract'
import {
  DEFAULT_PRIVACY_SETTINGS,
  dohConfig,
  isDohTemplate,
  isPermissionsRequest,
  isWebOrigin,
  originHost,
  sanitizePrivacySettings,
  webOrigin,
} from './privacy'

describe('privacy settings', () => {
  it('defaults to the system resolver, no HTTPS-Only, blocked third-party cookies and GPC on', () => {
    expect(DEFAULT_PRIVACY_SETTINGS).toMatchObject({
      secureDns: 'off',
      httpsOnly: false,
      blockThirdPartyCookies: true,
      gpc: true,
    })
  })

  it('keeps valid fields and drops the rest', () => {
    const base = DEFAULT_PRIVACY_SETTINGS
    expect(
      sanitizePrivacySettings({ secureDns: 'secure', dnsProvider: 'quad9' }, base),
    ).toMatchObject({
      secureDns: 'secure',
      dnsProvider: 'quad9',
    })
    expect(
      sanitizePrivacySettings({ secureDns: 'always', dnsProvider: 'google', gpc: 'yes' }, base),
    ).toEqual(base)
    expect(
      sanitizePrivacySettings({ nextdnsId: ` ${'a'.repeat(40)} ` }, base).nextdnsId,
    ).toHaveLength(32)
    expect(sanitizePrivacySettings(null, base)).toBe(base)
  })

  it('turns the choice into a host resolver configuration', () => {
    const p = DEFAULT_PRIVACY_SETTINGS
    expect(dohConfig(p)).toEqual({ ok: true, mode: 'off', servers: [] })
    expect(dohConfig({ ...p, secureDns: 'automatic' })).toEqual({
      ok: true,
      mode: 'automatic',
      servers: [],
    })
    expect(dohConfig({ ...p, secureDns: 'secure', dnsProvider: 'cloudflare' })).toEqual({
      ok: true,
      mode: 'secure',
      servers: ['https://chrome.cloudflare-dns.com/dns-query'],
    })
    expect(
      dohConfig({ ...p, secureDns: 'secure', dnsProvider: 'nextdns', nextdnsId: 'abc123' }),
    ).toEqual({
      ok: true,
      mode: 'secure',
      servers: ['https://dns.nextdns.io/abc123'],
    })
    expect(dohConfig({ ...p, secureDns: 'secure', dnsProvider: 'nextdns', nextdnsId: '' }).ok).toBe(
      false,
    )
    expect(
      dohConfig({ ...p, secureDns: 'secure', dnsProvider: 'custom', dnsTemplate: 'http://x/dns' })
        .ok,
    ).toBe(false)
    expect(
      dohConfig({
        ...p,
        secureDns: 'secure',
        dnsProvider: 'custom',
        dnsTemplate: 'https://dns.example/dns-query{?dns}',
      }),
    ).toMatchObject({ ok: true, servers: ['https://dns.example/dns-query{?dns}'] })
  })

  it('accepts only https DNS-over-HTTPS templates with at most {?dns}', () => {
    expect(isDohTemplate('https://dns.example/dns-query')).toBe(true)
    expect(isDohTemplate('https://dns.example/dns-query{?dns}')).toBe(true)
    expect(isDohTemplate('http://dns.example/dns-query')).toBe(false)
    expect(isDohTemplate('https://dns.example/{name}')).toBe(false)
    expect(isDohTemplate('https://user:pw@dns.example/')).toBe(false)
    expect(isDohTemplate('https://dns example/')).toBe(false)
    expect(isDohTemplate('')).toBe(false)
  })
})

describe('origins and requests', () => {
  it('reduces urls to web origins', () => {
    expect(webOrigin('https://meet.example/abc?x=1')).toBe('https://meet.example')
    expect(webOrigin('http://localhost:8080/')).toBe('http://localhost:8080')
    expect(webOrigin('app://settings/')).toBeNull()
    expect(webOrigin('file:///tmp/x.html')).toBeNull()
    expect(isWebOrigin('https://meet.example')).toBe(true)
    expect(isWebOrigin('https://meet.example/')).toBe(false)
    expect(originHost('https://meet.example:8443')).toBe('meet.example:8443')
    expect(isPermissionsRequest({ op: 'list' })).toBe(true)
    expect(isPermissionsRequest({ op: 'drop' })).toBe(false)
  })

  it('validates the new commands', () => {
    expect(isShellCommand({ type: 'permission.decide', promptId: 'p', decision: 'allow' })).toBe(
      true,
    )
    expect(isShellCommand({ type: 'permission.decide', promptId: 'p', decision: 'yes' })).toBe(
      false,
    )
    expect(isShellCommand({ type: 'permission.fit', promptId: 'p', height: 180 })).toBe(true)
    expect(
      isShellCommand({
        type: 'permission.set',
        origin: 'https://meet.example',
        kind: 'camera',
        value: 'block',
      }),
    ).toBe(true)
    expect(
      isShellCommand({
        type: 'permission.set',
        origin: 'https://meet.example',
        kind: 'usb',
        value: 'allow',
      }),
    ).toBe(false)
    expect(
      isShellCommand({
        type: 'permission.set',
        origin: 'app://settings',
        kind: 'camera',
        value: 'allow',
      }),
    ).toBe(false)
    expect(isShellCommand({ type: 'permission.forget', origin: 'https://meet.example' })).toBe(true)
    expect(isShellCommand({ type: 'siteinfo.open', x: 10, y: 40 })).toBe(true)
    expect(isShellCommand({ type: 'siteinfo.open', x: Number.NaN, y: 40 })).toBe(false)
    expect(isShellCommand({ type: 'site.clearData', origin: 'https://meet.example' })).toBe(true)
    expect(isShellCommand({ type: 'https.allow', url: 'http://plain.example/' })).toBe(true)
    expect(isShellCommand({ type: 'https.allow', url: 'https://plain.example/' })).toBe(false)
    expect(isShellCommand({ type: 'https.allow', url: 'javascript:alert(1)' })).toBe(false)
  })
})
