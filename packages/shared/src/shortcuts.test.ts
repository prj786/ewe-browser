import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_IDS,
  buildKeymap,
  chordFromInput,
  chordParts,
  formatChord,
  matchKeymap,
  normalizeChord,
  parseChord,
  sanitizeShortcuts,
  shortcutConflicts,
  expandChord,
  type ChordInput,
} from './shortcuts'

function key(partial: Partial<ChordInput>): ChordInput {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    control: false,
    shift: false,
    alt: false,
    meta: false,
    ...partial,
  }
}

describe('parseChord', () => {
  it('parses modifiers and physical key codes', () => {
    expect(parseChord('Ctrl+T')).toEqual({ ctrl: true, alt: false, shift: false, code: 'KeyT' })
    expect(parseChord('alt+shift+2')).toEqual({
      ctrl: false,
      alt: true,
      shift: true,
      code: 'Digit2',
    })
    expect(parseChord('Ctrl+Alt+Right')?.code).toBe('ArrowRight')
    expect(parseChord('Ctrl+=')?.code).toBe('Equal')
    expect(parseChord('F5')).toEqual({ ctrl: false, alt: false, shift: false, code: 'F5' })
    expect(parseChord('Alt+1-9')?.code).toBe('1-9')
  })

  it('rejects junk', () => {
    for (const text of [
      '',
      '+',
      'T',
      'Shift+T',
      'Ctrl+',
      'Ctrl+Ctrl+T',
      'Super+T',
      'Ctrl+Nope',
      'Ctrl+F13',
      'Ctrl++',
      'Ctrl+T+Y',
    ])
      expect(parseChord(text), text).toBeNull()
  })

  it('normalizes to the canonical order and case', () => {
    expect(normalizeChord('shift+ctrl+pagedown')).toBe('Ctrl+Shift+PageDown')
    expect(normalizeChord('control+t')).toBe('Ctrl+T')
    expect(formatChord(parseChord('Alt+Shift+9') as never)).toBe('Alt+Shift+9')
  })

  it('splits a chord into display parts', () => {
    expect(chordParts('Ctrl+Alt+Left')).toEqual(['Ctrl', 'Alt', '←'])
  })
})

describe('chordFromInput', () => {
  it('records a chord, ignoring bare modifiers and plain keys', () => {
    expect(chordFromInput(key({ code: 'KeyJ', control: true }))).toBe('Ctrl+J')
    expect(chordFromInput(key({ code: 'Digit4', alt: true, shift: true }), true)).toBe(
      'Alt+Shift+1-9',
    )
    expect(chordFromInput(key({ code: 'Digit4', alt: true }))).toBe('Alt+4')
    expect(chordFromInput(key({ code: 'ControlLeft', control: true }))).toBeNull()
    expect(chordFromInput(key({ code: 'KeyJ' }))).toBeNull()
    expect(chordFromInput(key({ code: 'F9' }))).toBe('F9')
    expect(chordFromInput(key({ type: 'keyUp', code: 'KeyJ', control: true }))).toBeNull()
  })
})

