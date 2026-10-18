import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, pageMenuItems } from '@ewe/shared'
import { findPrefill, ownsFind } from '../../src/main/find'
import {
  FIND_HEIGHT,
  FIND_WIDTH,
  SWIPE_BOX,
  overlayBounds,
  swipeBounds,
} from '../../src/main/layout'
import {
  buildPageMenu,
  needsSafeProbe,
  savePageName,
  selectionUrlOf,
  shownUrl,
  type PageMenuContext,
  type PageMenuParams,
} from '../../src/main/page-menu-model'
import { isPageFirst, matchShortcut } from '../../src/main/shortcuts'
import { extensionIdFromKey, storeIdAt } from '../../src/main/extension-helpers'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeSettings } from '../../src/main/storage/settings-store'

const params = (patch: Partial<PageMenuParams> = {}): PageMenuParams => ({
  linkURL: '',
  linkText: '',
  srcURL: '',
  mediaType: 'none',
  hasImageContents: false,
  isEditable: false,
  selectionText: '',
  misspelledWord: '',
  dictionarySuggestions: [],
  formControlType: 'none',
  editFlags: {
    canUndo: false,
    canRedo: false,
    canCut: false,
    canCopy: false,
    canPaste: false,
    canSelectAll: false,
  },
  mediaFlags: { isPaused: false, isMuted: false, isLooping: false, isControlsVisible: false },
  ...patch,
})

const ctx: PageMenuContext = {
  menuId: 'm',
  engine: 'duckduckgo',
  engineName: 'DuckDuckGo',
  pageUrl: 'https://example.org/a',
  canGoBack: true,
  canGoForward: false,
  bookmarkable: true,
  bookmarked: false,
  safe: null,
}

describe('buildPageMenu', () => {
  it('turns a plain right-click into the page menu', () => {
    const menu = buildPageMenu(params(), ctx)
    expect(menu).toMatchObject({
      menuId: 'm',
      engine: 'DuckDuckGo',
      link: null,
      media: null,
      edit: null,
      selection: '',
      page: { back: true, forward: false, web: true },
    })
    expect(buildPageMenu(params(), { ...ctx, pageUrl: 'app://settings/' }).page.web).toBe(false)
  })

  it('keeps links and marks only web links openable', () => {
    const link = buildPageMenu(
      params({ linkURL: 'https://example.org/b', linkText: '  Read   more  ' }),
      ctx,
    ).link
    expect(link).toEqual({ url: 'https://example.org/b', text: 'Read more', openable: true })
    expect(buildPageMenu(params({ linkURL: 'javascript:alert(1)' }), ctx).link?.openable).toBe(
      false,
    )
    expect(buildPageMenu(params({ linkURL: 'app://settings/' }), ctx).link?.openable).toBe(false)
  })

  it('describes images and media from their flags', () => {
    const image = buildPageMenu(
      params({ mediaType: 'image', srcURL: 'data:image/png;base64,AA', hasImageContents: true }),
      ctx,
    ).media
    expect(image).toMatchObject({ kind: 'image', openable: false, savable: true, copyable: true })
    const video = buildPageMenu(
      params({
        mediaType: 'video',
        srcURL: 'blob:https://example.org/1',
        mediaFlags: { isPaused: true, isMuted: false, isLooping: true, isControlsVisible: true },
      }),
      ctx,
    ).media
    expect(video).toMatchObject({
      kind: 'video',
      openable: false,
      savable: true,
      copyable: false,
      paused: true,
      loop: true,
      controls: true,
    })
    expect(buildPageMenu(params({ mediaType: 'canvas' }), ctx).media).toBeNull()
    expect(buildPageMenu(params({ mediaType: 'image' }), ctx).media).toBeNull()
  })

  it('trims the selection and spots a url in it', () => {
    const menu = buildPageMenu(params({ selectionText: '  example.org/path  ' }), ctx)
    expect(menu.selection).toBe('example.org/path')
    expect(menu.selectionUrl).toBe('https://example.org/path')
    expect(selectionUrlOf('two words', 'google')).toBeNull()
    expect(selectionUrlOf('~/Documents', 'google')).toBeNull()
    expect(selectionUrlOf('javascript:alert(1)', 'google')).toBeNull()
    expect(buildPageMenu(params({ selectionText: 'x'.repeat(5000) }), ctx).selection).toHaveLength(
      1000,
    )
  })

  it('carries edit flags, five suggestions and the Safe field kind', () => {
    const menu = buildPageMenu(
      params({
        isEditable: true,
        formControlType: 'input-password',
        misspelledWord: 'sheeep',
        dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: true,
          canCopy: true,
          canPaste: true,
          canSelectAll: true,
        },
      }),
      { ...ctx, safe: 'new-password' },
    )
    expect(menu.edit).toMatchObject({ undo: true, redo: false, safe: 'new-password' })
    expect(menu.edit?.suggestions).toEqual(['a', 'b', 'c', 'd', 'e'])
    const items = pageMenuItems(menu).filter((e) => e.type === 'item')
    expect(items.map((e) => e.action)).toContain('safe.generate')
  })

  it('asks the page about Safe only for text-like inputs', () => {
    expect(needsSafeProbe({ isEditable: true, formControlType: 'input-password' })).toBe(true)
    expect(needsSafeProbe({ isEditable: true, formControlType: 'input-email' })).toBe(true)
    expect(needsSafeProbe({ isEditable: true, formControlType: 'text-area' })).toBe(false)
    expect(needsSafeProbe({ isEditable: true, formControlType: 'none' })).toBe(false)
    expect(needsSafeProbe({ isEditable: false, formControlType: 'input-text' })).toBe(false)
  })
})

