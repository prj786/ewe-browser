import { app, type Session, type WebContents } from 'electron'

const STRIP_TOKENS = [
  /\s?ewe-browser\/[\d.]+/i,
  /\s?Electron\/[\d.]+/i,
  /\s?@ewe\/browser\/[\d.]+/i,
]

export function chromeMajor(): string {
  return process.versions.chrome.split('.')[0] ?? '0'
}

export function cleanUserAgent(ua: string, appName = app.getName()): string {
  let out = ua
  const own = new RegExp(`\\s?${appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[\\w.-]+`, 'i')
  for (const re of [...STRIP_TOKENS, own]) out = out.replace(re, '')
  return out.replace(/\s{2,}/g, ' ').trim()
}

export function chromeUserAgent(): string {
  return cleanUserAgent(app.userAgentFallback)
}

export function chromeBrands(major = chromeMajor()): string {
  return `"Not?A_Brand";v="24", "Chromium";v="${major}", "Google Chrome";v="${major}"`
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
  session.webRequest.onBeforeSendHeaders(
    { urls: ['https://chromewebstore.google.com/*'] },
    (details, callback) => {
      callback({ requestHeaders: storeHeaders(details.requestHeaders) })
    },
  )
}

export function applyIdentityToContents(contents: WebContents): void {
  contents.setUserAgent(chromeUserAgent())
}
