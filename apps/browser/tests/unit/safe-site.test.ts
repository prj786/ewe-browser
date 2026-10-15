import { describe, expect, it } from 'vitest'
import { displayHost, matchLogins, matchSite, siteOf } from '../../src/main/safe/site'

const page = (url: string) => {
  const site = siteOf(url)
  if (site === null) throw new Error(`bad page ${url}`)
  return site
}

describe('siteOf', () => {
  it('reads scheme, host, port and the registrable domain', () => {
    expect(siteOf('https://accounts.example.co.uk/login?x=1')).toEqual({
      scheme: 'https',
      host: 'accounts.example.co.uk',
      port: '443',
      explicitPort: false,
      domain: 'example.co.uk',
    })
  })

  it('treats a bare host as https', () => {
    expect(siteOf('github.com/login')?.scheme).toBe('https')
  })

  it('has no registrable domain for IPs and localhost', () => {
    expect(siteOf('http://127.0.0.1:8080')?.domain).toBeNull()
    expect(siteOf('http://[::1]:3000')?.domain).toBeNull()
    expect(siteOf('http://localhost:5173')?.domain ?? null).toBeNull()
  })

  it('refuses other schemes', () => {
    expect(siteOf('androidapp://com.example')).toBeNull()
    expect(siteOf('ftp://example.com')).toBeNull()
    expect(siteOf('')).toBeNull()
  })
})

describe('matchSite', () => {
  it('matches the same host exactly, with or without www', () => {
    expect(matchSite(page('https://github.com/login'), 'https://github.com')).toBe('exact')
    expect(matchSite(page('https://www.github.com/'), 'github.com')).toBe('exact')
  })

  it('matches a sibling host on the same registrable domain', () => {
    expect(matchSite(page('https://login.example.com'), 'https://example.com')).toBe('domain')
    expect(matchSite(page('https://login.bank.co.uk'), 'https://bank.co.uk')).toBe('domain')
  })

  it('never matches look-alikes', () => {
    expect(matchSite(page('https://github.com.evil.com'), 'https://github.com')).toBeNull()
    expect(matchSite(page('https://evil-github.com'), 'https://github.com')).toBeNull()
    expect(matchSite(page('https://githubcom.io'), 'https://github.com')).toBeNull()
  })

  it('keeps public suffixes apart, including private ones', () => {
    expect(matchSite(page('https://other.co.uk'), 'https://bank.co.uk')).toBeNull()
    expect(matchSite(page('https://alice.github.io'), 'https://bob.github.io')).toBeNull()
    expect(matchSite(page('https://alice.github.io/app'), 'https://alice.github.io')).toBe('exact')
  })

  it('never offers an https login to an http page, but upgrades http to https', () => {
    expect(matchSite(page('http://example.com'), 'https://example.com')).toBeNull()
    expect(matchSite(page('https://example.com'), 'http://example.com')).toBe('exact')
  })

  it('respects ports', () => {
    expect(matchSite(page('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080')).toBe('exact')
    expect(matchSite(page('http://127.0.0.1:8081/'), 'http://127.0.0.1:8080')).toBeNull()
    expect(matchSite(page('https://example.com:8443'), 'https://example.com')).toBeNull()
    expect(matchSite(page('http://localhost:3000'), 'http://127.0.0.1:3000')).toBeNull()
  })

  it('matches IPs only exactly', () => {
    expect(matchSite(page('http://10.0.0.2'), 'http://10.0.0.1')).toBeNull()
  })

  it('ignores unusable item urls', () => {
    expect(matchSite(page('https://example.com'), 'androidapp://example')).toBeNull()
    expect(matchSite(page('https://example.com'), '')).toBeNull()
  })
})

describe('matchLogins', () => {
  it('keeps matching logins, exact before domain, then by title', () => {
    const items = [
      { title: 'zeta', urls: ['https://example.com'] },
      { title: 'beta', urls: ['https://shop.example.com'] },
      { title: 'alpha', urls: ['https://example.com/login'] },
      { title: 'other', urls: ['https://other.com'] },
      { title: 'many', urls: ['https://nope.org', 'https://www.example.com'] },
    ]
    const out = matchLogins(page('https://example.com/signin'), items)
    expect(out.map((i) => [i.title, i.match])).toEqual([
      ['alpha', 'exact'],
      ['many', 'exact'],
      ['zeta', 'exact'],
      ['beta', 'domain'],
    ])
  })
})

describe('displayHost', () => {
  it('drops www and default ports', () => {
    expect(displayHost(page('https://www.example.com'))).toBe('example.com')
    expect(displayHost(page('http://127.0.0.1:8080'))).toBe('127.0.0.1:8080')
  })
})
