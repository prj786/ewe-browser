import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  isHistoryKeepDays,
  sanitizeGestureSettings,
  sanitizeSafeSettings,
  sanitizePrivacySettings,
  sanitizeShortcuts,
  type Settings,
  type WebPanel,
} from '@ewe/shared'
import { debounce, readJson, writeJsonAtomic } from './json-file'

const RAIL = new Set(['expanded', 'collapsed'])
const ENGINES = new Set(['google', 'duckduckgo', 'bing', 'kagi', 'brave'])
const THEMES = new Set(['system', 'light', 'dark'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function sanitizePanels(value: unknown[]): WebPanel[] {
  const seen = new Set<string>()
  const out: WebPanel[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const { id, url, title } = item
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id) || seen.has(id)) continue
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 2048) continue
    seen.add(id)
    out.push({ id, url, title: typeof title === 'string' ? title.slice(0, 80) : id })
    if (out.length >= 12) break
  }
  return out
}

export function sanitizeSettings(patch: unknown, base: Settings): Settings {
  if (!isObject(patch)) return base
  const next = { ...base }
  if (typeof patch.rail === 'string' && RAIL.has(patch.rail))
    next.rail = patch.rail as Settings['rail']
  if (typeof patch.searchEngine === 'string' && ENGINES.has(patch.searchEngine))
    next.searchEngine = patch.searchEngine as Settings['searchEngine']
  if (typeof patch.theme === 'string' && THEMES.has(patch.theme))
    next.theme = patch.theme as Settings['theme']
  if (typeof patch.restoreSession === 'boolean') next.restoreSession = patch.restoreSession
  if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth))
    next.sidebarWidth = Math.round(Math.min(Math.max(patch.sidebarWidth, SIDEBAR_MIN), SIDEBAR_MAX))
  if (patch.shortcuts !== undefined) next.shortcuts = sanitizeShortcuts(patch.shortcuts)
  if (typeof patch.background === 'boolean') next.background = patch.background
  if (typeof patch.sync === 'boolean') next.sync = patch.sync
  if (isHistoryKeepDays(patch.historyDays)) next.historyDays = patch.historyDays
  if (Array.isArray(patch.panels)) next.panels = sanitizePanels(patch.panels)
  if (patch.safe !== undefined) next.safe = sanitizeSafeSettings(patch.safe, base.safe)
  if (patch.gestures !== undefined)
    next.gestures = sanitizeGestureSettings(patch.gestures, base.gestures)
  if (patch.privacy !== undefined)
    next.privacy = sanitizePrivacySettings(patch.privacy, base.privacy)
  return next
}

export class SettingsStore extends EventEmitter<{ change: [Settings] }> {
  private readonly path: string
  private current: Settings = DEFAULT_SETTINGS
  private readonly write = debounce((s: Settings) => {
    void writeJsonAtomic(this.path, s)
  }, 300)

  constructor(userData: string) {
    super()
    this.path = join(userData, 'settings.json')
  }

  get(): Settings {
    return this.current
  }

  async load(): Promise<Settings> {
    const stored = await readJson(this.path, isObject)
    this.current = sanitizeSettings(stored, DEFAULT_SETTINGS)
    return this.current
  }

  async flush(): Promise<void> {
    this.write.flush()
    await writeJsonAtomic(this.path, this.current)
  }

  update(patch: unknown): Settings {
    const next = sanitizeSettings(patch, this.current)
    if (JSON.stringify(next) === JSON.stringify(this.current)) return this.current
    this.current = next
    this.write(next)
    this.emit('change', next)
    return next
  }
}
