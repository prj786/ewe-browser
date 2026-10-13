import { describe, expect, it } from 'vitest'
import { isSessionFile, sanitizeWindows } from '../../src/main/storage/session-store'

describe('isSessionFile', () => {
  it('accepts a well-formed file', () => {
    expect(
      isSessionFile({
        version: 1,
        windows: [{ bounds: null, tabs: [{ url: 'https://a.b/', title: 'a' }], activeIndex: 0 }],
      }),
    ).toBe(true)
  })

  it('accepts tabs with and without a pinned flag', () => {
    expect(
      isSessionFile({
        version: 1,
        windows: [
          {
            bounds: null,
            tabs: [
              { url: 'https://a.b/', title: 'a', pinned: true },
              { url: 'https://c.d/', title: 'c' },
            ],
            activeIndex: 0,
          },
        ],
      }),
    ).toBe(true)
    expect(
      isSessionFile({
        version: 1,
        windows: [
          {
            bounds: null,
            tabs: [{ url: 'https://a.b/', title: 'a', pinned: 'yes' }],
            activeIndex: 0,
          },
        ],
      }),
    ).toBe(false)
  })

  it('rejects malformed entries', () => {
    expect(isSessionFile({ version: 2, windows: [] })).toBe(false)
    expect(isSessionFile({ version: 1, windows: [{ tabs: [{ url: 1 }], activeIndex: 0 }] })).toBe(
      false,
    )
    expect(isSessionFile({ version: 1, windows: [{ tabs: [], activeIndex: 0.5 }] })).toBe(false)
    expect(
      isSessionFile({ version: 1, windows: [{ tabs: [], activeIndex: 0, bounds: { x: 1 } }] }),
    ).toBe(false)
  })
})

describe('sanitizeWindows', () => {
  it('keeps the home page tab', () => {
    const out = sanitizeWindows([
      { bounds: null, tabs: [{ url: 'app://home/', title: 'Home' }], activeIndex: 0 },
    ])
    expect(out[0]?.tabs.map((t) => t.url)).toEqual(['app://home/'])
  })

  it('keeps workspaces and clamps workspace indexes', () => {
    const out = sanitizeWindows([
      {
        bounds: null,
        tabs: [
          { url: 'https://a.b/', title: 'a', workspace: 1 },
          { url: 'https://c.d/', title: 'c', workspace: 9 },
        ],
        activeIndex: 0,
        workspaces: [
          { id: 'x', name: 'Home', color: 'ewellow' },
          { id: 'y', name: 'Deep work', color: 'sky' },
        ],
        activeWorkspace: 1,
      },
    ])
    expect(out[0]?.workspaces?.map((w) => w.name)).toEqual(['Home', 'Deep work'])
    expect(out[0]?.tabs.map((t) => t.workspace)).toEqual([1, 1])
    expect(out[0]?.activeWorkspace).toBe(1)
  })

  it('keeps the pinned flag and loads older tabs as unpinned', () => {
    const out = sanitizeWindows([
      {
        bounds: null,
        tabs: [
          { url: 'https://a.b/', title: 'a', pinned: true },
          { url: 'https://c.d/', title: 'c' },
        ],
        activeIndex: 1,
      },
    ])
    expect(out[0]?.tabs.map((t) => t.pinned)).toEqual([true, false])
  })

  it('keeps the open sidebar section and rejects unknown ones', () => {
    const win = { bounds: null, tabs: [{ url: 'https://a.b/', title: 'a' }], activeIndex: 0 }
    expect(sanitizeWindows([{ ...win, sidebar: 'downloads' }])[0]?.sidebar).toBe('downloads')
    expect(sanitizeWindows([win])[0]?.sidebar).toBeNull()
    expect(isSessionFile({ version: 1, windows: [{ ...win, sidebar: 'files' }] })).toBe(false)
  })

  it('drops unsafe urls and empty windows and clamps the active index', () => {
    const out = sanitizeWindows([
      {
        bounds: null,
        tabs: [
          { url: 'javascript:alert(1)', title: '' },
          { url: 'https://a.b/', title: 't' },
        ],
        activeIndex: 5,
      },
      { bounds: null, tabs: [{ url: 'data:text/html,hi', title: '' }], activeIndex: 0 },
    ])
    expect(out).toEqual([
      {
        bounds: null,
        tabs: [{ url: 'https://a.b/', title: 't', workspace: 0, pinned: false }],
        activeIndex: 0,
        workspaces: [],
        activeWorkspace: 0,
        sidebar: null,
      },
    ])
  })
})
