import type { WorkspaceColor } from './models'
import { isWorkspaceColor } from './workspaces'

export const HISTORY_URL = 'app://history/'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export type HistoryRange = 'hour' | 'day' | 'week' | 'month' | 'all'

export const HISTORY_RANGES: readonly HistoryRange[] = ['hour', 'day', 'week', 'month', 'all']

export const HISTORY_RANGE_LABELS: Record<HistoryRange, string> = {
  hour: 'Last hour',
  day: 'Last 24 hours',
  week: 'Last 7 days',
  month: 'Last 4 weeks',
  all: 'All time',
}

export function rangeStart(range: HistoryRange, now: number): number {
  switch (range) {
    case 'hour':
      return now - HOUR
    case 'day':
      return now - DAY
    case 'week':
      return now - 7 * DAY
    case 'month':
      return now - 28 * DAY
    case 'all':
      return 0
  }
}

export const HISTORY_KEEP_DAYS = [0, 365, 90, 30] as const
export type HistoryKeepDays = (typeof HISTORY_KEEP_DAYS)[number]

export const HISTORY_KEEP_LABELS: Record<HistoryKeepDays, string> = {
  0: 'Forever',
  365: '1 year',
  90: '90 days',
  30: '30 days',
}

export function isHistoryKeepDays(value: unknown): value is HistoryKeepDays {
  return (HISTORY_KEEP_DAYS as readonly unknown[]).includes(value)
}

export function keepCutoff(days: number, now: number): number {
  return days > 0 ? now - days * DAY : 0
}

export function siteOf(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

export function hostInSite(host: string, site: string): boolean {
  const h = host.toLowerCase()
  return h === site || h.endsWith(`.${site}`)
}

export interface HistoryClear {
  id: string
  at: number
  from: number
  to: number
  url?: string | undefined
  site?: string | undefined
}

const MAX_TEXT = 4096
const LABEL = '[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?'
const SITE_RE = new RegExp(`^(?:${LABEL}(?:\\.${LABEL})*|\\[[0-9a-f:.]{2,45}\\])(?::\\d{1,5})?$`)

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isSite(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 260 && SITE_RE.test(value)
}

export function isHistoryClear(value: unknown): value is HistoryClear {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    c.id.length > 0 &&
    c.id.length <= 64 &&
    isTime(c.at) &&
    isTime(c.from) &&
    isTime(c.to) &&
    c.from <= c.to &&
    (c.url === undefined || (typeof c.url === 'string' && c.url.length <= MAX_TEXT)) &&
    (c.site === undefined || isSite(c.site))
  )
}

export function clearCovers(clear: HistoryClear, url: string, host: string, time: number): boolean {
  if (time < clear.from || time > clear.to) return false
  if (clear.url !== undefined && clear.url !== url) return false
  if (clear.site !== undefined && !hostInSite(host, clear.site)) return false
  return true
}

export interface HistoryDayRow {
  url: string
  title: string
  host: string
  day: number
  last: number
  visits: number
}

export interface HistoryCursor {
  time: number
  id: number
}

export interface HistoryRows {
  rows: HistoryDayRow[]
  next: HistoryCursor | null
}

export interface RemoteTab {
  url: string
  title: string
  pinned: boolean
}

export interface RemoteWorkspace {
  name: string
  color: WorkspaceColor | null
  tabs: RemoteTab[]
}

export interface RemoteWindow {
  workspaces: RemoteWorkspace[]
}

export interface RemoteMachine {
  id?: string | undefined
  machine: string
  savedAt: number
  windows: RemoteWindow[]
}

export interface RemoteTabsFile {
  version: 1
  id?: string | undefined
  machine: string
  savedAt: number
  windows: RemoteWindow[]
}

export function isMachineId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)
}

const MAX_REMOTE_TABS = 500

function isRemoteTab(value: unknown): value is RemoteTab {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    typeof t.url === 'string' &&
    /^https?:\/\//i.test(t.url) &&
    t.url.length <= MAX_TEXT &&
    typeof t.title === 'string' &&
    typeof t.pinned === 'boolean'
  )
}

function isRemoteWorkspace(value: unknown): value is RemoteWorkspace {
  if (typeof value !== 'object' || value === null) return false
  const w = value as Record<string, unknown>
  return (
    typeof w.name === 'string' &&
    (w.color === null || isWorkspaceColor(w.color)) &&
    Array.isArray(w.tabs) &&
    w.tabs.every(isRemoteTab)
  )
}

function isRemoteWindow(value: unknown): value is RemoteWindow {
  if (typeof value !== 'object' || value === null) return false
  const w = value as Record<string, unknown>
  return Array.isArray(w.workspaces) && w.workspaces.every(isRemoteWorkspace)
}

