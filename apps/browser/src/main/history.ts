import type { HistorySuggestion } from '@ewe/shared'
import { hostOf } from '@ewe/shared'

export interface HistoryEntry {
  url: string
  title: string
  host: string
  count: number
  last: number
}

const DAY = 86_400_000

export function entryFor(url: string, title: string, now: number): HistoryEntry {
  return { url, title, host: hostOf(url), count: 1, last: now }
}

export function scoreEntry(entry: HistoryEntry, query: string, now: number): number {
  const q = query.toLowerCase()
  let match = 0
  const host = entry.host.toLowerCase()
  if (host.startsWith(q)) match = 4
  else if (host.includes(q)) match = 2
  if (entry.title.toLowerCase().includes(q)) match = Math.max(match, 1.5)
  if (match === 0 && entry.url.toLowerCase().includes(q)) match = 1
  if (match === 0) return 0
  const ageDays = Math.max(0, now - entry.last) / DAY
  const frecency = (1 + Math.log2(entry.count)) * Math.exp(-ageDays / 45)
  return match * frecency
}

export function rankSuggestions(
  entries: Iterable<HistoryEntry>,
  query: string,
  limit: number,
  now = Date.now(),
): HistorySuggestion[] {
  const q = query.trim()
  if (q === '') return []
  const scored: HistorySuggestion[] = []
  for (const entry of entries) {
    const score = scoreEntry(entry, q, now)
    if (score > 0) scored.push({ url: entry.url, title: entry.title, host: entry.host, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

export function completeHost(
  entries: Iterable<HistoryEntry>,
  typed: string,
  now = Date.now(),
): string | null {
  const t = typed.trim().toLowerCase()
  if (t === '' || /\s/.test(t) || t.includes(':')) return null
  let best: { host: string; score: number } | null = null
  for (const entry of entries) {
    const host = entry.host.toLowerCase()
    if (!host.startsWith(t) || host === t) continue
    const score = scoreEntry(entry, t, now)
    if (best === null || score > best.score) best = { host: entry.host, score }
  }
  return best?.host ?? null
}

export function recentEntries(
  entries: Iterable<HistoryEntry>,
  query: string,
  limit: number,
): HistoryEntry[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
  const out: HistoryEntry[] = []
  for (const entry of entries) {
    if (words.length > 0) {
      const text = `${entry.title} ${entry.url}`.toLowerCase()
      if (!words.every((w) => text.includes(w))) continue
    }
    out.push(entry)
  }
  return out.sort((a, b) => b.last - a.last).slice(0, limit)
}
