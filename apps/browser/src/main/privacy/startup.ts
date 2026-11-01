import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PRIVACY_SETTINGS,
  sanitizePrivacySettings,
  type PrivacySettings,
} from '@ewe/shared'

export const THIRD_PARTY_COOKIE_FEATURE = 'ForceThirdPartyCookieBlockingEnabled'
export const NO_DNS_PREFETCH = 'dnsPrefetchingEnabled=false'

export function privacyAtStartup(userData: string): PrivacySettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
    const privacy =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).privacy : undefined
    return sanitizePrivacySettings(privacy, DEFAULT_PRIVACY_SETTINGS)
  } catch {
    return DEFAULT_PRIVACY_SETTINGS
  }
}

export function featureSwitch(current: string, feature: string): string {
  const list = current.split(',').filter((f) => f !== '' && f !== feature)
  return [...list, feature].join(',')
}

export function blinkSettingSwitch(current: string, setting: string): string {
  const name = setting.split('=')[0] ?? setting
  const list = current.split(',').filter((s) => s !== '' && s.split('=')[0] !== name)
  return [...list, setting].join(',')
}
