import type { Point, Rect, Size } from './models'

export const MENU_MARGIN = 8
export const MENU_INSET = 4

function placeAxis(start: number, size: number, limit: number, margin: number): number {
  if (start + size + margin <= limit) return Math.max(margin, start)
  const fallback = Math.max(margin, limit - size - margin)
  if (start - size >= margin) return Math.min(start - size, fallback)
  return fallback
}

export function placeMenu(anchor: Point, size: Size, viewport: Size, margin = MENU_MARGIN): Point {
  return {
    x: placeAxis(anchor.x, size.width, viewport.width, margin),
    y: placeAxis(anchor.y, size.height, viewport.height, margin),
  }
}

export function placeAbove(
  anchor: Point,
  size: Size,
  viewport: Size,
  inset = MENU_INSET,
  margin = MENU_MARGIN,
): Point {
  const x = Math.max(
    margin,
    Math.min(anchor.x - size.width / 2, viewport.width - size.width - margin),
  )
  const above = anchor.y - inset - size.height
  const y = above >= margin ? above : Math.max(margin, viewport.height - size.height - margin)
  return { x: Math.round(x), y: Math.round(y) }
}

export type MenuSide = 'right' | 'left'

export function placeSubmenu(
  row: Rect,
  size: Size,
  viewport: Size,
  inset = MENU_INSET,
  margin = MENU_MARGIN,
  prefer: MenuSide = 'right',
): Point {
  const right = row.x + row.width
  const fitsRight = right + size.width + margin <= viewport.width
  const fitsLeft = row.x - size.width >= margin
  const goLeft = prefer === 'left' ? fitsLeft || !fitsRight : !fitsRight
  const x = goLeft ? Math.max(margin, row.x - size.width) : right
  const y = Math.max(margin, Math.min(row.y - inset, viewport.height - size.height - margin))
  return { x, y }
}
