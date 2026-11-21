/**
 * Spotlight and tooltip geometry, as pure functions so the awkward cases
 * (tall elements, sticky headers, phones, a target already off-screen) are
 * tested without a browser.
 */

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** Space reserved for sticky app chrome so the ring never hides a control. */
export const STICKY_TOP = 64
export const PAD = 8
export const EDGE = 12

export type LayoutMode = "desktop" | "tablet" | "mobile"

export function layoutMode(viewport: Viewport): LayoutMode {
  if (viewport.width < 640) return "mobile"
  if (viewport.width < 1024) return "tablet"
  return "desktop"
}

/**
 * The ring drawn around a target. Zero-size boxes are rejected (a hidden tab
 * panel must not produce a spotlight in the top-left corner), and anything
 * taller than the viewport is clamped to a viewport-sized window with the
 * element scrolled inside it — a spotlight that covers the screen tells the
 * founder nothing.
 */
export function computeSpotlight(box: Box, viewport: Viewport, stickyTop = STICKY_TOP): Box | null {
  if (box.width <= 0 || box.height <= 0) return null

  const minTop = Math.max(EDGE, stickyTop)
  const maxVisible = Math.max(160, viewport.height - minTop - EDGE)
  // Pad both axes: a ring that hugs a 20px-tall control reads as a border on
  // the text rather than a highlight around a button.
  const height = Math.min(box.height + PAD * 2, maxVisible)
  let top = Math.max(minTop, box.top - PAD)
  if (top + height > viewport.height - EDGE) top = Math.max(minTop, viewport.height - EDGE - height)

  const width = Math.min(box.width + PAD * 2, viewport.width - EDGE * 2)
  const left = Math.min(Math.max(box.left - PAD, EDGE), Math.max(EDGE, viewport.width - width - EDGE))

  return { top, left, width, height }
}

export type TooltipSide = "top" | "bottom" | "overlay"

export interface TooltipPlacement {
  side: TooltipSide
  left: number
  top: number
  maxWidth: number
}

/**
 * Places the explanation card. On phones it is always a bottom sheet: a card
 * anchored to a small target on a 360px screen overlaps the very control it is
 * describing. On larger screens it goes on the side with more room — but only a
 * side that can actually hold it. A card clamped back into the viewport would
 * land on top of the ring and hide the thing being taught, which is worse than
 * putting it in the corner, so if neither side fits it becomes a sheet there too.
 */
export function placeTooltip(
  spotlight: Box,
  viewport: Viewport,
  card: { width: number; height: number },
  gap = 14,
): TooltipPlacement {
  const mode = layoutMode(viewport)
  const overlay = (): TooltipPlacement => ({
    side: "overlay",
    left: EDGE,
    top: viewport.height - card.height - EDGE,
    maxWidth: viewport.width - EDGE * 2,
  })

  if (mode === "mobile") return overlay()

  const width = Math.min(card.width, viewport.width - EDGE * 2)
  const roomBelow = viewport.height - (spotlight.top + spotlight.height)
  const roomAbove = spotlight.top
  const fitsBelow = roomBelow >= card.height + gap
  const fitsAbove = roomAbove >= card.height + gap

  if (!fitsBelow && !fitsAbove) return overlay()
  const side: TooltipSide = fitsBelow && fitsAbove ? (roomBelow >= roomAbove ? "bottom" : "top") : fitsBelow ? "bottom" : "top"

  const left = Math.min(Math.max(spotlight.left + spotlight.width / 2 - width / 2, EDGE), viewport.width - width - EDGE)
  const top = side === "bottom" ? spotlight.top + spotlight.height + gap : Math.max(EDGE, spotlight.top - card.height - gap)

  return { side, left, top, maxWidth: width }
}

/**
 * The card's width, in every state. A dragged card used to adopt the overlay's
 * full-width budget, so picking it up ballooned it to the width of the window —
 * the card must be the same size under the founder's finger as it was before.
 */
export function cardWidth(viewport: Viewport, preferred = 380): number {
  return Math.min(preferred, viewport.width - EDGE * 2)
}

/** A target sitting under the sticky header, or outside the viewport, needs
 * scrolling before it can be highlighted. */
export function needsScroll(box: Box, viewport: Viewport, stickyTop = STICKY_TOP): boolean {
  return box.top < stickyTop || box.top + box.height > viewport.height
}

export interface Point {
  x: number
  y: number
}

/**
 * Keep a dragged card on screen. A card wider than the phone viewport still
 * gets its left edge at the gutter rather than a negative offset, so it can
 * never be dragged somewhere it cannot be dragged back from.
 */
export function clampPosition(point: Point, card: { width: number; height: number }, viewport: Viewport): Point {
  const maxX = Math.max(EDGE, viewport.width - card.width - EDGE)
  const maxY = Math.max(EDGE, viewport.height - card.height - EDGE)
  return {
    x: Math.min(Math.max(point.x, EDGE), maxX),
    y: Math.min(Math.max(point.y, EDGE), maxY),
  }
}
