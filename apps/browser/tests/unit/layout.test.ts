import { describe, expect, it } from 'vitest'
import {
  clampRect,
  hoverZone,
  overlayBounds,
  pageBounds,
  sameRect,
  sidebarBounds,
  sidebarWidthFor,
} from '../../src/main/layout'

const size = { width: 1200, height: 800 }

describe('pageBounds', () => {
  it('fills the window when the shell reports no slot', () => {
    expect(pageBounds(null, size)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })

  it('uses the reported slot, clamped to the window', () => {
    expect(pageBounds({ x: 0, y: 44, width: 1200, height: 756 }, size)).toEqual({
      x: 0,
      y: 44,
      width: 1200,
      height: 756,
    })
    expect(pageBounds({ x: -5, y: 44, width: 5000, height: 5000 }, size)).toEqual({
      x: 0,
      y: 44,
      width: 1200,
      height: 756,
    })
  })

  it('rounds fractional css pixels', () => {
    expect(clampRect({ x: 0.4, y: 43.6, width: 1199.5, height: 756.4 }, size)).toEqual({
      x: 0,
      y: 44,
      width: 1200,
      height: 756,
    })
  })
})

describe('overlayBounds', () => {
  it('peeks the rail on the left at full height and covers the window for menus', () => {
    expect(overlayBounds('rail', size)).toEqual({ x: 0, y: 0, width: 288, height: 800 })
    expect(overlayBounds('palette', size)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(overlayBounds('menu', size)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(overlayBounds('none', size)).toBeNull()
  })

  it('stops the rail peek above the bottom bar', () => {
    expect(overlayBounds('rail', size, undefined, 32)).toEqual({
      x: 0,
      y: 0,
      width: 288,
      height: 768,
    })
    expect(overlayBounds('menu', size, undefined, 32)).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    })
  })

  it('centres the toast at the bottom of the page area', () => {
    expect(overlayBounds('toast', size)).toEqual({ x: 420, y: 728, width: 360, height: 56 })
    expect(overlayBounds('toast', size, { x: 272, y: 8, width: 920, height: 784 })).toEqual({
      x: 552,
      y: 720,
      width: 360,
      height: 56,
    })
    expect(overlayBounds('toast', { width: 300, height: 400 })).toEqual({
      x: 0,
      y: 328,
      width: 300,
      height: 56,
    })
  })
})

describe('hoverZone', () => {
  it('reveals the rail at the left edge only', () => {
    expect(hoverZone({ x: 0, y: 400 }, size)).toBe('rail')
    expect(hoverZone({ x: 12, y: 10 }, size)).toBe('rail')
    expect(hoverZone({ x: 13, y: 400 }, size)).toBeNull()
    expect(hoverZone({ x: 600, y: 0 }, size)).toBeNull()
    expect(hoverZone({ x: 20, y: 400 }, size, 24)).toBe('rail')
    expect(hoverZone({ x: -1, y: 400 }, size)).toBeNull()
  })
})

describe('sameRect', () => {
  it('compares rects and nulls', () => {
    expect(sameRect(null, null)).toBe(true)
    expect(sameRect({ x: 0, y: 0, width: 1, height: 1 }, null)).toBe(false)
    expect(sameRect({ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 })).toBe(
      true,
    )
  })
})

describe('sidebar layout', () => {
  it('pins the sidebar to the right edge at full height', () => {
    expect(sidebarBounds(360, size)).toEqual({ x: 840, y: 0, width: 360, height: 800 })
  })

  it('leaves the bottom bar uncovered', () => {
    expect(sidebarBounds(360, size, 32)).toEqual({ x: 840, y: 0, width: 360, height: 768 })
  })

  it('narrows the page by the sidebar inset, also inside a reported slot', () => {
    expect(pageBounds(null, size, 360)).toEqual({ x: 0, y: 0, width: 840, height: 800 })
    expect(pageBounds({ x: 0, y: 44, width: 1200, height: 756 }, size, 360)).toEqual({
      x: 0,
      y: 44,
      width: 840,
      height: 756,
    })
  })

  it('keeps the toast over the narrowed page while menus cover the window', () => {
    const page = pageBounds(null, size, 360)
    expect(overlayBounds('toast', size, page)).toMatchObject({ x: 240, width: 360 })
    expect(overlayBounds('menu', size, page)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })

  it('clamps the width between the limits and leaves room for the page', () => {
    expect(sidebarWidthFor(100, 1200)).toBe(280)
    expect(sidebarWidthFor(900, 1600)).toBe(640)
    expect(sidebarWidthFor(600, 800)).toBe(480)
    expect(sidebarWidthFor(600, 500)).toBe(280)
  })
})

describe('page rect snapping', () => {
  it('snaps a rect reported from a fractionally scaled shell to the page gap', () => {
    expect(
      pageBounds({ x: 264, y: 8, width: 562, height: 818 }, { width: 1193, height: 834 }, 360),
    ).toEqual({
      x: 264,
      y: 8,
      width: 825 - 264,
      height: 818,
    })
    expect(
      pageBounds({ x: 264, y: 8, width: 500, height: 818 }, { width: 1193, height: 834 }, 360)
        .width,
    ).toBe(500)
  })
})
