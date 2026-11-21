"use client"

import { useEffect, useState } from "react"
import { useTourStore } from "@/lib/tour/engine/store"
import { layoutMode, EDGE, type Box } from "@/lib/tour/engine/geometry"

/**
 * The spotlight. It dims everything except the real element, and it is
 * deliberately click-through: a founder must be able to press the button the
 * tour is describing. A blocking scrim would turn an interactive tour into a
 * slideshow about buttons.
 *
 * The ring is absolutely positioned inside the fixed overlay. Without that it
 * is a static block at (0,0) and every `top`/`left` the engine measures is
 * silently ignored — the tour then dims the page and points at the top-left
 * corner instead of the control it is explaining.
 */

const RING = "rounded-2xl"
const DIM = "0 0 0 9999px rgba(0,0,0,0.62)"
const GLOW = "0 0 0 4px rgba(255,255,255,0.92), 0 0 26px 6px rgba(59,130,246,0.5)"

function useViewport() {
  const [size, setSize] = useState({ width: 1280, height: 800 })
  useEffect(() => {
    const sync = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    sync()
    window.addEventListener("resize", sync)
    return () => window.removeEventListener("resize", sync)
  }, [])
  return size
}

/** The label sits above the ring when there is room, else just below it. */
function labelPosition(box: Box, viewport: { width: number; height: number }) {
  const above = box.top - 30
  const top = above >= EDGE ? above : Math.min(box.top + box.height + 8, viewport.height - 30)
  const left = Math.min(Math.max(box.left, EDGE), Math.max(EDGE, viewport.width - EDGE - 220))
  const maxWidth = Math.max(140, Math.min(420, viewport.width - left - EDGE))
  return { top, left, maxWidth }
}

export function TourSpotlight() {
  const box = useTourStore((s) => s.target.box)
  const state = useTourStore((s) => s.target.state)
  const label = useTourStore((s) => s.target.label)
  const status = useTourStore((s) => s.status)
  const viewport = useViewport()

  if (status !== "active") return null

  if (!box || state !== "found") {
    // An explanation step points at nothing, so dimming the page would leave a
    // dark screen with no highlight — the exact "I am lost" moment this overlay
    // is meant to prevent. Keep the page fully readable. A step whose target was
    // expected but is absent still gets a light scrim, so the card's note about
    // the missing control reads as deliberate rather than as a broken screen.
    if (!label) return null
    return <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[79] bg-black/30" data-tour-overlay="plain" />
  }

  const mobile = layoutMode(viewport) === "mobile"
  const labelSpot = labelPosition(box, viewport)

  const style: React.CSSProperties = {
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
    boxShadow: `${DIM}, ${GLOW}`,
  }

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[79]" data-tour-overlay="spotlight">
      {/* The hole is the element itself; the huge shadow is the dim. On a phone
          the ring is smaller and the card is a bottom sheet, but the element is
          still ringed — a dim with no highlight is what makes people lost. */}
      <div
        className={`absolute ${RING} ${mobile ? "border" : "border-2"} border-primary bg-transparent transition-all duration-200 motion-reduce:transition-none`}
        style={style}
      />
      {label ? (
        <span
          className="absolute inline-flex max-w-[min(90vw,420px)] items-center gap-1 truncate rounded-full border border-primary/40 bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground shadow-lg"
          style={labelSpot}
        >
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden />
          {label}
        </span>
      ) : null}
    </div>
  )
}

export function spotlightCenter(box: Box | null): { x: number; y: number } | null {
  if (!box) return null
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}
