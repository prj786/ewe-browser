import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Rect } from '@ewe/shared'

export interface ActionDetails {
  title?: string
  text?: string
  color?: string | number[]
  popup?: string
  iconModified?: number
}

export const POPUP_MIN = { width: 25, height: 25 }
export const POPUP_MAX = { width: 800, height: 600 }
const POPUP_GAP = 6

export const MEASURE_POPUP = `(() => {
  const root = document.documentElement
  const width = root.style.width
  const height = root.style.height
  root.style.width = 'max-content'
  root.style.height = 'max-content'
  const rect = root.getBoundingClientRect()
  root.style.width = width
  root.style.height = height
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
})()`

export function popupBounds(
  anchor: Rect,
  size: { width: number; height: number },
  window: { width: number; height: number },
): Rect {
  const width = Math.min(Math.max(Math.round(size.width), POPUP_MIN.width), POPUP_MAX.width)
  const height = Math.min(Math.max(Math.round(size.height), POPUP_MIN.height), POPUP_MAX.height)
  const margin = 8
  let x = anchor.x
  let y = anchor.y + anchor.height + POPUP_GAP
  if (y + height > window.height - margin) y = Math.max(margin, anchor.y - height - POPUP_GAP)
  if (y + height > window.height - margin) y = Math.max(margin, window.height - margin - height)
  x = Math.max(margin, Math.min(x, window.width - margin - width))
  return { x: Math.round(x), y: Math.round(y), width, height }
}

export function badgeColor(color: ActionDetails['color']): string | null {
  if (typeof color === 'string') return color
  if (Array.isArray(color) && color.length >= 3) {
    const [r, g, b, a = 255] = color
    return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`
  }
  return null
}

export async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function localizedName(
  dir: string,
  manifest: Record<string, unknown>,
): Promise<string> {
  const name = typeof manifest.name === 'string' ? manifest.name : ''
  const key = /^__MSG_(\w+)__$/.exec(name)?.[1]
  if (key === undefined) return name
  const locale = typeof manifest.default_locale === 'string' ? manifest.default_locale : 'en'
  for (const candidate of ['en', 'en_US', locale]) {
    const messages = await readJson(join(dir, '_locales', candidate, 'messages.json'))
    const entry = Object.entries(messages ?? {}).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    )
    const message = (entry?.[1] as { message?: unknown } | undefined)?.message
    if (typeof message === 'string') return message
  }
  return name
}