export function isRemoteTabsFile(value: unknown): value is RemoteTabsFile {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Record<string, unknown>
  return (
    f.version === 1 &&
    typeof f.machine === 'string' &&
    f.machine.length > 0 &&
    f.machine.length <= 255 &&
    (f.id === undefined || isMachineId(f.id)) &&
    isTime(f.savedAt) &&
    Array.isArray(f.windows) &&
    f.windows.every(isRemoteWindow) &&
    remoteTabCount(f.windows) <= MAX_REMOTE_TABS
  )
}

export function remoteTabCount(windows: RemoteWindow[]): number {
  let n = 0
  for (const w of windows) for (const ws of w.workspaces) n += ws.tabs.length
  return n
}

export interface RemoteTabHit {
  machine: string
  workspace: string
  url: string
  title: string
}

export function searchRemoteTabs(
  machines: RemoteMachine[],
  query: string,
  limit: number,
): RemoteTabHit[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
  const out: RemoteTabHit[] = []
  const seen = new Set<string>()
  for (const m of machines) {
    for (const w of m.windows) {
      for (const ws of w.workspaces) {
        for (const tab of ws.tabs) {
          const text = `${tab.title} ${tab.url}`.toLowerCase()
          if (!words.every((word) => text.includes(word))) continue
          const key = `${m.machine}\n${tab.url}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ machine: m.machine, workspace: ws.name, url: tab.url, title: tab.title })
          if (out.length >= limit) return out
        }
      }
    }
  }
  return out
}

export interface HistorySummary {
  pages: number
  keepDays: HistoryKeepDays
  sync: boolean
  lastSync: number | null
  warning: string | null
  machines: RemoteMachine[]
}

export interface HistoryDeleteItem {
  url: string
  from: number
  to: number
}

export interface ClearDataResult {
  history: number
  downloads: number
  cookies: boolean
  cache: boolean
}

export type HistoryRequest =
  | {
      op: 'rows'
      query: string
      site?: string | undefined
      before?: HistoryCursor | undefined
      limit?: number | undefined
    }
  | { op: 'summary' }
  | { op: 'delete'; items: HistoryDeleteItem[] }
  | { op: 'deleteSite'; site: string; siteData: boolean }
  | { op: 'siteCount'; site: string }
  | {
      op: 'clear'
      range: HistoryRange
      history: boolean
      cookies: boolean
      cache: boolean
      downloads: boolean
    }
  | { op: 'keep'; days: HistoryKeepDays }

export const HISTORY_PAGE_LIMIT = 200
const MAX_DELETE_ITEMS = 5000

function isCursor(value: unknown): value is HistoryCursor {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return isTime(c.time) && typeof c.id === 'number' && Number.isInteger(c.id)
}

function isDeleteItem(value: unknown): value is HistoryDeleteItem {
  if (typeof value !== 'object' || value === null) return false
  const i = value as Record<string, unknown>
  return (
    typeof i.url === 'string' &&
    i.url.length <= MAX_TEXT &&
    /^https?:\/\//i.test(i.url) &&
    isTime(i.from) &&
    isTime(i.to) &&
    i.from <= i.to
  )
}

export function isHistoryRequest(value: unknown): value is HistoryRequest {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  switch (r.op) {
    case 'rows':
      return (
        typeof r.query === 'string' &&
        r.query.length <= 500 &&
        (r.site === undefined || isSite(r.site)) &&
        (r.before === undefined || isCursor(r.before)) &&
        (r.limit === undefined ||
          (typeof r.limit === 'number' &&
            Number.isInteger(r.limit) &&
            r.limit > 0 &&
            r.limit <= HISTORY_PAGE_LIMIT))
      )
    case 'summary':
      return true
    case 'delete':
      return (
        Array.isArray(r.items) && r.items.length <= MAX_DELETE_ITEMS && r.items.every(isDeleteItem)
      )
    case 'deleteSite':
      return isSite(r.site) && typeof r.siteData === 'boolean'
    case 'siteCount':
      return isSite(r.site)
    case 'clear':
      return (
        typeof r.range === 'string' &&
        (HISTORY_RANGES as readonly string[]).includes(r.range) &&
        typeof r.history === 'boolean' &&
        typeof r.cookies === 'boolean' &&
        typeof r.cache === 'boolean' &&
        typeof r.downloads === 'boolean'
      )
    case 'keep':
      return isHistoryKeepDays(r.days)
    default:
      return false
  }
}

export function parseHistoryQuery(input: string): { query: string; site: string | undefined } {
  let site: string | undefined
  const words: string[] = []
  for (const word of input.trim().split(/\s+/)) {
    const match = /^site:(.+)$/i.exec(word)
    const candidate = match?.[1] === undefined ? '' : siteOf(match[1])
    if (candidate !== '' && isSite(candidate)) site = candidate
    else if (word !== '') words.push(word)
  }
  return { query: words.join(' '), site }
}

export function localDay(time: number): number {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function nextLocalDay(day: number): number {
  const d = new Date(day)
  d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
