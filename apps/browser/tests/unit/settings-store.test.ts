import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@ewe/shared'
import { sanitizeSettings } from '../../src/main/storage/settings-store'

describe('sanitizeSettings', () => {
  it('applies known keys with valid values', () => {
    expect(
      sanitizeSettings(
        { rail: 'collapsed', searchEngine: 'kagi', theme: 'dark', tabStrip: 'always' },
        DEFAULT_SETTINGS,
      ),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      rail: 'collapsed',
      searchEngine: 'kagi',
      theme: 'dark',
    })
  })

  it('drops unknown keys and bad values', () => {
    const out = sanitizeSettings(
      { rail: 'sometimes', searchEngine: 42, tabAnimation: 'yes', evil: true },
      DEFAULT_SETTINGS,
    )
    expect(out).toEqual(DEFAULT_SETTINGS)
    expect('evil' in out).toBe(false)
  })

  it('returns the base for non-objects', () => {
    expect(sanitizeSettings('x', DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS)
  })

  it('validates the shortcuts map strictly', () => {
    const out = sanitizeSettings(
      {
        shortcuts: {
          reload: ['ctrl+j', 'junk'],
          'tab.new': 'Ctrl+J',
          nope: ['Ctrl+T'],
          'tab.close': ['Ctrl+1-9'],
        },
      },
      DEFAULT_SETTINGS,
    )
    expect(out.shortcuts).toEqual({ reload: ['Ctrl+J'] })
    expect(sanitizeSettings({ shortcuts: 7 }, DEFAULT_SETTINGS).shortcuts).toEqual({})
  })

  it('replaces the whole map on update and keeps it when the patch has none', () => {
    const base = { ...DEFAULT_SETTINGS, shortcuts: { reload: ['Ctrl+J'] } }
    expect(sanitizeSettings({ theme: 'dark' }, base).shortcuts).toEqual({ reload: ['Ctrl+J'] })
    expect(sanitizeSettings({ shortcuts: {} }, base).shortcuts).toEqual({})
  })

  it('clamps the sidebar width', () => {
    expect(sanitizeSettings({ sidebarWidth: 420.4 }, DEFAULT_SETTINGS).sidebarWidth).toBe(420)
    expect(sanitizeSettings({ sidebarWidth: 10 }, DEFAULT_SETTINGS).sidebarWidth).toBe(280)
    expect(sanitizeSettings({ sidebarWidth: 5000 }, DEFAULT_SETTINGS).sidebarWidth).toBe(640)
    expect(sanitizeSettings({ sidebarWidth: 'wide' }, DEFAULT_SETTINGS).sidebarWidth).toBe(360)
  })
})
