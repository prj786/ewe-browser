import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GESTURE_SETTINGS,
  PASSWORD_MANAGER_EXTENSIONS,
  SWIPE_END_MS,
  SWIPE_THRESHOLD,
  SwipeTracker,
  isPageAction,
  isPageInput,
  pageMenuAllows,
  pageMenuItems,
  passwordManagerName,
  sanitizeGestureSettings,
  shortText,
  type PageMenu,
  type PageMenuEntry,
  type SwipeDirection,
  type SwipeEvent,
} from './input'
import { storeExtensionId } from './models'
import {
  DEFAULT_SHORTCUTS,
  PAGE_FIRST_CHORDS,
  PAGE_FIRST_SHORTCUTS,
  SHORTCUT_IDS,
  buildKeymap,
  matchKeymap,
  normalizeChord,
  parseChord,
  shortcutConflicts,
} from './shortcuts'

const free = () => false

function feed(
  tracker: SwipeTracker,
  deltas: [number, number][],
  options: { start?: number; step?: number; ctrl?: boolean; shift?: boolean } = {},
  blocked: (dir: SwipeDirection) => boolean = free,
): SwipeEvent[] {
  const step = options.step ?? 16
  let time = options.start ?? 0
  const out: SwipeEvent[] = []
  for (const [dx, dy] of deltas) {
    out.push(
      ...tracker.wheel(
        { dx, dy, ctrl: options.ctrl ?? false, shift: options.shift ?? false, time },
        blocked,
      ),
    )
    time += step
  }
  return out
}

describe('SwipeTracker', () => {
  it('starts on horizontal intent and fills towards the threshold', () => {
    const t = new SwipeTracker()
    const events = feed(t, [
      [-4, 0],
      [-10, 1],
      [-40, 0],
    ])
    expect(events[0]).toEqual({ type: 'start', dir: 'back', progress: 0.09 })
    expect(events[1]).toEqual({ type: 'move', dir: 'back', progress: 0.34 })
    expect(t.tracking).toBe(true)
  })

  it('ends after the quiet period and reports the final progress', () => {
    const t = new SwipeTracker()
    feed(
      t,
      Array.from({ length: 12 }, () => [-20, 0] as [number, number]),
    )
    expect(t.idle(11 * 16 + SWIPE_END_MS - 1)).toBeNull()
    expect(t.idle(11 * 16 + SWIPE_END_MS)).toEqual({ type: 'end', dir: 'back', progress: 1 })
    expect(t.tracking).toBe(false)
  })

  it('swipes forward with positive deltas', () => {
    const t = new SwipeTracker()
    const events = feed(t, [
      [20, 0],
      [SWIPE_THRESHOLD, 0],
    ])
    expect(events.map((e) => e.type)).toEqual(['start', 'move'])
    expect(events[1]).toEqual({ type: 'move', dir: 'forward', progress: 1 })
  })

  it('drops back to zero when the fingers turn around', () => {
    const t = new SwipeTracker()
    const events = feed(t, [
      [-30, 0],
      [-30, 0],
      [80, 0],
    ])
    expect(events.at(-1)).toEqual({ type: 'move', dir: 'back', progress: 0 })
  })

  it('ignores vertical scrolling for the whole gesture', () => {
    const t = new SwipeTracker()
    expect(
      feed(t, [
        [-3, 10],
        [-50, 5],
        [-200, 0],
      ]),
    ).toEqual([])
    expect(t.tracking).toBe(false)
  })

  it('needs the horizontal part to be more than twice the vertical part', () => {
    expect(feed(new SwipeTracker(), [[-20, 10]])).toEqual([])
    expect(feed(new SwipeTracker(), [[-21, 10]])).toHaveLength(1)
  })

  it('leaves the gesture to the page when something can still scroll that way', () => {
    const t = new SwipeTracker()
    const seen: SwipeDirection[] = []
    const events = feed(
      t,
      [
        [-20, 0],
        [-200, 0],
      ],
      {},
      (dir) => {
        seen.push(dir)
        return true
      },
    )
    expect(events).toEqual([])
    expect(seen).toEqual(['back'])
  })

  it('ignores pinch (ctrl) and shift + wheel', () => {
    expect(feed(new SwipeTracker(), [[-200, 0]], { ctrl: true })).toEqual([])
    expect(feed(new SwipeTracker(), [[-200, 0]], { shift: true })).toEqual([])
    const t = new SwipeTracker()
    feed(t, [[-40, 0]])
    expect(t.wheel({ dx: -40, dy: 0, ctrl: true, shift: false, time: 20 }, free)).toEqual([
      { type: 'cancel', dir: 'back' },
    ])
  })

  it('splits gestures on a pause and ends the first one before starting the next', () => {
    const t = new SwipeTracker()
    feed(t, [
      [-200, 0],
      [-10, 0],
    ])
    const next = feed(t, [[30, 0]], { start: 16 + SWIPE_END_MS + 1 })
    expect(next).toEqual([
      { type: 'end', dir: 'back', progress: 1 },
      { type: 'start', dir: 'forward', progress: 0.19 },
    ])
  })

  it('reports nothing at the end of an ignored gesture', () => {
    const t = new SwipeTracker()
    feed(t, [[0, 40]])
    expect(t.idle(1000)).toBeNull()
  })
})

