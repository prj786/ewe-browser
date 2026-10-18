import { readFileSync, readlinkSync } from 'node:fs'
import type { SiteLocale } from '@ewe/shared'

export const ZONE_TABLES = ['/usr/share/zoneinfo/zone1970.tab', '/usr/share/zoneinfo/zone.tab']

export function parseZoneTable(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue
    const [codes, , zone] = line.split('\t')
    const first = codes?.split(',')[0]?.trim().toLowerCase()
    if (zone !== undefined && first !== undefined && /^[a-z]{2}$/.test(first))
      out.set(zone.trim(), first)
  }
  return out
}

export function countryOfZone(zone: string, tables: readonly string[]): string | null {
  for (const text of tables) {
    const cc = parseZoneTable(text).get(zone)
    if (cc !== undefined) return cc
  }
  return null
}

export function localeOfEnv(env: NodeJS.ProcessEnv): {
  lang: string | null
  territory: string | null
} {
  const value = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((v) => v !== undefined && v !== '')
  const match = /^([a-z]{2,3})(?:_([a-z]{2}))?(?=$|[.@])/i.exec(value ?? '')
  if (match === null) return { lang: null, territory: null }
  return { lang: (match[1] ?? '').toLowerCase(), territory: match[2]?.toLowerCase() ?? null }
}

export function systemTimeZone(env: NodeJS.ProcessEnv = process.env): string | null {
  const tz = env.TZ?.replace(/^:/, '')
  if (tz !== undefined && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(tz)) return tz
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone !== '' && zone !== 'UTC' && zone.includes('/')) return zone
  } catch {
    void 0
  }
  try {
    const link = readlinkSync('/etc/localtime')
    const at = link.indexOf('zoneinfo/')
    return at < 0 ? null : link.slice(at + 'zoneinfo/'.length)
  } catch {
    return null
  }
}

export interface LocaleInput {
  env: NodeJS.ProcessEnv
  zone: string | null
  tables: readonly string[]
}

export function siteLocaleOf(input: LocaleInput): SiteLocale {
  const fromEnv = localeOfEnv(input.env)
  const cc =
    (input.zone === null ? null : countryOfZone(input.zone, input.tables)) ??
    fromEnv.territory ??
    'us'
  return { cc, lang: fromEnv.lang ?? 'en' }
}

let cached: SiteLocale | null = null

export function systemSiteLocale(): SiteLocale {
  if (cached !== null) return cached
  const tables = ZONE_TABLES.map((path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  })
  cached = siteLocaleOf({ env: process.env, zone: systemTimeZone(), tables })
  return cached
}
