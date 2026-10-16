import { app, type Session, type WebContents } from 'electron'

const STRIP_TOKENS = [
  /\s?ewe-browser\/[\d.]+/i,
  /\s?Electron\/[\d.]+/i,
  /\s?@ewe\/browser\/[\d.]+/i,
]

const STABLE_MAJOR = 155
const STABLE_SINCE = Date.UTC(2026, 9, 6)
const STABLE_CADENCE_MS = 14 * 24 * 60 * 60 * 1000
const STORE_URL = 'https://chromewebstore.google.com/'

let reported: string | undefined

export function stableMajor(now: number, engine: number): number {
  const releases = Math.max(0, Math.floor((now - STABLE_SINCE) / STABLE_CADENCE_MS))
  return Math.max(engine, STABLE_MAJOR + releases)
}

export function chromeMajor(): string {
  reported ??= String(stableMajor(Date.now(), Number.parseInt(process.versions.chrome, 10)))
  return reported
}

export function fullVersion(major: string, engine: string): string {
  return engine.startsWith(`${major}.`) ? engine : `${major}.0.0.0`
}

export function cleanUserAgent(ua: string, appName = app.getName()): string {
  let out = ua
  const own = new RegExp(`\\s?${appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[\\w.-]+`, 'i')
  for (const re of [...STRIP_TOKENS, own]) out = out.replace(re, '')
  return out.replace(/\s{2,}/g, ' ').trim()
}

export function reportedUserAgent(ua: string, major: string): string {
  return ua.replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`)
}

export function chromeUserAgent(): string {
  return reportedUserAgent(cleanUserAgent(app.userAgentFallback), chromeMajor())
}

export function chromeBrands(major = chromeMajor()): string {
  return `"Not?A_Brand";v="24", "Chromium";v="${major}", "Google Chrome";v="${major}"`
}

export function withBrandVersion(value: string, version: string): string {
  return value.replace(/"(Chromium|Google Chrome)";v="[^"]*"/g, `"$1";v="${version}"`)
}

export function versionHeaders(
  headers: Record<string, string>,
  major = chromeMajor(),
  full = fullVersion(major, process.versions.chrome),
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'sec-ch-ua') out[key] = withBrandVersion(value, major)
    else if (lower === 'sec-ch-ua-full-version-list') out[key] = withBrandVersion(value, full)
    else if (lower === 'sec-ch-ua-full-version') out[key] = `"${full}"`
    else out[key] = value
  }
  return out
}

export function storeHeaders(
  headers: Record<string, string>,
  major = chromeMajor(),
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'sec-ch-ua' || lower === 'sec-ch-ua-full-version-list') continue
    out[key] = value
  }
  out['sec-ch-ua'] = chromeBrands(major)
  out['sec-ch-ua-mobile'] = '?0'
  out['sec-ch-ua-platform'] = '"Linux"'
  return out
}

export function withChromeBrand(value: string): string {
  if (value.includes('"Google Chrome"')) return value
  const major = /"Chromium";v="([^"]+)"/.exec(value)?.[1]
  return major === undefined ? value : `${value}, "Google Chrome";v="${major}"`
}

export function applyIdentity(session: Session): void {
  const ua = chromeUserAgent()
  app.userAgentFallback = ua
  session.setUserAgent(ua)
  session.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    callback({
      requestHeaders: details.url.startsWith(STORE_URL)
        ? storeHeaders(details.requestHeaders)
        : versionHeaders(details.requestHeaders),
    })
  })
}

export function applyIdentityToContents(contents: WebContents): void {
  contents.setUserAgent(chromeUserAgent())
}
