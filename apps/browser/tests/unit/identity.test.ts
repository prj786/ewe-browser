import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getName: () => 'ewe-browser', userAgentFallback: '' } }))

const { cleanUserAgent, fullVersion, reportedUserAgent, stableMajor, versionHeaders } =
  await import('../../src/main/identity')

const day = 24 * 60 * 60 * 1000

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

describe('the reported Chrome version', () => {
  const anchor = Date.UTC(2026, 9, 6)

  it('follows the two-week stable schedule', () => {
    expect(stableMajor(anchor, 152)).toBe(155)
    expect(stableMajor(Date.UTC(2026, 9, 15), 152)).toBe(155)
    expect(stableMajor(anchor + 14 * day, 152)).toBe(156)
    expect(stableMajor(anchor + 14 * day - 1, 152)).toBe(155)
    expect(stableMajor(anchor + 70 * day, 152)).toBe(160)
  })

  it('never reports less than the anchor or the engine', () => {
    expect(stableMajor(Date.UTC(2026, 0, 1), 152)).toBe(155)
    expect(stableMajor(anchor, 158)).toBe(158)
  })

  it('reports a reduced user agent', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'
    expect(reportedUserAgent(ua, '155')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    )
  })

  it('keeps the engine build when the majors match', () => {
    expect(fullVersion('152', '152.0.7977.130')).toBe('152.0.7977.130')
    expect(fullVersion('155', '152.0.7977.130')).toBe('155.0.0.0')
    expect(fullVersion('15', '152.0.7977.130')).toBe('15.0.0.0')
  })

  it('rewrites the client hint headers and nothing else', () => {
    const headers = versionHeaders(
      {
        'sec-ch-ua': '"Not?A_Brand";v="24", "Chromium";v="152"',
        'Sec-CH-UA-Full-Version-List': '"Not?A_Brand";v="24.0.0.0", "Chromium";v="152.0.7977.130"',
        'sec-ch-ua-full-version': '"152.0.7977.130"',
        'sec-ch-ua-platform': '"Linux"',
        Accept: '*/*',
      },
      '155',
      '155.0.0.0',
    )
    expect(headers).toEqual({
      'sec-ch-ua': '"Not?A_Brand";v="24", "Chromium";v="155"',
      'Sec-CH-UA-Full-Version-List': '"Not?A_Brand";v="24.0.0.0", "Chromium";v="155.0.0.0"',
      'sec-ch-ua-full-version': '"155.0.0.0"',
      'sec-ch-ua-platform': '"Linux"',
      Accept: '*/*',
    })
  })
})
