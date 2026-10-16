export interface Brand {
  brand: string
  version: string
}

export interface UaData {
  readonly brands: Brand[]
  getHighEntropyValues: (this: UaData, hints: string[]) => Promise<Record<string, unknown>>
  toJSON: (this: UaData) => Record<string, unknown>
}

export interface VersionScope {
  navigator: { userAgent: string; userAgentData?: UaData | undefined }
}

export function chromeVersion(store: boolean, scope: VersionScope = globalThis): void {
  const data = scope.navigator.userAgentData
  const major = /Chrome\/(\d+)/.exec(scope.navigator.userAgent)?.[1]
  if (data === undefined || major === undefined) return
  const versioned = (list: Brand[], version: string): Brand[] => {
    const out = list.map((entry) =>
      entry.brand === 'Chromium' || entry.brand === 'Google Chrome'
        ? { brand: entry.brand, version }
        : entry,
    )
    return store && !out.some((entry) => entry.brand === 'Google Chrome')
      ? [...out, { brand: 'Google Chrome', version }]
      : out
  }
  const brands = versioned(data.brands, major)
  const proto = Object.getPrototypeOf(data) as UaData
  const highEntropy = proto.getHighEntropyValues
  const toJSON = proto.toJSON
  Object.defineProperty(proto, 'brands', { get: () => brands, configurable: true })
  proto.getHighEntropyValues = function (hints) {
    return highEntropy.call(this, hints).then((values) => {
      const list = Array.isArray(values.fullVersionList)
        ? (values.fullVersionList as Brand[])
        : undefined
      const engine =
        list?.find((entry) => entry.brand === 'Chromium')?.version ??
        (typeof values.uaFullVersion === 'string' ? values.uaFullVersion : '')
      const full = engine.startsWith(`${major}.`) ? engine : `${major}.0.0.0`
      const out: Record<string, unknown> = { ...values, brands }
      if (list !== undefined) out.fullVersionList = versioned(list, full)
      if (typeof values.uaFullVersion === 'string') out.uaFullVersion = full
      return out
    })
  }
  proto.toJSON = function () {
    return { ...toJSON.call(this), brands }
  }
}
