import { describe, expect, it } from 'vitest'
import { placeAbove, placeMenu, placeSubmenu } from './menu'

const viewport = { width: 1200, height: 800 }
const size = { width: 220, height: 300 }

describe('placeMenu', () => {
  it('opens at the pointer when the menu fits', () => {
    expect(placeMenu({ x: 100, y: 20 }, size, viewport)).toEqual({ x: 100, y: 20 })
  })

  it('flips to the other side of the pointer at the right and bottom edges', () => {
    expect(placeMenu({ x: 1100, y: 20 }, size, viewport)).toEqual({ x: 880, y: 20 })
    expect(placeMenu({ x: 100, y: 700 }, size, viewport)).toEqual({ x: 100, y: 400 })
  })

  it('keeps a margin from the window edges', () => {
    expect(placeMenu({ x: 2, y: 3 }, size, viewport)).toEqual({ x: 8, y: 8 })
    expect(placeMenu({ x: 150, y: 100 }, size, { width: 300, height: 200 })).toEqual({
      x: 72,
      y: 8,
    })
  })
})

describe('placeSubmenu', () => {
  const row = { x: 100, y: 200, width: 220, height: 28 }
  const sub = { width: 200, height: 120 }

  it('sits to the right of the row with its first item aligned to the row', () => {
    expect(placeSubmenu(row, sub, viewport)).toEqual({ x: 320, y: 196 })
  })

  it('flips to the left when there is no room on the right', () => {
    expect(placeSubmenu({ ...row, x: 950 }, sub, viewport)).toEqual({ x: 750, y: 196 })
  })

  it('shifts up to stay inside the window', () => {
    expect(placeSubmenu({ ...row, y: 760 }, sub, viewport)).toEqual({ x: 320, y: 672 })
    expect(placeSubmenu({ ...row, y: 2 }, sub, viewport)).toEqual({ x: 320, y: 8 })
  })
})

describe('placeSubmenu with a preferred side', () => {
  const row = { x: 500, y: 200, width: 220, height: 28 }
  const sub = { width: 200, height: 120 }

  it('keeps cascading to the left once a parent flipped, and comes back when there is no room', () => {
    expect(placeSubmenu(row, sub, viewport, 4, 8, 'left')).toEqual({ x: 300, y: 196 })
    expect(placeSubmenu({ ...row, x: 100 }, sub, viewport, 4, 8, 'left')).toEqual({
      x: 320,
      y: 196,
    })
    expect(placeSubmenu(row, sub, viewport, 4, 8, 'right')).toEqual({ x: 720, y: 196 })
    expect(
      placeSubmenu({ ...row, x: 100 }, sub, { width: 300, height: 800 }, 4, 8, 'left'),
    ).toEqual({ x: 8, y: 196 })
  })
})

describe('placeAbove', () => {
  const popover = { width: 284, height: 320 }

  it('centres the panel on the anchor and sits above it', () => {
    expect(placeAbove({ x: 600, y: 760 }, popover, viewport)).toEqual({ x: 458, y: 436 })
  })

  it('keeps the margin at the sides and falls back to the bottom when there is no room above', () => {
    expect(placeAbove({ x: 1190, y: 760 }, popover, viewport)).toEqual({ x: 908, y: 436 })
    expect(placeAbove({ x: 10, y: 760 }, popover, viewport)).toEqual({ x: 8, y: 436 })
    expect(placeAbove({ x: 600, y: 100 }, popover, viewport)).toEqual({ x: 458, y: 472 })
  })
})

describe('placeMenu clamping', () => {
  it('keeps a menu inside the viewport when the pointer lies outside it', () => {
    expect(
      placeMenu({ x: 30, y: 784 }, { width: 220, height: 300 }, { width: 1371, height: 553 }),
    ).toEqual({
      x: 30,
      y: 245,
    })
  })
})
