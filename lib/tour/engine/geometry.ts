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

  const maxVisible = Math.max(160, viewport.height - stickyTop - EDGE * 2)
  const height = Math.min(box.height, maxVisible)
  let top = Math.max(stickyTop, box.top)
  if (top + height > viewport.height - EDGE) top = Math.max(stickyTop, viewport.height - EDGE - height)

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
 * describing. On larger screens it prefers the side with more room.
 */
export function placeTooltip(
  spotlight: Box,
  viewport: Viewport,
  card: { width: number; height: number },
): TooltipPlacement {
  const mode = layoutMode(viewport)
  if (mode === "mobile") {
    return { side: "overlay", left: EDGE, top: viewport.height - card.height - EDGE, maxWidth: viewport.width - EDGE * 2 }
  }

  const width = Math.min(card.width, viewport.width - EDGE * 2)
  const roomBelow = viewport.height - (spotlight.top + spotlight.height)
  const roomAbove = spotlight.top
  const side: TooltipSide = roomBelow >= card.height + 24 || roomAbove < roomBelow ? "bottom" : "top"

  const left = Math.min(Math.max(spotlight.left + spotlight.width / 2 - width / 2, EDGE), viewport.width - width - EDGE)
  const top =
    side === "bottom"
      ? Math.min(spotlight.top + spotlight.height + 14, viewport.height - card.height - EDGE)
      : Math.max(spotlight.top - card.height - 14, EDGE)

  return { side, left, top, maxWidth: width }
}

/** A target sitting under the sticky header, or outside the viewport, needs
 * scrolling before it can be highlighted. */
export function needsScroll(box: Box, viewport: Viewport, stickyTop = STICKY_TOP): boolean {
  return box.top < stickyTop || box.top + box.height > viewport.height
}