describe('page input validation', () => {
  it('accepts the three kinds', () => {
    expect(isPageInput({ kind: 'swipe', phase: 'move', dir: 'back', progress: 0.5 })).toBe(true)
    expect(isPageInput({ kind: 'button', dir: 'forward' })).toBe(true)
    expect(isPageInput({ kind: 'probe', safe: 'login' })).toBe(true)
    expect(isPageInput({ kind: 'probe', safe: null })).toBe(true)
    expect(isPageInput({ kind: 'key', code: 'KeyU' })).toBe(true)
    expect(isPageInput({ kind: 'key', code: 'Key U' })).toBe(false)
    expect(isPageInput({ kind: 'key', code: 7 })).toBe(false)
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      'swipe',
      { kind: 'swipe', phase: 'jump', dir: 'back', progress: 0 },
      { kind: 'swipe', phase: 'move', dir: 'up', progress: 0 },
      { kind: 'swipe', phase: 'move', dir: 'back', progress: 2 },
      { kind: 'swipe', phase: 'move', dir: 'back', progress: Number.NaN },
      { kind: 'button', dir: 'left' },
      { kind: 'probe', safe: 'card' },
      { kind: 'navigate', url: 'https://example.org' },
    ])
      expect(isPageInput(bad)).toBe(false)
    expect(isPageAction({ op: 'media.play' })).toBe(true)
    expect(isPageAction({ op: 'safe.key' })).toBe(true)
    expect(isPageAction({ op: 'eval' })).toBe(false)
    expect(isPageAction('media.play')).toBe(false)
  })

  it('sanitizes gesture settings', () => {
    expect(DEFAULT_GESTURE_SETTINGS).toEqual({ swipe: true })
    expect(sanitizeGestureSettings({ swipe: false }, DEFAULT_GESTURE_SETTINGS)).toEqual({
      swipe: false,
    })
    expect(sanitizeGestureSettings({ swipe: 'no' }, { swipe: false })).toEqual({ swipe: false })
    expect(sanitizeGestureSettings(null, DEFAULT_GESTURE_SETTINGS)).toBe(DEFAULT_GESTURE_SETTINGS)
  })
})

const base: PageMenu = {
  menuId: 'm1',
  engine: 'Google',
  link: null,
  media: null,
  selection: '',
  selectionUrl: null,
  edit: null,
  page: { back: true, forward: false, bookmarkable: true, bookmarked: false, web: true },
}

const actions = (entries: PageMenuEntry[]) =>
  entries.map((e) => (e.type === 'separator' ? '|' : e.action))

const labelOf = (entries: PageMenuEntry[], action: string) =>
  entries.find((e) => e.type === 'item' && e.action === action)

