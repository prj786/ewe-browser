import {
  PAGE_FIRST_CHORDS,
  PAGE_FIRST_SHORTCUTS,
  buildKeymap,
  chordFromInput,
  matchKeymap,
  type ChordInput,
  type KeymapEntry,
  type ShortcutId,
  type ShortcutMap,
} from '@ewe/shared'

type SimpleShortcut = Exclude<ShortcutId, 'tab.select' | 'workspace.select'>

export type ShortcutAction =
  | { action: SimpleShortcut }
  | { action: 'tab.select' | 'workspace.select'; index: number }
  | { action: 'tab.last' | 'workspace.last' }

export type KeyInput = ChordInput

let keymap: KeymapEntry[] = buildKeymap({})

export function setShortcuts(overrides: ShortcutMap): void {
  keymap = buildKeymap(overrides)
}

export function matchShortcut(input: KeyInput): ShortcutAction | null {
  const hit = matchKeymap(keymap, input)
  if (hit === null) return null
  if (hit.id === 'tab.select' || hit.id === 'workspace.select') {
    const digit = hit.digit ?? 1
    const kind = hit.id === 'tab.select' ? 'tab' : 'workspace'
    if (digit === 9) return { action: `${kind}.last` }
    return { action: hit.id, index: digit - 1 }
  }
  return { action: hit.id }
}

const PAGE_FIRST_IDS: ReadonlySet<string> = PAGE_FIRST_SHORTCUTS

export function isPageFirst(action: ShortcutAction, input: KeyInput): boolean {
  if (PAGE_FIRST_IDS.has(action.action)) return true
  const chord = chordFromInput(input)
  return chord !== null && PAGE_FIRST_CHORDS.has(chord)
}
