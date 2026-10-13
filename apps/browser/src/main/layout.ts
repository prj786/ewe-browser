import {
  EDGE_ZONE,
  RAIL_PEEK_SHADOW,
  RAIL_WIDTH,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  TOAST_HEIGHT,
  TOAST_MARGIN,
  TOAST_WIDTH,
  type OverlayPart,
  type Point,
  type Rect,
  type Size,
} from '@ewe/shared'

export type { Point }

const PAGE_MIN_WIDTH = 320

export type HoverZone = 'rail' | null

export function clampRect(rect: Rect, size: Size): Rect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), size.width)
  const y = Math.min(Math.max(0, Math.round(rect.y)), size.height)
  const width = Math.max(0, Math.min(Math.round(rect.width), size.width - x))
  const height = Math.max(0, Math.min(Math.round(rect.height), size.height - y))
  return { x, y, width, height }
}

export function pageBounds(reported: Rect | null, size: Size, inset = 0): Rect {
  const area = { width: Math.max(0, size.width - inset), height: size.height }
  if (reported === null) return { x: 0, y: 0, width: area.width, height: area.height }
  return clampRect(reported, area)
}

export function sidebarBounds(width: number, size: Size): Rect {
  const w = Math.min(Math.max(0, Math.round(width)), size.width)
  return { x: size.width - w, y: 0, width: w, height: size.height }
}

export function sidebarWidthFor(requested: number, windowWidth: number): number {
  const max = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, windowWidth - PAGE_MIN_WIDTH))
  return Math.round(Math.min(Math.max(requested, SIDEBAR_MIN), max))
}

export function overlayBounds(part: OverlayPart, full: Size, area?: Rect): Rect | null {
  const page = area ?? { x: 0, y: 0, width: full.width, height: full.height }
  switch (part) {
    case 'rail':
      return clampRect(
        { x: 0, y: 0, width: RAIL_WIDTH + RAIL_PEEK_SHADOW, height: full.height },
        full,
      )
    case 'palette':
    case 'menu':
      return { x: 0, y: 0, width: full.width, height: full.height }
    case 'toast': {
      const width = Math.min(TOAST_WIDTH, page.width)
      return clampRect(
        {
          x: page.x + Math.round((page.width - width) / 2),
          y: page.y + page.height - TOAST_MARGIN - TOAST_HEIGHT,
          width,
          height: TOAST_HEIGHT,
        },
        full,
      )
    }
    case 'none':
      return null
  }
}

export function hoverZone(point: Point, size: Size, zone = EDGE_ZONE): HoverZone {
  if (point.x < 0 || point.y < 0 || point.x > size.width || point.y > size.height) return null
  return point.x <= zone ? 'rail' : null
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