describe('pageMenuItems', () => {
  it('shows the page items and Inspect on an empty spot', () => {
    expect(actions(pageMenuItems(base))).toEqual([
      'page.back',
      'page.forward',
      'page.reload',
      '|',
      'page.bookmark',
      'page.save',
      'page.print',
      'page.source',
      '|',
      'inspect',
    ])
    expect(labelOf(pageMenuItems(base), 'page.forward')).toMatchObject({ disabled: true })
    const bookmarked = pageMenuItems({ ...base, page: { ...base.page, bookmarked: true } })
    expect(labelOf(bookmarked, 'page.bookmark')).toMatchObject({ label: 'Remove bookmark' })
    const internal = pageMenuItems({ ...base, page: { ...base.page, web: false } })
    expect(labelOf(internal, 'page.source')).toMatchObject({ disabled: true })
  })

  it('builds link items and keeps non-web links copy-only', () => {
    const menu = { ...base, link: { url: 'https://example.org', text: 'x', openable: true } }
    expect(actions(pageMenuItems(menu))).toEqual([
      'link.tab',
      'link.workspace',
      'link.window',
      '|',
      'link.save',
      'link.copy',
      '|',
      'inspect',
    ])
    const mail = pageMenuItems({
      ...base,
      link: { url: 'mailto:a@b.c', text: '', openable: false },
    })
    expect(labelOf(mail, 'link.tab')).toMatchObject({ disabled: true })
    expect(labelOf(mail, 'link.copy')).not.toHaveProperty('disabled')
  })

  it('builds image and video items with their state', () => {
    const image = {
      kind: 'image' as const,
      url: 'https://example.org/a.png',
      openable: true,
      savable: true,
      copyable: true,
      paused: false,
      muted: false,
      loop: false,
      controls: false,
    }
    expect(actions(pageMenuItems({ ...base, media: image }))).toEqual([
      'media.tab',
      'media.save',
      'media.copy',
      'media.copyUrl',
      '|',
      'inspect',
    ])
    const video = pageMenuItems({
      ...base,
      media: { ...image, kind: 'video', paused: true, muted: true, loop: true, controls: false },
    })
    expect(labelOf(video, 'media.play')).toMatchObject({ label: 'Play' })
    expect(labelOf(video, 'media.mute')).toMatchObject({ label: 'Unmute' })
    expect(labelOf(video, 'media.loop')).toMatchObject({ on: true })
    expect(labelOf(video, 'media.controls')).toMatchObject({ on: false })
    expect(labelOf(video, 'media.tab')).toMatchObject({ label: 'Open video in new tab' })
  })

  it('offers copy, a web search and Go to for a selection', () => {
    const menu = pageMenuItems({
      ...base,
      selection: 'shear the sheep before the rain starts on Tuesday afternoon',
    })
    expect(actions(menu)).toEqual(['selection.copy', 'selection.search', '|', 'inspect'])
    expect(labelOf(menu, 'selection.search')).toMatchObject({
      label: 'Search Google for “shear the sheep before the rain…”',
    })
    const url = pageMenuItems({
      ...base,
      selection: 'example.org',
      selectionUrl: 'https://example.org',
    })
    expect(labelOf(url, 'selection.open')).toMatchObject({ label: 'Go to example.org' })
  })

  it('builds the editing menu with spelling and Safe', () => {
    const edit = {
      undo: true,
      redo: false,
      cut: false,
      copy: false,
      paste: true,
      selectAll: true,
      misspelled: 'sheeep',
      suggestions: ['sheep', 'sheet'],
      safe: 'login' as const,
    }
    const menu = pageMenuItems({ ...base, edit })
    expect(actions(menu)).toEqual([
      'spell.0',
      'spell.1',
      'spell.add',
      '|',
      'safe.fill',
      '|',
      'edit.undo',
      'edit.redo',
      '|',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.pastePlain',
      'edit.selectAll',
      '|',
      'inspect',
    ])
    expect(labelOf(menu, 'spell.1')).toMatchObject({ label: 'sheet' })
    const fresh = pageMenuItems({
      ...base,
      edit: { ...edit, misspelled: '', safe: 'new-password' },
      selection: 'pass',
    })
    expect(actions(fresh).slice(0, 3)).toEqual(['selection.search', '|', 'safe.generate'])
    expect(labelOf(fresh, 'safe.generate')).toMatchObject({ label: 'Use a strong password' })
    const nothing = pageMenuItems({ ...base, edit: { ...edit, suggestions: [], safe: null } })
    expect(labelOf(nothing, 'spell.0')).toMatchObject({ label: 'No suggestions', disabled: true })
  })

  it('lets main run only items the menu shows enabled', () => {
    expect(pageMenuAllows(base, 'page.reload')).toBe(true)
    expect(pageMenuAllows(base, 'page.forward')).toBe(false)
    expect(pageMenuAllows(base, 'link.tab')).toBe(false)
    expect(pageMenuAllows(base, 'safe.fill')).toBe(false)
    expect(pageMenuAllows(base, 'spell.0')).toBe(false)
    expect(pageMenuAllows(base, 'rm -rf')).toBe(false)
  })
})

