export const SHORTCUT_IDS = [
  'tab.new',
  'tab.close',
  'tab.reopen',
  'tab.next',
  'tab.prev',
  'tab.select',
  'workspace.select',
  'workspace.next',
  'workspace.prev',
  'home',
  'address',
  'palette',
  'bookmark',
  'rail.toggle',
  'files',
  'passwords',
  'sidebar.bookmarks',
  'sidebar.downloads',
  'sidebar.history',
  'history',
  'reload',
  'reload.hard',
  'back',
  'forward',
  'window.new',
  'window.close',
  'devtools',
  'zoom.in',
  'zoom.out',
  'zoom.reset',
  'fullscreen',
  'quit',
  'find',
  'find.next',
  'find.prev',
  'workspace.new',
  'workspace.rename',
  'tab.workspace.next',
  'tab.workspace.prev',
  'settings',
  'print',
  'source',
  'tab.duplicate',
  'tab.pin',
  'tab.mute',
  'url.copy',
  'tab.search',
  'music',
] as const

export type ShortcutId = (typeof SHORTCUT_IDS)[number]

export const PAGE_FIRST_SHORTCUTS: ReadonlySet<ShortcutId> = new Set<ShortcutId>([
  'find',
  'find.next',
  'find.prev',
  'print',
  'source',
  'settings',
  'tab.mute',
  'tab.duplicate',
  'tab.pin',
  'tab.search',
  'url.copy',
  'music',
  'workspace.new',
  'workspace.rename',
  'tab.workspace.next',
  'tab.workspace.prev',
])

export const PAGE_FIRST_CHORDS: ReadonlySet<string> = new Set([
  'Alt+Shift+Left',
  'Alt+Shift+Right',
  'Alt+Shift+H',
])
export type ShortcutMap = Partial<Record<ShortcutId, string[]>>

export const DIGITS_KEY = '1-9'

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string[]> = {
  'tab.new': ['Ctrl+T'],
  'tab.close': ['Ctrl+W', 'Ctrl+F4'],
  'tab.reopen': ['Ctrl+Shift+T'],
  'tab.next': ['Ctrl+Tab', 'Ctrl+PageDown'],
  'tab.prev': ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
  'tab.select': ['Ctrl+1-9', 'Alt+1-9'],
  'workspace.select': ['Alt+Shift+1-9'],
  'workspace.next': ['Ctrl+Shift+PageDown', 'Ctrl+Alt+Right', 'Alt+Shift+Right'],
  'workspace.prev': ['Ctrl+Shift+PageUp', 'Ctrl+Alt+Left', 'Alt+Shift+Left'],
  home: ['Alt+Home', 'Alt+Shift+H'],
  address: ['Ctrl+L', 'Ctrl+E'],
  palette: ['Ctrl+K', 'Ctrl+Shift+P'],
  bookmark: ['Ctrl+D'],
  'rail.toggle': ['Ctrl+Shift+S'],
  files: ['Ctrl+Shift+E'],
  passwords: ['Ctrl+Shift+L'],
  'sidebar.bookmarks': ['Ctrl+Shift+B'],
  'sidebar.downloads': ['Ctrl+J'],
  'sidebar.history': ['Ctrl+H'],
  history: ['Ctrl+Shift+H'],
  reload: ['Ctrl+R', 'F5'],
  'reload.hard': ['Ctrl+Shift+R'],
  back: ['Alt+Left', 'Ctrl+['],
  forward: ['Alt+Right', 'Ctrl+]'],
  'window.new': ['Ctrl+N', 'Ctrl+Shift+N'],
  'window.close': ['Ctrl+Shift+W'],
  devtools: ['Ctrl+Shift+I', 'F12'],
  'zoom.in': ['Ctrl+=', 'Ctrl+Shift+='],
  'zoom.out': ['Ctrl+-'],
  'zoom.reset': ['Ctrl+0'],
  fullscreen: ['F11'],
  quit: ['Ctrl+Shift+Q'],
  find: ['Ctrl+F'],
  'find.next': ['Ctrl+G', 'F3'],
  'find.prev': ['Ctrl+Shift+G', 'Shift+F3'],
  'workspace.new': ['Alt+Shift+N'],
  'workspace.rename': ['Alt+Shift+R'],
  'tab.workspace.next': ['Ctrl+Alt+Shift+Right'],
  'tab.workspace.prev': ['Ctrl+Alt+Shift+Left'],
  settings: ['Ctrl+,'],
  print: ['Ctrl+P'],
  source: ['Ctrl+U'],
  'tab.duplicate': ['Alt+Shift+D'],
  'tab.pin': ['Alt+Shift+P'],
  'tab.mute': ['Ctrl+M'],
  'url.copy': ['Alt+Shift+C'],
  'tab.search': ['Ctrl+Shift+A'],
  music: ['Alt+Shift+M'],
}

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  'tab.new': 'New tab',
  'tab.close': 'Close tab',
  'tab.reopen': 'Reopen closed tab',
  'tab.next': 'Next tab',
  'tab.prev': 'Previous tab',
  'tab.select': 'Select tab 1 to 8, 9 for the last',
  'workspace.select': 'Select workspace 1 to 8, 9 for the last',
  'workspace.next': 'Next workspace',
  'workspace.prev': 'Previous workspace',
  home: 'Open home page',
  address: 'Edit address',
  palette: 'Command palette',
  bookmark: 'Bookmark this page',
  'rail.toggle': 'Collapse or expand the tab rail',
  files: 'Open files',
  passwords: 'Fill from Safe',
  'sidebar.bookmarks': 'Bookmarks sidebar',
  'sidebar.downloads': 'Downloads sidebar',
  'sidebar.history': 'History sidebar',
  history: 'Show all history',
  reload: 'Reload',
  'reload.hard': 'Hard reload',
  back: 'Back',
  forward: 'Forward',
  'window.new': 'New window',
  'window.close': 'Close window',
  devtools: 'Developer tools',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.reset': 'Reset zoom',
  fullscreen: 'Fullscreen',
  quit: 'Quit',
  find: 'Find in page',
  'find.next': 'Find next',
  'find.prev': 'Find previous',
  'workspace.new': 'New workspace',
  'workspace.rename': 'Rename workspace',
  'tab.workspace.next': 'Move tab to the next workspace',
  'tab.workspace.prev': 'Move tab to the previous workspace',
  settings: 'Open settings',
  print: 'Print',
  source: 'View page source',
  'tab.duplicate': 'Duplicate tab',
  'tab.pin': 'Pin or unpin tab',
  'tab.mute': 'Mute or unmute tab',
  'url.copy': 'Copy page address',
  'tab.search': 'Search open tabs',
  music: 'Open music',
}

