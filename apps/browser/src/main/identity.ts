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

export function applyIdentity(session: Session): void {
  const ua = chromeUserAgent()
  app.userAgentFallback = ua
  session.setUserAgent(ua)
}

export function applyIdentityToContents(contents: WebContents): void {
  contents.setUserAgent(chromeUserAgent())
}
