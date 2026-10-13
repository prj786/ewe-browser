import { describe, expect, it } from 'vitest'
import { displayUrl, hostOf, isOpenableUrl, isRestorableUrl, resolveInput } from './url'

describe('resolveInput', () => {
  it('opens full urls as-is', () => {
    expect(resolveInput('https://example.com/a?b=1', 'google')).toMatchObject({
      kind: 'url',
      url: 'https://example.com/a?b=1',
    })
  })

  it('adds https to bare hosts and http to local hosts', () => {
    expect(resolveInput('example.com', 'google').url).toBe('https://example.com')
    expect(resolveInput('docs.example.co.uk/path', 'google').url).toBe(
      'https://docs.example.co.uk/path',
    )
    expect(resolveInput('localhost:3000', 'google').url).toBe('http://localhost:3000')
    expect(resolveInput('192.168.1.10/admin', 'google').url).toBe('http://192.168.1.10/admin')
  })

  it('treats words and sentences as searches', () => {
    expect(resolveInput('electron browser', 'duckduckgo')).toMatchObject({
      kind: 'search',
      url: 'https://duckduckgo.com/?q=electron%20browser',
    })
    expect(resolveInput('hello', 'google').kind).toBe('search')
    expect(resolveInput('what is a.b', 'google').kind).toBe('search')
  })

  it('honours the w: and t: prefixes', () => {
    expect(resolveInput('w: example.com', 'google')).toMatchObject({
      kind: 'search',
      query: 'example.com',
    })
    expect(resolveInput('t:mail', 'google')).toMatchObject({ kind: 'tabs', query: 'mail' })
    expect(resolveInput('b: docs', 'google')).toEqual({ kind: 'bookmarks', url: '', query: 'docs' })
  })

  it('never navigates to javascript urls', () => {
    expect(resolveInput('javascript:alert(1)', 'google').kind).toBe('search')
  })

  it('keeps internal schemes', () => {
    expect(resolveInput('app://settings/', 'google').url).toBe('app://settings/')
    expect(resolveInput('about:blank', 'google').url).toBe('about:blank')
  })

  it('maps empty input to the new tab page', () => {
    expect(resolveInput('   ', 'google').url).toBe('app://newtab/')
  })
})

describe('displayUrl', () => {
  it('strips scheme, www and trailing slash', () => {
    expect(displayUrl('https://www.example.com/')).toBe('example.com')
    expect(displayUrl('https://example.com/a/b?c=1')).toBe('example.com/a/b?c=1')
  })

  it('hides the new tab url and keeps internal hosts', () => {
    expect(displayUrl('app://newtab/')).toBe('')
    expect(displayUrl('app://settings/')).toBe('app://settings')
  })

  it('returns garbage unchanged', () => {
    expect(displayUrl('not a url')).toBe('not a url')
    expect(hostOf('nope')).toBe('')
  })
})

describe('url allowlists', () => {
  it('lets pages open web and internal urls only', () => {
    expect(isOpenableUrl('https://a.b/')).toBe(true)
    expect(isOpenableUrl('app://settings/')).toBe(true)
    expect(isOpenableUrl('about:blank')).toBe(true)
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false)
    expect(isOpenableUrl('javascript:1')).toBe(false)
    expect(isOpenableUrl('data:text/html,x')).toBe(false)
  })

  it('also restores file urls from a saved session', () => {
    expect(isRestorableUrl('file:///home/me/doc.html')).toBe(true)
    expect(isRestorableUrl('chrome://gpu')).toBe(false)
  })
})
