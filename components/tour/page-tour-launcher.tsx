"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { routeMayHavePageTour } from "@/lib/tour/entry-points"

/**
 * The per-page tour entry, mounted once inside the workspace shell so every
 * page gets it.
 *
 * It is deliberately a two-part component: tour definitions and the engine
 * store are a chunk of their own, and loading them is gated on the URL
 * actually owning a tour. A founder who never visits a tour-bearing page never
 * downloads a byte of tour content.
 */
const PageTourLauncherInner = dynamic(() => import("./page-tour-launcher-inner").then((m) => m.Inner), {
  ssr: false,
  loading: () => null,
})

export function PageTourLauncher() {
  const pathname = usePathname() ?? ""
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!routeMayHavePageTour(pathname)) {
      setReady(false)
      return
    }
    let alive = true
    void import("./page-tour-launcher-inner")
      .then(() => {
        if (alive) setReady(true)
      })
      .catch(() => {
        // No chunk (offline, blocked asset): the page works without the entry.
      })
    return () => {
      alive = false
    }
  }, [pathname])

  if (!ready) return null
  return <PageTourLauncherInner pathname={pathname} />
}
