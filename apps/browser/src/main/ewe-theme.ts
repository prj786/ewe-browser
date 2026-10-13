import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ThemeTokens, ThemeVariant } from '@ewe/shared'

interface Shadow {
  x: number
  y: number
  blur: number
  color: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function eweTokensPath(): string {
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(config, 'quickshell', 'theme-tokens.json')
}

export function cssColor(value: string): string {
  const hex = value.trim()
  if (/^#[0-9a-f]{8}$/i.test(hex)) {
    const a = parseInt(hex.slice(1, 3), 16) / 255
    const r = parseInt(hex.slice(3, 5), 16)
    const g = parseInt(hex.slice(5, 7), 16)
    const b = parseInt(hex.slice(7, 9), 16)
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`
  }
  return hex
}

function cssShadow(value: unknown): string | null {
  if (!isObject(value)) return null
  const { x, y, blur, color } = value as Partial<Shadow>
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof blur !== 'number' ||
    typeof color !== 'string'
  )
    return null
  return `${x}px ${y}px ${blur}px ${cssColor(color)}`
}

const EASINGS: Record<string, string> = {
  Linear: 'linear',
  OutCubic: 'cubic-bezier(0.33, 1, 0.68, 1)',
  InOutCubic: 'cubic-bezier(0.65, 0, 0.35, 1)',
  OutQuad: 'cubic-bezier(0.5, 1, 0.89, 1)',
  InOutQuad: 'cubic-bezier(0.45, 0, 0.55, 1)',
  OutQuart: 'cubic-bezier(0.25, 1, 0.5, 1)',
  OutQuint: 'cubic-bezier(0.22, 1, 0.36, 1)',
  OutExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  OutBack: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
}

const TOKEN_KEY = /^[a-z0-9-]+$/
const FONT_CSS = /^[\w\s"',.-]+$/

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

function baseVars(parsed: Record<string, unknown>): Record<string, string> {
  const base: Record<string, string> = {}
  const access = isObject(parsed.accessibility) ? parsed.accessibility : {}
  const scale = (num(access.text_scale) ?? 100) / 100
  const textScale = scale >= 0.5 && scale <= 3 ? scale : 1
  if (isObject(parsed.shape)) {
    for (const [key, value] of Object.entries(parsed.shape)) {
      const n = num(value)
      if (n !== null && n >= 0 && TOKEN_KEY.test(key)) base[`--${key}`] = px(n)
    }
  }
  if (isObject(parsed.size)) {
    for (const [key, value] of Object.entries(parsed.size)) {
      const n = num(value)
      if (n === null || n < 0 || !TOKEN_KEY.test(key)) continue
      const text = key.startsWith('font-size-') || key.startsWith('line-height-')
      base[`--${key}`] = px(text ? n * textScale : n)
    }
  }
  if (isObject(parsed.type)) {
    const css = isObject(parsed.type.css) ? parsed.type.css : {}
    if (typeof css.sans === 'string' && FONT_CSS.test(css.sans)) base['--font-sans'] = css.sans
    if (typeof css.mono === 'string' && FONT_CSS.test(css.mono)) base['--font-mono'] = css.mono
    if (isObject(parsed.type.weight)) {
      for (const [key, value] of Object.entries(parsed.type.weight)) {
        const n = num(value)
        if (n !== null && TOKEN_KEY.test(key)) base[`--${key}`] = String(n)
      }
    }
  }
  if (isObject(parsed.motion)) {
    const motion = parsed.motion
    const speed = num(motion.speed) ?? 1
    const reduce = motion.reduceMotion === true || access.reduce_motion === true
    const dur = (value: unknown): string | null => {
      const n = num(value)
      if (n === null || n < 0) return null
      return reduce ? '1ms' : `${Math.round(n / (speed > 0 ? speed : 1))}ms`
    }
    const fast = dur(motion.durFast)
    const baseDur = dur(motion.durBase)
    const slow = dur(motion.durSlow)
    if (fast !== null) base['--dur-fast'] = fast
    if (baseDur !== null) base['--dur-base'] = baseDur
    if (slow !== null) base['--dur-slow'] = slow
    const easing = isObject(motion.easing) ? motion.easing : {}
    const out = typeof easing.base === 'string' ? EASINGS[easing.base] : undefined
    const inOut = typeof easing.slow === 'string' ? EASINGS[easing.slow] : undefined
    if (out !== undefined) base['--ease-out'] = out
    if (inOut !== undefined) base['--ease-in-out'] = inOut
  }
  return base
}

export function parseEweTokens(text: string): ThemeTokens | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(parsed) || parsed.version !== 3 || !isObject(parsed.color)) return null
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed.color)) {
    if (typeof value === 'string' && TOKEN_KEY.test(key)) vars[`--${key}`] = cssColor(value)
  }
  if (isObject(parsed.shadow)) {
    for (const [key, value] of Object.entries(parsed.shadow)) {
      const shadow = cssShadow(value)
      if (shadow !== null && TOKEN_KEY.test(key)) vars[`--${key}`] = shadow
    }
  }
  const scheme = isObject(parsed.scheme) ? parsed.scheme : {}
  const input = isObject(parsed.input) ? parsed.input : {}
  const variantRaw = scheme.variant ?? input.variant
  const variant: ThemeVariant = variantRaw === 'light' ? 'light' : 'dark'
  const name = typeof scheme.name === 'string' ? scheme.name : 'Ewe'
  return { source: 'ewe', variant, name, vars, base: baseVars(parsed) }
}

export function readEweTheme(path = eweTokensPath()): ThemeTokens | null {
  if (!existsSync(path)) return null
  try {
    return parseEweTokens(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function watchEweTheme(
  onChange: (theme: ThemeTokens | null) => void,
  path = eweTokensPath(),
): () => void {
  const dir = join(path, '..')
  if (!existsSync(dir)) return () => undefined
  let timer: NodeJS.Timeout | null = null
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dir, (_event, file) => {
      if (file !== null && file !== 'theme-tokens.json') return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => onChange(readEweTheme(path)), 200)
    })
  } catch {
    return () => undefined
  }
  return () => {
    if (timer !== null) clearTimeout(timer)
    watcher?.close()
  }
}
