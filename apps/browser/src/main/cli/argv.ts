import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toolNamed, type PropSchema } from './tools'

export type Parsed =
  | { ok: true; tool: string; args: Record<string, unknown>; pretty: boolean }
  | { ok: false; error: 'usage' | 'unknown-verb'; message: string; pretty: boolean }

type Positional = { key: string; mode: 'join' | 'list' | 'one' } | null

const POSITIONAL: Record<string, Positional> = {
  help: { key: 'verb', mode: 'one' },
  commands: null,
  version: null,
  status: null,
  tabs: null,
  history: { key: 'query', mode: 'join' },
  bookmarks: { key: 'query', mode: 'join' },
  downloads: null,
  recent: null,
  find: { key: 'query', mode: 'join' },
  music: { key: 'query', mode: 'join' },
  places: null,
  ls: { key: 'path', mode: 'one' },
  locate: { key: 'query', mode: 'join' },
  page: null,
  open: { key: 'targets', mode: 'list' },
  search: { key: 'query', mode: 'join' },
  play: { key: 'query', mode: 'join' },
  reveal: { key: 'path', mode: 'one' },
  home: null,
  focus: null,
}

const GROUPS: Record<string, { actions: string[]; positional: Positional }> = {
  tab: {
    actions: ['activate', 'close', 'reload', 'mute', 'unmute', 'pin', 'unpin', 'reopen'],
    positional: { key: 'id', mode: 'one' },
  },
  bookmark: { actions: ['add', 'remove'], positional: { key: 'url', mode: 'one' } },
}

export const VERBS = [...Object.keys(POSITIONAL), 'tab', 'bookmark', 'call']

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export function parseArgv(argv: readonly string[]): Parsed {
  const pretty = argv.includes('--pretty')
  const rest = argv.filter((a) => a !== '--pretty')
  const fail = (error: 'usage' | 'unknown-verb', message: string): Parsed => ({
    ok: false,
    error,
    message,
    pretty,
  })
  const first = rest[0]
  if (first === undefined || first === '--help' || first === '-h')
    return { ok: true, tool: 'help', args: {}, pretty }
  if (first === '--version') return { ok: true, tool: 'version', args: {}, pretty }

  if (first === 'call') {
    const name = rest[1]
    if (name === undefined)
      return fail('usage', 'call needs a tool name: ewe-browser call <tool> [json]')
    if (toolNamed(name) === undefined) return fail('unknown-verb', `unknown tool: ${name}`)
    if (rest.length > 3) return fail('usage', 'call takes one JSON object; quote it')
    try {
      const args: unknown = JSON.parse(rest[2] ?? '{}')
      if (args === null || typeof args !== 'object' || Array.isArray(args))
        return fail('usage', 'the arguments must be a JSON object')
      return { ok: true, tool: name, args: args as Record<string, unknown>, pretty }
    } catch {
      return fail('usage', 'the arguments are not valid JSON')
    }
  }

  let tool: string
  let positional: Positional
  let words: readonly string[]
  const group = Object.hasOwn(GROUPS, first) ? GROUPS[first] : undefined
  if (group !== undefined) {
    const action = rest[1]
    if (action === undefined || !group.actions.includes(action))
      return fail('usage', `${first} needs one of: ${group.actions.join(', ')}`)
    tool = `${first}_${action}`
    positional = action === 'reopen' ? null : group.positional
    words = rest.slice(2)
  } else if (Object.hasOwn(POSITIONAL, first)) {
    tool = first
    positional = POSITIONAL[first] ?? null
    words = rest.slice(1)
  } else {
    return fail('unknown-verb', `unknown verb: ${first}`)
  }
  const spec = toolNamed(tool)
  if (spec === undefined) return fail('unknown-verb', `unknown verb: ${first}`)

  const byOption = new Map<string, [string, PropSchema]>()
  for (const [key, prop] of Object.entries(spec.schema.properties))
    if (positional?.key !== key) byOption.set(kebab(key), [key, prop])

  const args: Record<string, unknown> = {}
  const free: string[] = []
  let onlyFree = false
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? ''
    if (onlyFree || !word.startsWith('--') || word === '--') {
      if (word === '--' && !onlyFree) onlyFree = true
      else free.push(word)
      continue
    }
    const eq = word.indexOf('=')
    const name = word.slice(2, eq < 0 ? undefined : eq)
    const option = byOption.get(name)
    if (option === undefined) return fail('usage', `${spec.usage} (no option --${name})`)
    const [key, prop] = option
    if (prop.type === 'boolean') {
      if (eq >= 0) return fail('usage', `--${name} takes no value`)
      args[key] = true
      continue
    }
    const value = eq >= 0 ? word.slice(eq + 1) : words[++i]
    if (value === undefined) return fail('usage', `--${name} needs a value`)
    if (prop.type === 'integer') {
      const n = Number(value)
      if (!Number.isInteger(n)) return fail('usage', `--${name} needs a whole number`)
      args[key] = n
    } else {
      args[key] = value
    }
  }

  if (positional === null) {
    if (free.length > 0) return fail('usage', `${spec.usage} (unexpected "${free[0] ?? ''}")`)
  } else if (free.length > 0) {
    if (positional.mode === 'one' && free.length > 1)
      return fail('usage', `${spec.usage} (one ${positional.key}; quote it if it has spaces)`)
    args[positional.key] =
      positional.mode === 'list'
        ? free.some(looksLikeTarget)
          ? free
          : [free.join(' ')]
        : positional.mode === 'join'
          ? free.join(' ')
          : free[0]
  } else if (tool === 'ls') {
    args.path = '.'
  }
  return { ok: true, tool, args, pretty }
}

function looksLikeTarget(word: string): boolean {
  return PATHISH.test(word) || /^[a-z][a-z0-9+.-]*:/i.test(word) || /^[^\s]+\.[^\s]+$/.test(word)
}

export interface PathContext {
  cwd: string
  home: string
  exists(path: string): boolean
}

function expand(path: string, ctx: PathContext): string {
  if (path.startsWith('file://')) {
    try {
      return fileURLToPath(path)
    } catch {
      return path
    }
  }
  if (path === '~') return ctx.home
  if (path.startsWith('~/')) return resolve(ctx.home, path.slice(2))
  return isAbsolute(path) ? resolve(path) : resolve(ctx.cwd, path)
}

const PATHISH = /^(\/|~$|~\/|\.\.?$|\.\.?\/|file:\/\/)/

export function absolutePaths(
  tool: string,
  args: Record<string, unknown>,
  ctx: PathContext,
): Record<string, unknown> {
  const out = { ...args }
  const one = (key: string) => {
    const value = out[key]
    if (typeof value === 'string' && value !== '') out[key] = expand(value, ctx)
  }
  if (tool === 'ls' || tool === 'reveal') one('path')
  if (tool === 'locate') one('in')
  if (tool === 'play' && typeof out.query === 'string' && PATHISH.test(out.query)) one('query')
  if (tool === 'open' && Array.isArray(out.targets))
    out.targets = out.targets.map((t: unknown) => {
      if (typeof t !== 'string') return t
      if (PATHISH.test(t)) return expand(t, ctx)
      if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t
      const local = resolve(ctx.cwd, t)
      return ctx.exists(local) ? local : t
    })
  return out
}
