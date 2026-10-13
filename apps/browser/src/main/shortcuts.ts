import {
  buildKeymap,
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
