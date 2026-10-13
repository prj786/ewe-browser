import { afterEach, describe, expect, it } from 'vitest'
import { matchShortcut, setShortcuts, type KeyInput } from '../../src/main/shortcuts'

function key(partial: Partial<KeyInput>): KeyInput {
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

afterEach(() => setShortcuts({}))

describe('matchShortcut', () => {
  it('maps the original shortcuts by physical key', () => {
    expect(matchShortcut(key({ code: 'KeyT', key: 't', control: true }))).toEqual({
      action: 'tab.new',
    })
    expect(matchShortcut(key({ code: 'KeyD', key: 'd', control: true }))).toEqual({
      action: 'bookmark',
    })
    expect(matchShortcut(key({ code: 'KeyD', key: 'd', control: true, shift: true }))).toBeNull()
    expect(matchShortcut(key({ code: 'KeyW', key: 'w', control: true }))).toEqual({
      action: 'tab.close',
    })
    expect(matchShortcut(key({ code: 'KeyL', key: 'l', control: true }))).toEqual({
      action: 'address',
    })
    expect(matchShortcut(key({ code: 'KeyK', key: 'k', control: true }))).toEqual({
      action: 'palette',
    })
    expect(matchShortcut(key({ code: 'Tab', key: 'Tab', control: true }))).toEqual({
      action: 'tab.next',
    })
    expect(matchShortcut(key({ code: 'Tab', key: 'Tab', control: true, shift: true }))).toEqual({
      action: 'tab.prev',
    })
    expect(matchShortcut(key({ code: 'KeyT', key: 'T', control: true, shift: true }))).toEqual({
      action: 'tab.reopen',
    })
    expect(matchShortcut(key({ code: 'Digit3', key: '3', control: true }))).toEqual({
      action: 'tab.select',
      index: 2,
    })
    expect(matchShortcut(key({ code: 'Digit9', key: '9', control: true }))).toEqual({
      action: 'tab.last',
    })
    expect(matchShortcut(key({ code: 'ArrowLeft', key: 'ArrowLeft', alt: true }))).toEqual({
      action: 'back',
    })
    expect(matchShortcut(key({ code: 'F5', key: 'F5' }))).toEqual({ action: 'reload' })
    expect(matchShortcut(key({ code: 'F12', key: 'F12' }))).toEqual({ action: 'devtools' })
    expect(
      matchShortcut(key({ code: 'PageDown', key: 'PageDown', control: true, shift: true })),
    ).toEqual({ action: 'workspace.next' })
  })

  it('maps the keyboard movement bindings', () => {
    expect(matchShortcut(key({ code: 'Digit2', key: '2', alt: true }))).toEqual({
      action: 'tab.select',
      index: 1,
    })
    expect(matchShortcut(key({ code: 'Digit9', key: '9', alt: true }))).toEqual({
      action: 'tab.last',
    })
    expect(matchShortcut(key({ code: 'Digit2', key: '@', alt: true, shift: true }))).toEqual({
      action: 'workspace.select',
      index: 1,
    })
    expect(matchShortcut(key({ code: 'Digit9', key: '(', alt: true, shift: true }))).toEqual({
      action: 'workspace.last',
    })
    expect(
      matchShortcut(key({ code: 'ArrowRight', key: 'ArrowRight', control: true, alt: true })),
    ).toEqual({ action: 'workspace.next' })
    expect(
      matchShortcut(key({ code: 'ArrowLeft', key: 'ArrowLeft', control: true, alt: true })),
    ).toEqual({ action: 'workspace.prev' })
    expect(matchShortcut(key({ code: 'Home', key: 'Home', alt: true }))).toEqual({
      action: 'home',
    })
  })

  it('works on non-latin layouts because it ignores the produced character', () => {
    expect(matchShortcut(key({ code: 'KeyT', key: 'ტ', control: true }))).toEqual({
      action: 'tab.new',
    })
    expect(matchShortcut(key({ code: 'KeyL', key: 'ლ', control: true }))).toEqual({
      action: 'address',
    })
  })

  it('ignores key-up, plain keys and AltGr chords', () => {
    expect(matchShortcut(key({ type: 'keyUp', code: 'KeyT', key: 't', control: true }))).toBeNull()
    expect(matchShortcut(key({ code: 'KeyT', key: 't' }))).toBeNull()
    expect(matchShortcut(key({ code: 'KeyA', key: 'a', control: true }))).toBeNull()
    expect(matchShortcut(key({ code: 'KeyW', key: 'w', control: true, alt: true }))).toBeNull()
    expect(matchShortcut(key({ code: 'Digit2', key: '@', control: true, alt: true }))).toBeNull()
  })

  it('applies remapped bindings live', () => {
    setShortcuts({ reload: ['Ctrl+J'] })
    expect(matchShortcut(key({ code: 'KeyJ', key: 'j', control: true }))).toEqual({
      action: 'reload',
    })
    expect(matchShortcut(key({ code: 'KeyR', key: 'r', control: true }))).toBeNull()
    setShortcuts({})
    expect(matchShortcut(key({ code: 'KeyR', key: 'r', control: true }))).toEqual({
      action: 'reload',
    })
  })
})