export interface Chord {
  ctrl: boolean
  alt: boolean
  shift: boolean
  code: string
}

export interface ChordInput {
  type: string
  key: string
  code: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

const NAMED: Record<string, string> = {
  Tab: 'Tab',
  Space: 'Space',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  '=': 'Equal',
  '-': 'Minus',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '\\': 'Backslash',
  '`': 'Backquote',
}

const CODE_TO_NAME = new Map<string, string>(
  Object.entries(NAMED).map(([name, code]) => [code, name]),
)
const MODIFIERS = new Set(['control', 'ctrl', 'alt', 'shift'])

export function codeOfKeyName(name: string): string | null {
  if (name === DIGITS_KEY) return DIGITS_KEY
  if (/^[a-z]$/i.test(name)) return `Key${name.toUpperCase()}`
  if (/^[0-9]$/.test(name)) return `Digit${name}`
  if (/^F([1-9]|1[0-2])$/i.test(name)) return name.toUpperCase()
  const lower = name.toLowerCase()
  const hit = Object.keys(NAMED).find((k) => k.toLowerCase() === lower)
  return hit === undefined ? null : (NAMED[hit] ?? null)
}

export function nameOfCode(code: string): string | null {
  if (code === DIGITS_KEY) return DIGITS_KEY
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter?.[1] !== undefined) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit?.[1] !== undefined) return digit[1]
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return CODE_TO_NAME.get(code) ?? null
}

function isFunctionCode(code: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(code)
}

export function parseChord(text: string): Chord | null {
  const parts = text.split('+').map((p) => p.trim())
  if (parts.length < 1 || parts.some((p) => p === '')) return null
  const key = parts[parts.length - 1] ?? ''
  const chord: Chord = { ctrl: false, alt: false, shift: false, code: '' }
  for (const raw of parts.slice(0, -1)) {
    const mod = raw.toLowerCase()
    if (!MODIFIERS.has(mod)) return null
    const field = mod === 'control' || mod === 'ctrl' ? 'ctrl' : (mod as 'alt' | 'shift')
    if (chord[field]) return null
    chord[field] = true
  }
  const code = codeOfKeyName(key)
  if (code === null) return null
  chord.code = code
  if (!chord.ctrl && !chord.alt && !isFunctionCode(code)) return null
  return chord
}

export function formatChord(chord: Chord): string {
  const name = nameOfCode(chord.code) ?? chord.code
  return [chord.ctrl ? 'Ctrl' : '', chord.alt ? 'Alt' : '', chord.shift ? 'Shift' : '', name]
    .filter((p) => p !== '')
    .join('+')
}

