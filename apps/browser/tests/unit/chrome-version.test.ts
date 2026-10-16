import { describe, expect, it } from 'vitest'
import {
  chromeVersion,
  type Brand,
  type UaData,
  type VersionScope,
} from '../../src/preload/chrome-version'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

function engineData(): UaData {
  class NavigatorUAData {
    get brands(): Brand[] {
      return [
        { brand: 'Not?A_Brand', version: '24' },
        { brand: 'Chromium', version: '152' },
      ]
    }
    getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> {
      const values: Record<string, unknown> = {
        brands: this.brands,
        mobile: false,
        platform: 'Linux',
      }
      if (hints.includes('fullVersionList'))
        values.fullVersionList = [
          { brand: 'Not?A_Brand', version: '24.0.0.0' },
          { brand: 'Chromium', version: '152.0.7977.130' },
        ]
      if (hints.includes('uaFullVersion')) values.uaFullVersion = '152.0.7977.130'
      return Promise.resolve(values)
    }
    toJSON(): Record<string, unknown> {
      return { brands: this.brands, mobile: false, platform: 'Linux' }
    }
  }
  return new NavigatorUAData()
}

function scopeWith(userAgent: string): VersionScope {
  return { navigator: { userAgent, userAgentData: engineData() } }
}

describe('chromeVersion', () => {
  it('reports the user agent major in brands, toJSON and high entropy values', async () => {
    const scope = scopeWith(UA)
    chromeVersion(false, scope)
    const data = scope.navigator.userAgentData
    expect(data?.brands).toEqual([
      { brand: 'Not?A_Brand', version: '24' },
      { brand: 'Chromium', version: '155' },
    ])
    expect(data?.toJSON().brands).toEqual(data?.brands)
    const values = await data?.getHighEntropyValues(['fullVersionList', 'uaFullVersion'])
    expect(values?.fullVersionList).toEqual([
      { brand: 'Not?A_Brand', version: '24.0.0.0' },
      { brand: 'Chromium', version: '155.0.0.0' },
    ])
    expect(values?.uaFullVersion).toBe('155.0.0.0')
    expect(values?.platform).toBe('Linux')
  })

  it('keeps the engine build when the majors match', async () => {
    const scope = scopeWith(UA.replace('155.0.0.0', '152.0.0.0'))
    chromeVersion(false, scope)
    const values = await scope.navigator.userAgentData?.getHighEntropyValues(['uaFullVersion'])
    expect(values?.uaFullVersion).toBe('152.0.7977.130')
  })

  it('adds the Google Chrome brand on the Web Store', async () => {
    const scope = scopeWith(UA)
    chromeVersion(true, scope)
    const data = scope.navigator.userAgentData
    expect(data?.brands).toContainEqual({ brand: 'Google Chrome', version: '155' })
    const values = await data?.getHighEntropyValues(['fullVersionList'])
    expect(values?.fullVersionList).toContainEqual({
      brand: 'Google Chrome',
      version: '155.0.0.0',
    })
  })

  it('does nothing without userAgentData or a Chrome token', () => {
    expect(() => {
      chromeVersion(false, { navigator: { userAgent: UA } })
    }).not.toThrow()
    const scope = scopeWith('Mozilla/5.0')
    chromeVersion(false, scope)
    expect(scope.navigator.userAgentData?.brands[1]?.version).toBe('152')
  })
})
