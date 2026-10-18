const LOCAL_SUFFIXES = ['.localhost', '.local', '.home.arpa', '.internal', '.lan', '.test']

function ipv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const out = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN))
  return out.every((n) => n >= 0 && n <= 255) ? out : null
}

export function isLocalHost(raw: string): boolean {
  const host = raw.toLowerCase().replace(/\.$/, '')
  if (host === '' || host === 'localhost') return true
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return true
  if (host.startsWith('[') || host.includes(':')) {
    const v6 = host.replace(/^\[|\]$/g, '')
    return (
      v6 === '::1' ||
      v6 === '::' ||
      /^f[cd][0-9a-f]{2}:/.test(v6) ||
      /^fe[89ab][0-9a-f]:/.test(v6) ||
      v6.startsWith('::ffff:')
    )
  }
  const v4 = ipv4(host)
  if (v4 !== null) {
    const [a = 0, b = 0] = v4
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  return !host.includes('.')
}

export function httpsUpgrade(raw: string, allowed: ReadonlySet<string>): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null
  if (url.port !== '' && url.port !== '80') return null
  const host = url.hostname.toLowerCase()
  if (isLocalHost(host) || allowed.has(host)) return null
  url.protocol = 'https:'
  url.port = ''
  return url.href
}

export interface Upgrade {
  from: string
  to: string
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

export class HttpsOnlyState {
  private readonly allowed = new Set<string>()
  private readonly upgrades = new Map<number, Upgrade>()

  constructor(private readonly enabled: () => boolean) {}

  upgrade(contentsId: number | undefined, url: string, mainFrame: boolean): string | null {
    if (!this.enabled()) return null
    const target = httpsUpgrade(url, this.allowed)
    if (target === null) return null
    if (mainFrame && contentsId !== undefined)
      this.upgrades.set(contentsId, { from: url, to: target })
    return target
  }

  failed(contentsId: number, url: string): string | null {
    const upgrade = this.upgrades.get(contentsId)
    if (upgrade === undefined || !sameHost(upgrade.to, url)) return null
    this.upgrades.delete(contentsId)
    return upgrade.from
  }

  forget(contentsId: number): void {
    this.upgrades.delete(contentsId)
  }

  allow(url: string): string | null {
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:') return null
      this.allowed.add(u.hostname.toLowerCase())
      return u.hostname.toLowerCase()
    } catch {
      return null
    }
  }

  isAllowed(host: string): boolean {
    return this.allowed.has(host.toLowerCase())
  }
}
