"use client"

import { useEffect, useState } from "react"
import { useTourStore } from "@/lib/tour/engine/store"
import { layoutMode, type Box } from "@/lib/tour/engine/geometry"

/**
 * The spotlight. It dims everything except the real element, and it is
 * deliberately click-through: a founder must be able to press the button the
 * tour is describing. A blocking scrim would turn an interactive tour into a
 * slideshow about buttons.
 */

const RING = "rounded-2xl"

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

export function TourSpotlight() {
  const box = useTourStore((s) => s.target.box)
  const state = useTourStore((s) => s.target.state)
  const status = useTourStore((s) => s.status)
  const viewport = useViewport()

  if (status !== "active") return null

  const mobile = layoutMode(viewport) === "mobile"

  if (!box || state !== "found") {
    // Nothing to point at: an explanation step, or a target that is not on
    // this page. Either way the interface stays usable and visible.
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[79] bg-black/45"
        data-tour-overlay="plain"
      />
    )
  }

  if (mobile) {
    // On a phone a hole punched around a small control reads as a glitch, and
    // the card needs the width. Dim, then let the sheet do the pointing.
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[79] bg-black/50"
        data-tour-overlay="mobile"
      />
    )
  }

  const style: React.CSSProperties = {
    top: box.top,
    left: box.left,
    width: box.width,
    height: Math.min(box.height, viewport.height - box.top - 8),
    // One huge shadow is the dim; the hole is the element itself.
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
  }

  return (
    <div aria-hidden="true" className="pointer-events-none fixed z-[79]" data-tour-overlay="spotlight">
      <div
        className={`${RING} border-2 border-primary/80 bg-transparent transition-all duration-200 motion-reduce:transition-none`}
        style={style}
      />
    </div>
  )
}

export function spotlightCenter(box: Box | null): { x: number; y: number } | null {
  if (!box) return null
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}