describe('save page names', () => {
  it('uses a cleaned title, else the host', () => {
    expect(savePageName('Flock / Notes: today?', 'https://example.org')).toBe(
      'Flock Notes today.html',
    )
    expect(savePageName('', 'https://wiki.example.org/x')).toBe('wiki.example.org.html')
    expect(savePageName('...hidden', 'https://example.org')).toBe('hidden.html')
    expect(Buffer.byteLength(savePageName('a'.repeat(300), 'https://example.org'))).toBe(200)
    expect(
      Buffer.byteLength(savePageName('ჭ'.repeat(300), 'https://example.org')),
    ).toBeLessThanOrEqual(200)
    expect(savePageName('...', 'https://example.org')).toBe('example.org.html')
  })
})

describe('find', () => {
  it('prefills from a short selection, else the last query', () => {
    expect(findPrefill('  wool  bale ', 'old')).toBe('wool bale')
    expect(findPrefill('', 'old')).toBe('old')
    expect(findPrefill('x'.repeat(201), 'old')).toBe('old')
    expect(findPrefill(42, '')).toBe('')
  })

  it('leaves Ctrl+F to pages with their own search', () => {
    expect(ownsFind('app://files/?path=%2F')).toBe(true)
    expect(ownsFind('app://music/')).toBe(true)
    expect(ownsFind('app://history/')).toBe(true)
    expect(ownsFind('app://settings/')).toBe(false)
    expect(ownsFind('https://files.example.org/')).toBe(false)
  })

  it('maps the find keys in main', () => {
    const key = (code: string, control = false, shift = false) =>
      matchShortcut({ type: 'keyDown', key: code, code, control, shift, alt: false, meta: false })
    expect(key('KeyF', true)).toEqual({ action: 'find' })
    expect(key('F3')).toEqual({ action: 'find.next' })
    expect(key('F3', false, true)).toEqual({ action: 'find.prev' })
  })
})

describe('find and swipe overlay rects', () => {
  const full = { width: 1280, height: 820 }
  const page = { x: 264, y: 8, width: 1008, height: 780 }

  it('puts the find bar at the top right of the page', () => {
    expect(overlayBounds('find', full, page)).toEqual({
      x: 264 + 1008 - FIND_WIDTH,
      y: 8,
      width: FIND_WIDTH,
      height: FIND_HEIGHT,
    })
    const narrow = { x: 0, y: 0, width: 300, height: 400 }
    expect(overlayBounds('find', full, narrow)).toMatchObject({ x: 0, width: 300 })
    expect(overlayBounds('swipe', full, page)).toBeNull()
  })

  it('centres the swipe arrow on the edge it points to', () => {
    expect(swipeBounds('back', page, full)).toEqual({
      x: 264,
      y: 8 + (780 - SWIPE_BOX) / 2,
      width: SWIPE_BOX,
      height: SWIPE_BOX,
    })
    expect(swipeBounds('forward', page, full).x).toBe(264 + 1008 - SWIPE_BOX)
  })
})

