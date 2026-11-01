export type SecureDnsMode = 'off' | 'automatic' | 'secure'
export type DohProvider = 'cloudflare' | 'quad9' | 'mullvad' | 'adguard' | 'nextdns' | 'custom'

export interface PrivacySettings {
  secureDns: SecureDnsMode
  dnsProvider: DohProvider
  nextdnsId: string
  dnsTemplate: string
  httpsOnly: boolean
  blockThirdPartyCookies: boolean
  gpc: boolean
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  secureDns: 'off',
  dnsProvider: 'cloudflare',
  nextdnsId: '',
  dnsTemplate: '',
  httpsOnly: false,
  blockThirdPartyCookies: true,
  gpc: true,
}

export const DOH_PROVIDERS: Record<DohProvider, { name: string; template: string }> = {
  cloudflare: {
    name: 'Cloudflare (1.1.1.1)',
    template: 'https://chrome.cloudflare-dns.com/dns-query',
  },
  quad9: { name: 'Quad9', template: 'https://dns.quad9.net/dns-query' },
  mullvad: { name: 'Mullvad', template: 'https://dns.mullvad.net/dns-query' },
  adguard: { name: 'AdGuard', template: 'https://dns.adguard-dns.com/dns-query' },
  nextdns: { name: 'NextDNS', template: 'https://dns.nextdns.io/{id}' },
  custom: { name: 'Custom', template: '' },
}

const SECURE_DNS_MODES = new Set<string>(['off', 'automatic', 'secure'])
const NEXTDNS_ID = /^[a-z0-9]{1,32}$/i
const MAX_TEMPLATE = 512

export function isDohProvider(value: unknown): value is DohProvider {
  return typeof value === 'string' && Object.hasOwn(DOH_PROVIDERS, value)
}

export function isDohTemplate(value: string): boolean {
  if (value.length === 0 || value.length > MAX_TEMPLATE || /\s/.test(value)) return false
  const variables = value.match(/\{[^}]*\}/g) ?? []
  if (variables.some((v) => v !== '{?dns}')) return false
  if (variables.length > 1) return false
  let url: URL
  try {
    url = new URL(value.replace('{?dns}', ''))
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  )
}

export type DohConfig =
  { ok: true; mode: SecureDnsMode; servers: string[] } | { ok: false; error: string }

export function dohConfig(p: PrivacySettings): DohConfig {
  if (p.secureDns === 'off') return { ok: true, mode: 'off', servers: [] }
  if (p.secureDns === 'automatic') return { ok: true, mode: 'automatic', servers: [] }
  if (p.dnsProvider === 'nextdns') {
    const id = p.nextdnsId.trim()
    if (!NEXTDNS_ID.test(id)) return { ok: false, error: 'Enter your NextDNS configuration ID.' }
    return {
      ok: true,
      mode: 'secure',
      servers: [DOH_PROVIDERS.nextdns.template.replace('{id}', id)],
    }
  }
  if (p.dnsProvider === 'custom') {
    const template = p.dnsTemplate.trim()
    if (!isDohTemplate(template))
      return {
        ok: false,
        error: 'Enter an https:// DNS-over-HTTPS address, like https://dns.example/dns-query.',
      }
    return { ok: true, mode: 'secure', servers: [template] }
  }
  return { ok: true, mode: 'secure', servers: [DOH_PROVIDERS[p.dnsProvider].template] }
}

export function sanitizePrivacySettings(value: unknown, base: PrivacySettings): PrivacySettings {
  if (typeof value !== 'object' || value === null) return base
  const v = value as Record<string, unknown>
  const next: PrivacySettings = { ...base }
  if (typeof v.secureDns === 'string' && SECURE_DNS_MODES.has(v.secureDns))
    next.secureDns = v.secureDns as SecureDnsMode
  if (isDohProvider(v.dnsProvider)) next.dnsProvider = v.dnsProvider
  if (typeof v.nextdnsId === 'string') next.nextdnsId = v.nextdnsId.trim().slice(0, 32)
  if (typeof v.dnsTemplate === 'string')
    next.dnsTemplate = v.dnsTemplate.trim().slice(0, MAX_TEMPLATE)
  if (typeof v.httpsOnly === 'boolean') next.httpsOnly = v.httpsOnly
  if (typeof v.blockThirdPartyCookies === 'boolean')
    next.blockThirdPartyCookies = v.blockThirdPartyCookies
  if (typeof v.gpc === 'boolean') next.gpc = v.gpc
  return next
}

export const PERMISSION_KINDS = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard',
  'midi',
  'local-network',
  'windows',
  'idle',
] as const

export type PermissionKind = (typeof PERMISSION_KINDS)[number]
export type PermissionValue = 'ask' | 'allow' | 'block'
export type PermissionDecision = 'allow' | 'block' | 'dismiss'
export type SitePermissions = Partial<Record<PermissionKind, 'allow' | 'block'>>

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  location: 'Location',
  notifications: 'Notifications',
  clipboard: 'Clipboard',
  midi: 'MIDI devices',
  'local-network': 'Local network',
  windows: 'Window placement',
  idle: 'Idle detection',
}

export const PERMISSION_ASKS: Record<PermissionKind, string> = {
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  location: 'Know your location',
  notifications: 'Show notifications',
  clipboard: 'See text and images you copy',
  midi: 'Use your MIDI devices',
  'local-network': 'Find and connect to devices on your network',
  windows: 'Manage windows on all your displays',
  idle: 'Know when you are away from the computer',
}

export const PERMISSION_NOTES: Partial<Record<PermissionKind, string>> = {
  location:
    'ewe Browser has no location service on Linux, so a site gets no position even when you allow it.',
}

export const PERMISSION_HINTS: Partial<Record<PermissionKind, string>> = {
  location: 'No location service on Linux',
}

export const SITE_INFO_KINDS: readonly PermissionKind[] = [
  'camera',
  'microphone',
  'location',
  'notifications',
]

export interface PermissionSite {
  origin: string
  permissions: SitePermissions
  updated: number
}

export interface PermissionPrompt {
  promptId: string
  origin: string
  host: string
  kinds: PermissionKind[]
}

export interface SiteInfo {
  origin: string
  host: string
  kind: 'https' | 'http' | 'file' | 'internal' | 'other'
  permissions: { kind: PermissionKind; value: PermissionValue }[]
  httpAllowed: boolean
}

export interface PrivacyStatus {
  thirdPartyBlocked: boolean
  dnsError: string | null
}

export type PermissionsRequest = { op: 'list' } | { op: 'status' }

export function isPermissionsRequest(value: unknown): value is PermissionsRequest {
  if (typeof value !== 'object' || value === null) return false
  const op = (value as Record<string, unknown>).op
  return op === 'list' || op === 'status'
}

export function isPermissionKind(value: unknown): value is PermissionKind {
  return typeof value === 'string' && (PERMISSION_KINDS as readonly string[]).includes(value)
}

export function isPermissionValue(value: unknown): value is PermissionValue {
  return value === 'ask' || value === 'allow' || value === 'block'
}

export function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === 'allow' || value === 'block' || value === 'dismiss'
}

export function webOrigin(input: string): string | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname === '') return null
  return url.origin
}

export function isWebOrigin(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 300 && webOrigin(value) === value
}

export function originHost(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}
