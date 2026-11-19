import { describe, expect, it } from "vitest"
import { EDGE, STICKY_TOP, clampPosition, computeSpotlight, layoutMode, needsScroll, placeTooltip } from "./geometry"

/**
 * Layout is checked at the sizes the product is actually used at, measured in
 * device pixels — a desktop window dragged narrower is not a phone. The card is
 * the engine's real size (380x320); a placement that overflows any of these
 * viewports would hide the control it is describing.
 */

const DEVICES = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 15", width: 393, height: 852 },
  { name: "small Android", width: 360, height: 640 },
  { name: "iPad portrait", width: 768, height: 1024 },
  { name: "iPad landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
] as const

const CARD = { width: 380, height: 320 }

describe("layout mode", () => {
  it("splits at the same widths the styles use", () => {
    expect(layoutMode({ width: 360, height: 640 })).toBe("mobile")
    expect(layoutMode({ width: 639, height: 800 })).toBe("mobile")
    expect(layoutMode({ width: 640, height: 800 })).toBe("tablet")
    expect(layoutMode({ width: 1023, height: 800 })).toBe("tablet")
    expect(layoutMode({ width: 1024, height: 800 })).toBe("desktop")
  })
})

describe("the spotlight", () => {
  it("refuses to ring a hidden element in the corner", () => {
    // A collapsed tab panel measures 0x0 at (0,0); spotlighting that would
    // confidently point at nothing.
    expect(computeSpotlight({ top: 0, left: 0, width: 0, height: 0 }, { width: 1440, height: 900 })).toBeNull()
    expect(computeSpotlight({ top: 100, left: 100, width: 120, height: 0 }, { width: 1440, height: 900 })).toBeNull()
  })

  it.each(DEVICES)("stays inside the viewport on a $name", ({ width, height }) => {
    const box = computeSpotlight({ top: 40, left: width - 30, width: 200, height: 40 }, { width, height })!
    expect(box.left).toBeGreaterThanOrEqual(EDGE)
    expect(box.left + box.width).toBeLessThanOrEqual(width - EDGE)
  })

  it.each(DEVICES)("never hides behind the sticky header on a $name", ({ width, height }) => {
    const box = computeSpotlight({ top: 8, left: 20, width: 120, height: 32 }, { width, height })!
    expect(box.top).toBeGreaterThanOrEqual(STICKY_TOP)
  })

  it.each(DEVICES)("clamps an element taller than the screen on a $name", ({ width, height }) => {
    const box = computeSpotlight({ top: 70, left: 16, width: width - 32, height: 4000 }, { width, height })!
    expect(box.height).toBeLessThanOrEqual(height)
    expect(box.top + box.height).toBeLessThanOrEqual(height - EDGE + box.height * 0)
    expect(box.top + box.height).toBeLessThanOrEqual(height)
  })
})

describe("the explanation card", () => {
  it.each(DEVICES)("fits the whole screen on a $name", ({ width, height }) => {
    const spotlight = computeSpotlight({ top: 120, left: 40, width: 240, height: 48 }, { width, height })!
    const placed = placeTooltip(spotlight, { width, height }, CARD)
    const left = placed.left
    const right = placed.side === "overlay" ? width - EDGE : left + placed.maxWidth
    expect(left).toBeGreaterThanOrEqual(EDGE)
    expect(right).toBeLessThanOrEqual(width - EDGE + 0.001)
    expect(placed.maxWidth).toBeLessThanOrEqual(width)
    // Mobile is a bottom sheet anchored by CSS, so its top is unused.
    if (placed.side !== "overlay") {
      expect(placed.top).toBeGreaterThanOrEqual(EDGE)
      expect(placed.top + CARD.height).toBeLessThanOrEqual(height)
    }
  })

  it("becomes a bottom sheet on a phone, whatever the target", () => {
    // Anchoring to a small control on a 360px screen covers the control.
    for (const target of [
      { top: 70, left: 12, width: 120, height: 32 },
      { top: 600, left: 200, width: 140, height: 44 },
    ]) {
      const spotlight = computeSpotlight(target, { width: 360, height: 640 })!
      expect(placeTooltip(spotlight, { width: 360, height: 640 }, CARD).side).toBe("overlay")
    }
  })

  it("prefers below a target with room, and above when there is none", () => {
    const viewport = { width: 1440, height: 900 }
    const low = computeSpotlight({ top: 700, left: 200, width: 300, height: 40 }, viewport)!
    expect(placeTooltip(low, viewport, CARD).side).toBe("top")
    const high = computeSpotlight({ top: 80, left: 200, width: 300, height: 40 }, viewport)!
    expect(placeTooltip(high, viewport, CARD).side).toBe("bottom")
  })

  it("narrows rather than overflowing a tablet", () => {
    const viewport = { width: 700, height: 500 }
    const spotlight = computeSpotlight({ top: 90, left: 20, width: 640, height: 40 }, viewport)!
    const placed = placeTooltip(spotlight, viewport, { width: 380, height: 320 })
    expect(placed.maxWidth).toBeLessThanOrEqual(viewport.width - EDGE * 2)
    expect(placed.left + placed.maxWidth).toBeLessThanOrEqual(viewport.width - EDGE + 0.001)
  })
})