describe('gesture settings', () => {
  it('default to on and survive a bad patch', () => {
    expect(DEFAULT_SETTINGS.gestures).toEqual({ swipe: true })
    expect(sanitizeSettings({ gestures: { swipe: false } }, DEFAULT_SETTINGS).gestures).toEqual({
      swipe: false,
    })
    expect(sanitizeSettings({ gestures: 'off' }, DEFAULT_SETTINGS).gestures).toEqual({
      swipe: true,
    })
    expect(sanitizeSettings({}, DEFAULT_SETTINGS).gestures).toEqual({ swipe: true })
  })
})

describe('view source tabs', () => {
  it('keep the view-source: address after the load', () => {
    expect(shownUrl('view-source:https://a.example/', 'https://a.example/')).toBe(
      'view-source:https://a.example/',
    )
    expect(shownUrl('https://b.example/', 'https://b.example/')).toBe('https://b.example/')
  })
})

const BITWARDEN_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmqKbvreshyXRuN2gikeR1idqR6KL0Di89JZcMyD4bjJRZVmQO7aznSGSALIHzSAUGYocUYBNDOP5QAhImxXyQ1qG8+goXs93v9GzrNJETdVuCEhqBggC4/DFabryJZDiKvZ2Jl0DM7MsWdoybZPwrj70V3aJ/nVNOMkf868scNTMliwitCqqjT5baTANsG0DkZWQExD4lSXzSZHH9MEO8q0iZ7RRlNuGRBAkZgNV8FwZRsPKm/rwQ9dy3VpgLcmLp5GiMt+kAEncqKAkuRYnhVXXBsKqIyYTMjHSLkLnpfFySyOPLBdS617i/PGNiP/MT6Xy6z//v5NozUgaAZ4gJQIDAQAB'

describe('extension ids before loading', () => {
  it('derive the store id from manifest.key', () => {
    expect(extensionIdFromKey(BITWARDEN_KEY)).toBe('nngceckbapebfimnlniiiahkandclblb')
    expect(extensionIdFromKey('')).toBeNull()
  })

  it('read the id from the manifest key, else from the store folder name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ewe-ext-id-'))
    const keyed = join(root, 'whatever', '1.0.0_0')
    mkdirSync(keyed, { recursive: true })
    writeFileSync(join(keyed, 'manifest.json'), JSON.stringify({ key: BITWARDEN_KEY }))
    expect(await storeIdAt(keyed)).toBe('nngceckbapebfimnlniiiahkandclblb')
    const plain = join(root, 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', '8.0_0')
    mkdirSync(plain, { recursive: true })
    writeFileSync(join(plain, 'manifest.json'), '{}')
    expect(await storeIdAt(plain)).toBe('aeblfdkhhhdcdjpifhhbdiojplfjncoa')
    const unpacked = join(root, 'my-extension')
    mkdirSync(unpacked)
    writeFileSync(join(unpacked, 'manifest.json'), '{}')
    expect(await storeIdAt(unpacked)).toBeNull()
  })
})

describe('page-first shortcuts', () => {
  const key = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
    type: 'keyDown',
    key: code,
    code,
    control: mods.ctrl ?? false,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false,
    meta: false,
  })
  const first = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => {
    const input = key(code, mods)
    const action = matchShortcut(input)
    return action === null ? null : isPageFirst(action, input)
  }

  it('lets pages have the keys web apps bind', () => {
    expect(first('KeyF', { ctrl: true })).toBe(true)
    expect(first('KeyU', { ctrl: true })).toBe(true)
    expect(first('KeyP', { ctrl: true })).toBe(true)
    expect(first('KeyM', { ctrl: true })).toBe(true)
    expect(first('KeyG', { ctrl: true })).toBe(true)
    expect(first('F3')).toBe(true)
    expect(first('Comma', { ctrl: true })).toBe(true)
    expect(first('ArrowRight', { alt: true, shift: true })).toBe(true)
    expect(first('KeyH', { alt: true, shift: true })).toBe(true)
  })

  it('keeps the browser keys first', () => {
    expect(first('KeyT', { ctrl: true })).toBe(false)
    expect(first('KeyW', { ctrl: true })).toBe(false)
    expect(first('KeyL', { ctrl: true })).toBe(false)
    expect(first('KeyK', { ctrl: true })).toBe(false)
    expect(first('Tab', { ctrl: true })).toBe(false)
    expect(first('ArrowRight', { ctrl: true, alt: true })).toBe(false)
    expect(first('Home', { alt: true })).toBe(false)
    expect(first('Digit2', { alt: true, shift: true })).toBe(false)
    expect(first('KeyL', { ctrl: true, shift: true })).toBe(false)
  })
})
