"use client"

import dynamic from "next/dynamic"
import { useEffect } from "react"
import { useClientStore } from "@/lib/store/client-store"
import { useTourStore } from "@/lib/tour/engine/store"

/**
 * The engine is lazy on purpose. A founder who never opens a tour should not
 * pay for its code, its observers or its store — so nothing here is in the
 * initial bundle until a launcher is used for the first time.
 *
 * `ssr: false` is legal because this module is already a client boundary
 * (Next 16 forbids it from a Server Component directly).
 */
const TourLayer = dynamic(() => import("./tour-runtime").then((m) => m.TourLayer), {
  ssr: false,
  loading: () => null,
})

export function TourRoot() {
  const session = useClientStore((s) => s.session)
  const projects = useClientStore((s) => s.projects)
  const engineMounted = useTourStore((s) => s.engineMounted)

  // The engine needs a business id to highlight project-scoped elements and
  // to build project URLs. Both already live in the session store — mirror
  // them in so the lazy chunk has no data dependency of its own.
  useEffect(() => {
    const state = useTourStore.getState()
    const id = projects[0]?.id ?? null
    if (state.projectId !== id) state.setProjectId(id)
    const count = session ? projects.length : 0
    if (state.ctx.projectCount !== count) state.setContext({ ...state.ctx, projectCount: count })
  }, [projects, session])

  return engineMounted ? <TourLayer /> : null
}

/** Called by every launcher: wakes the engine, then starts the tour. */
export async function requestTour(
  tourId: string,
  opts?: { atStep?: number; projectId?: string | null },
): Promise<void> {
  useTourStore.getState().mountEngine()
  useTourStore.getState().start(tourId, opts)
}

/** Prefetch without showing anything — used on page hover/focus of a launcher. */
export function preloadTourEngine(): void {
  if (useTourStore.getState().engineMounted) return
  void import("./tour-runtime")
}
