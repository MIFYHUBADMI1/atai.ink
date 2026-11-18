"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useSession } from "@/lib/client/api"
import { useTourRuntime, useTourKeyboard } from "@/lib/tour/engine/use-tour-runtime"
import { useTourStore } from "@/lib/tour/engine/store"
import { fetchTourStatus, mergeProgress, mirrorProgress, readMirroredProgress, saveTourProgress } from "@/lib/tour/engine/persist"
import { TourCard, TourPausedPill } from "./tour-card"
import { TourSpotlight } from "./tour-spotlight"

/**
 * The overlay layer itself. `TourRoot` mounts this lazily, so a founder who
 * never opens a tour never pays for these effects, observers or this code.
 * It owns hydration, persistence, the keyboard, and the single portal the
 * overlay renders into — pages only declare targets and offer launch points.
 */
export function TourLayer() {
  const { session } = useSession()
  const status = useTourStore((s) => s.status)
  const runtime = useTourRuntime()
  const onKey = useTourKeyboard()
  const [mounted, setMounted] = useState(false)
  const [missionOpen, setMissionOpen] = useState(false)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => setMounted(true), [])

  // The existing first-run overlay owns the dashboard. Two guidance products
  // must not point at the same screen at the same time: while it is open this
  // tour keeps its overlay and launchers out of the way.
  useEffect(() => {
    const check = () => setMissionOpen(Boolean(document.querySelector("[data-onboarding-mission]")))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  // Hydrate stored progress and the founder's feature context.
  const hydrate = useTourStore((s) => s.hydrate)
  const setContext = useTourStore((s) => s.setContext)
  useEffect(() => {
    if (!session) return
    let cancelled = false
    fetchTourStatus()
      .then((res) => {
        if (cancelled) return
        setContext(res.context)
        const local = readMirroredProgress(session.userId)
        hydrate(mergeProgress(res.progress, local))
      })
      .catch(() => {
        if (cancelled) return
        const local = readMirroredProgress(session.userId)
        if (local) hydrate(local)
      })
    return () => {
      cancelled = true
    }
  }, [session, hydrate, setContext])

  // Which business is in front of the founder. The URL is authoritative; if a
  // tour is started elsewhere, fall back to no business and let the engine
  // say so honestly rather than guessing which one they meant.
  const setProjectId = useTourStore((s) => s.setProjectId)
  useEffect(() => {
    const match = window.location.pathname.match(/^\/project\/([^/?#]+)/)
    setProjectId(match ? decodeURIComponent(match[1]) : null)
  }, [status, runtime.href, setProjectId])

  // Persist progress: debounced, and mirrored locally so a refresh mid-tour
  // resumes even before the request lands.
  const revision = useTourStore((s) => s.revision)
  const tourId = useTourStore((s) => s.tourId)
  const index = useTourStore((s) => s.index)
  useEffect(() => {
    if (!session || !tourId) return
    const state = useTourStore.getState()
    const entry = state.progress[tourId]
    if (!entry) return
    mirrorProgress(session.userId, state.progress)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTourProgress({
        tourId,
        step: entry.step,
        status: entry.status,
        paused: entry.paused ?? state.status === "paused",
        skipped: entry.skipped,
      }).catch(() => {
        // Offline or expired session: the local mirror already holds the truth.
      })
    }, 700)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [revision, tourId, index, session])

  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKeyRef.current(event)
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  if (!mounted || missionOpen || status === "idle") return null

  return createPortal(
    <div data-tour-scope="engine">
      <TourSpotlight />
      <TourCard runtime={runtime} />
      <TourPausedPill />
    </div>,
    document.body,
  )
}
