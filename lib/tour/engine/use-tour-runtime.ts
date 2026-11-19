"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { TOUR_TARGET_ATTR, TOUR_TARGETS, type TourTargetId } from "../targets"
import { useTourStore } from "./store"
import { routeForSteps } from "./resolve"
import { locationMatches, verifyTypeOf, verdictFor, waitBudget } from "./verify"
import { computeSpotlight, needsScroll } from "./geometry"

/**
 * Drives one step at a time against the real page: navigate if needed, find
 * the registered element, keep the ring aligned, and report honestly when the
 * thing being pointed at does not exist. It never clicks, types, submits,
 * publishes or spends on the founder's behalf.
 */

/**
 * Elements opt in with `data-atai-tour="<id>"`. The attribute is deliberately
 * NOT called `data-tour`: `components/marketing/market-guide.tsx` already uses
 * `data-tour` for its own page-guide anchors, and one element can only carry
 * one value. Two guidance products must not evict each other.
 *
 * Several elements can share an id (the workspace nav renders once for the
 * desktop rail and again inside the mobile drawer). The first VISIBLE match
 * wins, so a hidden duplicate can never read as "this control does not exist".
 */
function findTarget(id: TourTargetId): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(`[${TOUR_TARGET_ATTR}="${id}"]`)
  for (const el of matches) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return el
  }
  return null
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}`
}

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export interface TourRuntime {
  href: string
  searching: boolean
  missing: boolean
  verdict: "satisfied" | "waiting" | "manual" | "blocked"
}

export function useTourRuntime(): TourRuntime {
  const router = useRouter()
  const status = useTourStore((s) => s.status)
  const tourId = useTourStore((s) => s.tourId)
  const index = useTourStore((s) => s.index)
  const projectId = useTourStore((s) => s.projectId)
  const resolved = useTourStore((s) => s.resolved)
  const confirmed = useTourStore((s) => s.confirmed)
  const targetState = useTourStore((s) => s.target.state)
  const observe = useTourStore((s) => s.observe)

  const step = resolved?.steps[index] ?? null
  const active = status === "active" && !!step

  const [href, setHref] = useState("/")
  const [missing, setMissing] = useState(false)
  const navigatedFor = useRef<string | null>(null)

  // ── Location. `usePathname` is avoided here on purpose: the provider is
  // mounted at the root of every page, including statically prerendered
  // ones, and reading the query string there would need a Suspense boundary
  // per page. Tab-style tour destinations carry a query, so it is read from
  // the window after mount and re-checked while a tour is running.
  useEffect(() => {
    setHref(currentHref())
    const sync = () => setHref(currentHref())
    window.addEventListener("popstate", sync)
    const timer = window.setInterval(sync, 400)
    return () => {
      window.removeEventListener("popstate", sync)
      window.clearInterval(timer)
    }
  }, [])

  // ── Navigate to the page this step belongs to, at most once per step.
  const expected = useMemo(
    () => (resolved ? routeForSteps(resolved, index) : { route: "", needsProject: false }),
    [resolved, index],
  )

  useEffect(() => {
    if (!active || !expected.route) {
      navigatedFor.current = null
      return
    }
    if (locationMatches(expected.route, href)) {
      navigatedFor.current = null
      return
    }
    const key = `${tourId}:${step?.id ?? ""}`
    if (navigatedFor.current === key) return
    navigatedFor.current = key
    router.push(expected.route)
  }, [active, expected.route, href, router, step?.id, tourId])

  // ── Find and track the real element.
  const targetId = step?.target
  const stepId = step?.id ?? null

  useEffect(() => {
    if (!active) {
      observe({ state: "idle", box: null, label: null })
      return
    }

    // An explanation with no element to point at is still a real step.
    if (!targetId) {
      observe({ state: "found", box: null, label: null, stepId })
      setMissing(false)
      return
    }

    const label = TOUR_TARGETS[targetId].label

    // A business-scoped element cannot exist without a business. That is not
    // a failure to retry — say so and let the founder move on.
    if (step?.requiresProject && !projectId) {
      observe({ state: "missing", box: null, label })
      setMissing(true)
      return
    }

    setMissing(false)
    observe({ state: "searching", box: null, label, stepId })

    let placed = false
    let scrollTries = 0
    let retry = 0
    let frame = 0

    const measure = () => {
      const el = findTarget(targetId)
      if (!el) return
      const box = el.getBoundingClientRect()
      // Only chase the element into view the first few times. Once it has been
      // placed, the founder scrolling away is their choice, not a bug to undo.
      if (!placed && needsScroll(box, viewport()) && scrollTries < 3) {
        scrollTries += 1
        el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" })
        // Smooth scrolling emits scroll events that re-measure anyway; a
        // reduced-motion jump emits none, so schedule one.
        if (retry) window.clearTimeout(retry)
        retry = window.setTimeout(measure, prefersReducedMotion() ? 80 : 280)
        return
      }
      const spotlight = computeSpotlight(
        { top: box.top, left: box.left, width: box.width, height: box.height },
        viewport(),
      )
      observe({ state: "found", box: spotlight, label, stepId })
      placed = true
    }

    // DOM churn and scrolling are both bursty; one measurement per frame is
    // enough, and it keeps a highlight glued to a moving element for free.
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    measure()

    // The element usually arrives *after* this effect runs — with the page's
    // own data, or at the far end of a cross-page navigation. Re-measuring on
    // every mutation (not only once something was already found) is what lets a
    // step on a newly loaded page highlight the section it is describing.
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "style", TOUR_TARGET_ATTR, "open"],
    })

    window.addEventListener("scroll", schedule, { passive: true, capture: true })
    window.addEventListener("resize", schedule)

    const giveUpTimer = window.setTimeout(() => {
      if (placed) return
      observe({ state: "missing", box: null, label })
      setMissing(true)
    }, waitBudget(step ?? undefined))

    return () => {
      if (retry) window.clearTimeout(retry)
      if (frame) cancelAnimationFrame(frame)
      window.clearTimeout(giveUpTimer)
      observer.disconnect()
      window.removeEventListener("scroll", schedule, { capture: true })
      window.removeEventListener("resize", schedule)
    }
  }, [active, targetId, stepId, step?.requiresProject, projectId, observe])

  // ── Has the step genuinely happened?
  const verifyType = step ? verifyTypeOf(step) : "none"
  const verdict = verdictFor({
    verifyType,
    expectedHref: expected.route,
    currentHref: href,
    targetFound: targetState === "found",
    waitedOut: missing,
    userConfirmed: confirmed,
  })

  // Navigation steps continue by themselves once the app has really arrived.
  // Nothing else auto-advances: an action is not complete because somebody
  // pressed Next.
  const next = useTourStore((s) => s.next)
  const autoAdvanced = useRef<string | null>(null)
  useEffect(() => {
    if (!active || step?.kind !== "navigate" || verdict !== "satisfied") return
    const key = `${tourId}:${step.id}`
    if (autoAdvanced.current === key) return
    autoAdvanced.current = key
    const timer = window.setTimeout(() => next(), 500)
    return () => window.clearTimeout(timer)
  }, [active, step, verdict, next, tourId])

  return { href, searching: active && targetState === "searching", missing, verdict }
}

/** Element ids a step may point at, for tooling and tests. */
export const TARGETABLE = Object.keys(TOUR_TARGETS) as TourTargetId[]

/** Exported for tests and the keyboard layer. */
export function useTourKeyboard() {
  return useCallback((event: KeyboardEvent) => {
    const state = useTourStore.getState()
    if (state.status === "idle") return false
    const el = document.activeElement
    const typing =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    if (typing) return false
    // The card's drag handle owns the arrow keys: nudging the card is not
    // stepping the tour.
    if (el instanceof HTMLElement && el.closest("[data-tour-drag-handle]")) return false
    if (event.key === "Escape") {
      event.preventDefault()
      state.exit()
      return true
    }
    // Only a running tour takes the arrow keys. A paused or finished one has no
    // visible card, so stepping it would move the founder somewhere they cannot see.
    if (state.status !== "active") return false
    if (event.key === "ArrowRight") {
      event.preventDefault()
      state.next()
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      state.prev()
    }
    return true
  }, [])
}
