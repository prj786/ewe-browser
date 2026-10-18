import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PRIVACY_SETTINGS,
  sanitizePrivacySettings,
  type PrivacySettings,
} from '@ewe/shared'

export const THIRD_PARTY_COOKIE_FEATURE = 'ForceThirdPartyCookieBlockingEnabled'

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