export function normalizeChord(text: string): string | null {
  const chord = parseChord(text)
  return chord === null ? null : formatChord(chord)
}

const KEY_GLYPHS: Record<string, string> = {
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
}

export function chordParts(text: string): string[] {
  return text.split('+').map((p) => KEY_GLYPHS[p] ?? p)
}

export function chordFromInput(input: ChordInput, digits = false): string | null {
  if (input.type !== 'keyDown') return null
  if (/^(Control|Shift|Alt|Meta|AltGraph)(Left|Right)?$/.test(input.code)) return null
  let code = input.code
  if (digits && /^Digit[1-9]$/.test(code)) code = DIGITS_KEY
  if (nameOfCode(code) === null) return null
  const chord: Chord = {
    ctrl: input.control || input.meta,
    alt: input.alt,
    shift: input.shift,
    code,
  }
  if (!chord.ctrl && !chord.alt && !isFunctionCode(code)) return null
  return formatChord(chord)
}

export function isChordValidFor(id: ShortcutId, chord: Chord): boolean {
  const selects = id === 'tab.select' || id === 'workspace.select'
  return selects || chord.code !== DIGITS_KEY
}

export function sanitizeShortcuts(value: unknown): ShortcutMap {
  const out: ShortcutMap = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out
  const known = new Set<string>(SHORTCUT_IDS)
  for (const [id, chords] of Object.entries(value)) {
    if (!known.has(id) || !Array.isArray(chords)) continue
    const shortcutId = id as ShortcutId
    const list: string[] = []
    for (const raw of chords as unknown[]) {
      if (typeof raw !== 'string') continue
      const chord = parseChord(raw)
      if (chord === null || !isChordValidFor(shortcutId, chord)) continue
      const text = formatChord(chord)
      if (!list.includes(text)) list.push(text)
    }
    if (list.length > 0) out[shortcutId] = list.slice(0, 4)
  }
  return out
}

export function effectiveShortcuts(overrides: ShortcutMap): Record<ShortcutId, string[]> {
  const merged = { ...DEFAULT_SHORTCUTS }
  for (const id of SHORTCUT_IDS) {
    const custom = overrides[id]
    if (custom !== undefined && custom.length > 0) merged[id] = custom
  }
  return merged
}

export function expandChord(text: string): string[] {
  if (!text.endsWith(`+${DIGITS_KEY}`)) return [text]
  const prefix = text.slice(0, -DIGITS_KEY.length)
  return ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => prefix + d)
}

export function shortcutConflicts(overrides: ShortcutMap): Map<string, ShortcutId[]> {
  const byChord = new Map<string, ShortcutId[]>()
  const effective = effectiveShortcuts(overrides)
  for (const id of SHORTCUT_IDS) {
    for (const chord of new Set(effective[id].flatMap(expandChord))) {
      const list = byChord.get(chord) ?? []
      list.push(id)
      byChord.set(chord, list)
    }
  }
  for (const [chord, ids] of byChord) if (ids.length < 2) byChord.delete(chord)
  return byChord
}

export interface KeymapEntry {
  id: ShortcutId
  chord: Chord
}

export function buildKeymap(overrides: ShortcutMap): KeymapEntry[] {
  const entries: KeymapEntry[] = []
  const custom = SHORTCUT_IDS.filter((id) => (overrides[id]?.length ?? 0) > 0)
  const rest = SHORTCUT_IDS.filter((id) => !custom.includes(id))
  const effective = effectiveShortcuts(overrides)
  for (const id of [...custom, ...rest]) {
    for (const text of effective[id]) {
      const chord = parseChord(text)
      if (chord !== null) entries.push({ id, chord })
    }
  }
  return entries
}

export function matchKeymap(
  keymap: readonly KeymapEntry[],
  input: ChordInput,
): { id: ShortcutId; digit?: number } | null {
  if (input.type !== 'keyDown') return null
  const ctrl = input.control || input.meta
  if (ctrl && input.alt && input.key.length === 1) return null
  const digit = /^Digit([1-9])$/.exec(input.code)?.[1]
  for (const { id, chord } of keymap) {
    if (chord.ctrl !== ctrl || chord.alt !== input.alt || chord.shift !== input.shift) continue
    if (chord.code === DIGITS_KEY) {
      if (digit !== undefined) return { id, digit: Number(digit) }
      continue
    }
    if (chord.code === input.code || (isFunctionCode(chord.code) && chord.code === input.key))
      return { id }
  }
  return null
}