describe('shortText', () => {
  it('flattens whitespace and ellipsizes by graphemes', () => {
    expect(shortText('  a\n b  ', 10)).toBe('a b')
    expect(shortText('abcdefgh', 5)).toBe('abcd…')
    expect(shortText('👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦', 2)).toBe('👩‍👩‍👧‍👦…')
  })
})

describe('password-manager extensions', () => {
  it('knows the verified store ids', () => {
    expect(passwordManagerName('nngceckbapebfimnlniiiahkandclblb')).toBe('Bitwarden')
    expect(passwordManagerName('aeblfdkhhhdcdjpifhhbdiojplfjncoa')).toBe('1Password')
    expect(passwordManagerName('ddkjiahejlhfcafbddmgiahcphecmpfh')).toBeNull()
    expect(passwordManagerName('constructor')).toBeNull()
    for (const id of Object.keys(PASSWORD_MANAGER_EXTENSIONS))
      expect(storeExtensionId(id), id).toBe(id)
  })
})

describe('the new shortcuts', () => {
  it('all parse and none of the defaults collide', () => {
    for (const chords of Object.values(DEFAULT_SHORTCUTS))
      for (const chord of chords) expect(parseChord(chord), chord).not.toBeNull()
    expect(shortcutConflicts({}).size).toBe(0)
  })

  it('match the keys they are meant for', () => {
    const keymap = buildKeymap({})
    const hit = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean }) =>
      matchKeymap(keymap, {
        type: 'keyDown',
        key: code.startsWith('Arrow') || code.startsWith('F') ? code : 'x',
        code,
        control: mods.ctrl ?? false,
        alt: mods.alt ?? false,
        shift: mods.shift ?? false,
        meta: false,
      })?.id
    expect(hit('KeyF', { ctrl: true })).toBe('find')
    expect(hit('KeyG', { ctrl: true })).toBe('find.next')
    expect(hit('F3', {})).toBe('find.next')
    expect(hit('F3', { shift: true })).toBe('find.prev')
    expect(hit('KeyG', { ctrl: true, shift: true })).toBe('find.prev')
    expect(hit('KeyN', { alt: true, shift: true })).toBe('workspace.new')
    expect(hit('KeyR', { alt: true, shift: true })).toBe('workspace.rename')
    expect(hit('ArrowRight', { alt: true, shift: true })).toBe('workspace.next')
    expect(hit('ArrowLeft', { alt: true, shift: true })).toBe('workspace.prev')
    expect(hit('ArrowRight', { ctrl: true, alt: true, shift: true })).toBe('tab.workspace.next')
    expect(hit('ArrowLeft', { ctrl: true, alt: true, shift: true })).toBe('tab.workspace.prev')
    expect(hit('KeyH', { alt: true, shift: true })).toBe('home')
    expect(hit('Comma', { ctrl: true })).toBe('settings')
    expect(hit('KeyP', { ctrl: true })).toBe('print')
    expect(hit('KeyU', { ctrl: true })).toBe('source')
    expect(hit('KeyD', { alt: true, shift: true })).toBe('tab.duplicate')
    expect(hit('KeyP', { alt: true, shift: true })).toBe('tab.pin')
    expect(hit('KeyM', { ctrl: true })).toBe('tab.mute')
    expect(hit('KeyC', { alt: true, shift: true })).toBe('url.copy')
    expect(hit('KeyA', { ctrl: true, shift: true })).toBe('tab.search')
    expect(hit('KeyM', { alt: true, shift: true })).toBe('music')
  })
})

describe('page-first shortcuts', () => {
  it('name real actions and default chords', () => {
    for (const id of PAGE_FIRST_SHORTCUTS) expect(SHORTCUT_IDS).toContain(id)
    const defaults = new Set(Object.values(DEFAULT_SHORTCUTS).flat())
    for (const chord of PAGE_FIRST_CHORDS) {
      expect(normalizeChord(chord)).toBe(chord)
      expect(defaults.has(chord), chord).toBe(true)
    }
    expect(PAGE_FIRST_SHORTCUTS.has('tab.new')).toBe(false)
    expect(PAGE_FIRST_SHORTCUTS.has('palette')).toBe(false)
  })
})