describe("scrolling before highlighting", () => {
  it("flags a target under the header or below the fold", () => {
    const viewport = { width: 1440, height: 900 }
    expect(needsScroll({ top: 30, left: 100, width: 200, height: 40 }, viewport)).toBe(true)
    expect(needsScroll({ top: 880, left: 100, width: 200, height: 200 }, viewport)).toBe(true)
    expect(needsScroll({ top: 300, left: 100, width: 200, height: 40 }, viewport)).toBe(false)
  })
})

describe("dragging the card anywhere on screen", () => {
  it("keeps the whole card inside every real device", () => {
    for (const device of DEVICES) {
      const viewport = { width: device.width, height: device.height }
      const cases = [
        { x: -500, y: -500 },
        { x: 0, y: 0 },
        { x: device.width + 400, y: device.height + 400 },
        { x: device.width / 2, y: device.height / 2 },
      ]
      for (const point of cases) {
        const moved = clampPosition(point, CARD, viewport)
        expect(moved.x, `${device.name} ${JSON.stringify(point)}`).toBeGreaterThanOrEqual(EDGE)
        expect(moved.y, device.name).toBeGreaterThanOrEqual(EDGE)
        expect(moved.x + Math.min(CARD.width, viewport.width - EDGE * 2), device.name).toBeLessThanOrEqual(viewport.width)
        expect(moved.y + CARD.height, device.name).toBeLessThanOrEqual(viewport.height)
      }
    }
  })

  it("lets a card drop where it was released when there is room", () => {
    const viewport = { width: 1440, height: 900 }
    expect(clampPosition({ x: 300, y: 200 }, CARD, viewport)).toEqual({ x: 300, y: 200 })
  })

  it("never leaves a phone card wider than the screen", () => {
    const viewport = { width: 360, height: 640 }
    const wide = clampPosition({ x: 999, y: 120 }, { width: 380, height: 320 }, viewport)
    expect(wide.x).toBe(EDGE)
    expect(wide.y).toBeLessThanOrEqual(viewport.height - 320 - EDGE)
  })
})

describe("the card never sits on the thing it explains", () => {
  it("leaves the spotlight box clear at every size", () => {
    for (const device of DEVICES) {
      const viewport = { width: device.width, height: device.height }
      const boxes = [
        { top: 80, left: 40, width: 320, height: 90 },
        { top: 300, left: 60, width: 200, height: 200 },
        { top: viewport.height - 140, left: 30, width: 260, height: 120 },
      ]
      for (const raw of boxes) {
        const spotlight = computeSpotlight(raw, viewport)
        if (!spotlight) continue
        const placed = placeTooltip(spotlight, viewport, CARD)
        if (placed.side === "overlay") continue
        const cardTop = placed.top
        const cardBottom = placed.top + CARD.height
        const clear = cardTop >= spotlight.top + spotlight.height || cardBottom <= spotlight.top
        expect(clear, `${device.name} ${JSON.stringify(spotlight)} -> ${JSON.stringify(placed)}`).toBe(true)
      }
    }
  })
})
