const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const DAY = 86_400_000

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit] ?? 'B'}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min`
}

function startOfDay(time: number): number {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayLabel(time: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(time)) / DAY)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const date = new Date(time)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    weekday: diff < 7 ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  })
}

export function clockTime(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(time: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - time) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24 && startOfDay(time) === startOfDay(now)) return `${hours} h ago`
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY)
  if (days <= 1) return 'Yesterday'
  const date = new Date(time)
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  })
}
