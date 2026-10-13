import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getName: () => 'ewe-browser', userAgentFallback: '' } }))

const { cleanUserAgent } = await import('../../src/main/identity')

describe('cleanUserAgent', () => {
  it('strips the Electron token and the app token', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ewe-browser/0.1.0 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36'
    expect(cleanUserAgent(ua)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36',
    )
  })

  it('leaves a clean Chrome user agent untouched', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
    expect(cleanUserAgent(ua)).toBe(ua)
  })
})