describe('default keymap', () => {
  const map = buildKeymap({})
  const hit = (input: Partial<ChordInput>) => matchKeymap(map, key(input))

  it('has valid defaults for every action', () => {
    for (const id of SHORTCUT_IDS) {
      expect(DEFAULT_SHORTCUTS[id].length).toBeGreaterThan(0)
      for (const chord of DEFAULT_SHORTCUTS[id]) expect(parseChord(chord), chord).not.toBeNull()
    }
    expect(shortcutConflicts({}).size).toBe(0)
  })

  it('finds conflicts inside digit ranges', () => {
    expect(expandChord('Alt+1-9')).toHaveLength(9)
    expect(expandChord('Ctrl+T')).toEqual(['Ctrl+T'])
    expect(shortcutConflicts({ home: ['Alt+9'] }).get('Alt+9')).toEqual(['tab.select', 'home'])
    expect(shortcutConflicts({ home: ['Alt+Shift+9'] }).get('Alt+9')).toBeUndefined()
  })

  it('keeps every earlier shortcut', () => {
    expect(hit({ code: 'KeyT', control: true })?.id).toBe('tab.new')
    expect(hit({ code: 'KeyT', meta: true })?.id).toBe('tab.new')
    expect(hit({ code: 'KeyW', control: true })?.id).toBe('tab.close')
    expect(hit({ code: 'F4', control: true })?.id).toBe('tab.close')
    expect(hit({ code: 'KeyL', control: true })?.id).toBe('address')
    expect(hit({ code: 'KeyE', control: true })?.id).toBe('address')
    expect(hit({ code: 'KeyK', control: true })?.id).toBe('palette')
    expect(hit({ code: 'KeyP', control: true, shift: true })?.id).toBe('palette')
    expect(hit({ code: 'KeyR', control: true })?.id).toBe('reload')
    expect(hit({ code: 'KeyR', control: true, shift: true })?.id).toBe('reload.hard')
    expect(hit({ code: 'KeyN', control: true })?.id).toBe('window.new')
    expect(hit({ code: 'KeyN', control: true, shift: true })?.id).toBe('window.new')
    expect(hit({ code: 'KeyW', control: true, shift: true })?.id).toBe('window.close')
    expect(hit({ code: 'KeyI', control: true, shift: true })?.id).toBe('devtools')
    expect(hit({ code: 'KeyQ', control: true, shift: true })?.id).toBe('quit')
    expect(hit({ code: 'KeyT', control: true, shift: true })?.id).toBe('tab.reopen')
    expect(hit({ code: 'Tab', control: true })?.id).toBe('tab.next')
    expect(hit({ code: 'PageDown', control: true })?.id).toBe('tab.next')
    expect(hit({ code: 'Tab', control: true, shift: true })?.id).toBe('tab.prev')
    expect(hit({ code: 'PageUp', control: true })?.id).toBe('tab.prev')
    expect(hit({ code: 'PageDown', control: true, shift: true })?.id).toBe('workspace.next')
    expect(hit({ code: 'PageUp', control: true, shift: true })?.id).toBe('workspace.prev')
    expect(hit({ code: 'Equal', control: true })?.id).toBe('zoom.in')
    expect(hit({ code: 'Equal', control: true, shift: true })?.id).toBe('zoom.in')
    expect(hit({ code: 'Minus', control: true })?.id).toBe('zoom.out')
    expect(hit({ code: 'Digit0', control: true })?.id).toBe('zoom.reset')
    expect(hit({ code: 'BracketLeft', control: true })?.id).toBe('back')
    expect(hit({ code: 'BracketRight', control: true })?.id).toBe('forward')
    expect(hit({ code: 'ArrowLeft', key: 'ArrowLeft', alt: true })?.id).toBe('back')
    expect(hit({ code: 'ArrowRight', key: 'ArrowRight', alt: true })?.id).toBe('forward')
    expect(hit({ code: 'F5', key: 'F5' })?.id).toBe('reload')
    expect(hit({ key: 'F11' })?.id).toBe('fullscreen')
    expect(hit({ code: 'F12', key: 'F12' })?.id).toBe('devtools')
  })

  it('selects tabs and workspaces by digit', () => {
    expect(hit({ code: 'Digit3', control: true })).toEqual({ id: 'tab.select', digit: 3 })
    expect(hit({ code: 'Digit9', control: true })).toEqual({ id: 'tab.select', digit: 9 })
    expect(hit({ code: 'Digit2', alt: true })).toEqual({ id: 'tab.select', digit: 2 })
    expect(hit({ code: 'Digit2', alt: true, shift: true })).toEqual({
      id: 'workspace.select',
      digit: 2,
    })
    expect(hit({ code: 'Digit9', alt: true, shift: true })).toEqual({
      id: 'workspace.select',
      digit: 9,
    })
    expect(hit({ code: 'Digit0', alt: true })).toBeNull()
  })

  it('switches workspaces and opens home without hijacking back and forward', () => {
    expect(hit({ code: 'ArrowRight', key: 'ArrowRight', control: true, alt: true })?.id).toBe(
      'workspace.next',
    )
    expect(hit({ code: 'ArrowLeft', key: 'ArrowLeft', control: true, alt: true })?.id).toBe(
      'workspace.prev',
    )
    expect(hit({ code: 'Home', key: 'Home', alt: true })?.id).toBe('home')
    expect(hit({ code: 'Tab', key: 'Tab', alt: true })).toBeNull()
  })

  it('works on non-latin layouts because it ignores the produced character', () => {
    expect(hit({ code: 'KeyT', key: 'ტ', control: true })?.id).toBe('tab.new')
    expect(hit({ code: 'KeyL', key: 'ლ', control: true })?.id).toBe('address')
  })

  it('ignores key-up, plain keys, unbound chords and AltGr characters', () => {
    expect(hit({ type: 'keyUp', code: 'KeyT', key: 't', control: true })).toBeNull()
    expect(hit({ code: 'KeyT', key: 't' })).toBeNull()
    expect(hit({ code: 'KeyA', key: 'a', control: true })).toBeNull()
    expect(hit({ code: 'KeyW', key: 'w', control: true, alt: true })).toBeNull()
    expect(hit({ code: 'Digit2', key: '@', control: true, alt: true })).toBeNull()
  })
})

describe('overrides', () => {
  it('replace the defaults of an action and win over other defaults', () => {
    const map = buildKeymap({ reload: ['Ctrl+J'], 'tab.new': ['Ctrl+K'] })
    expect(matchKeymap(map, key({ code: 'KeyJ', control: true }))?.id).toBe('reload')
    expect(matchKeymap(map, key({ code: 'KeyR', control: true }))).toBeNull()
    expect(matchKeymap(map, key({ code: 'F5', key: 'F5' }))).toBeNull()
    expect(matchKeymap(map, key({ code: 'KeyK', control: true }))?.id).toBe('tab.new')
    expect(matchKeymap(map, key({ code: 'KeyT', control: true }))).toBeNull()
  })

  it('reports conflicts', () => {
    const conflicts = shortcutConflicts({ reload: ['Ctrl+L'] })
    expect(conflicts.get('Ctrl+L')).toEqual(['address', 'reload'])
  })
})

describe('sanitizeShortcuts', () => {
  it('keeps valid chords in canonical form and drops junk', () => {
    expect(
      sanitizeShortcuts({
        reload: ['shift+ctrl+j', 'Ctrl+J', 'nope', 5],
        bogus: ['Ctrl+T'],
        'tab.new': 'Ctrl+J',
        back: [],
        'tab.select': ['Alt+1-9'],
        'tab.close': ['Ctrl+1-9'],
        home: ['T'],
      }),
    ).toEqual({ reload: ['Ctrl+Shift+J', 'Ctrl+J'], 'tab.select': ['Alt+1-9'] })
    expect(sanitizeShortcuts(null)).toEqual({})
    expect(sanitizeShortcuts([])).toEqual({})
  })
})
