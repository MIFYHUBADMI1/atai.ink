"use client"

import { create } from "zustand"
import { resolveTour, type ResolvedTour } from "./resolve"
import { getTour, type TourContext } from "../registry"
import type { TourProgress, TourStep } from "../types"
import type { Box } from "./geometry"

/**
 * Tour session state. It holds no DOM knowledge — the runtime hook measures
 * the page and reports what it found here, so the state machine stays
 * testable without a browser and cannot leave a founder staring at a spinner.
 */

export type TourStatus = "idle" | "active" | "paused" | "finished"
export type TargetState = "idle" | "searching" | "found" | "missing"

export const EMPTY_CONTEXT: TourContext = {
  features: {
    growth: true,
    marketStudio: true,
    studio: false,
    seoAudit: false,
    growthTasks: false,
    campaigns: false,
    lessons: false,
  },
  projectCount: 0,
}

interface ObservePatch {
  state?: TargetState
  label?: string | null
  box?: Box | null
  stepId?: string | null
}

export interface TourStore {
  status: TourStatus
  /** The heavy engine chunk is only loaded once a tour is really requested. */
  engineMounted: boolean
  tourId: string | null
  index: number
  projectId: string | null
  ctx: TourContext
  resolved: ResolvedTour | null
  progress: Record<string, TourProgress>
  target: { state: TargetState; label: string | null; box: Box | null; stepId: string | null }
  /** The founder confirmed the manual action for the current step. */
  confirmed: boolean
  /** Honest note: a step was removed, or its element was not on the page. */
  notice: string | null
  /** Bumped on every state change the persistence layer should flush. */
  revision: number

  start: (tourId: string, opts?: { atStep?: number; projectId?: string | null }) => boolean
  next: () => void
  prev: () => void
  skip: () => void
  pause: () => void
  resume: () => void
  exit: () => void
  finish: () => void
  restart: () => void
  confirm: () => void
  setNotice: (notice: string | null) => void
  observe: (patch: ObservePatch) => void
  setContext: (ctx: TourContext) => void
  setProjectId: (projectId: string | null) => void
  hydrate: (progress: Record<string, TourProgress>) => void
  /** Load the overlay chunk without starting anything (hover/focus warm-up). */
  mountEngine: () => void
  currentStep: () => TourStep | null
}

function recompute(
  state: Pick<TourStore, "tourId" | "ctx" | "projectId" | "index">,
): Pick<TourStore, "resolved" | "index"> {
  if (!state.tourId) return { resolved: null, index: state.index }
  const out = resolveTour(state.tourId, state.ctx, state.projectId)
  if (!out) return { resolved: null, index: 0 }
  const max = Math.max(0, out.resolved.steps.length - 1)
  return { resolved: out.resolved, index: Math.min(state.index, max) }
}

export const useTourStore = create<TourStore>((set, get) => ({
  status: "idle",
  engineMounted: false,
  tourId: null,
  index: 0,
  projectId: null,
  ctx: EMPTY_CONTEXT,
  resolved: null,
  progress: {},
  target: { state: "idle", label: null, box: null, stepId: null },
  confirmed: false,
  notice: null,
  revision: 0,

  start(tourId, opts) {
    const tour = getTour(tourId)
    if (!tour) return false
    const projectId = opts?.projectId ?? get().projectId
    const base = recompute({ tourId, ctx: get().ctx, projectId, index: 0 })
    const steps = base.resolved?.steps ?? []
    const stored = get().progress[tourId]
    // Resume where the founder left off unless they explicitly asked for a
    // specific step (the Tour Center does that with "Start over").
    const wanted = opts?.atStep ?? (stored && stored.status === "in-progress" ? stored.step : 0)
    const index = Math.min(Math.max(0, wanted), Math.max(0, steps.length - 1))
    set({
      tourId,
      projectId,
      index,
      status: "active",
      resolved: base.resolved,
      confirmed: false,
      notice: base.resolved && base.resolved.hidden.length > 0 ? `${base.resolved.hidden.length} stops are not available on your account.` : null,
      target: { state: "searching", label: null, box: null, stepId: steps[index]?.id ?? null },
      revision: get().revision + 1,
    })
    return true
  },

  next() {
    const { resolved, index } = get()
    const steps = resolved?.steps ?? []
    if (index >= steps.length - 1) {
      get().finish()
      return
    }
    set({
      index: index + 1,
      confirmed: false,
      target: { state: "searching", label: null, box: null, stepId: steps[index + 1]?.id ?? null },
      revision: get().revision + 1,
    })
  },

  prev() {
    const { resolved, index } = get()
    if (index <= 0) return
    const steps = resolved?.steps ?? []
    set({
      index: index - 1,
      confirmed: false,
      target: { state: "searching", label: null, box: null, stepId: steps[index - 1]?.id ?? null },
      revision: get().revision + 1,
    })
  },

  skip() {
    const { resolved, index, tourId, progress } = get()
    const step = resolved?.steps[index]
    if (tourId && step) {
      const entry = progress[tourId]
      set({
        progress: {
          ...progress,
          [tourId]: {
            step: index,
            status: "in-progress",
            updatedAt: Date.now(),
            skipped: [...new Set([...(entry?.skipped ?? []), step.id])].slice(0, 200),
          },
        },
      })
    }
    get().next()
  },

  pause() {
    if (get().status !== "active") return
    set({ status: "paused", target: { state: "idle", label: null, box: null, stepId: null }, revision: get().revision + 1 })
  },

  resume() {
    if (get().status !== "paused") return
    const { resolved, index } = get()
    set({
      status: "active",
      target: { state: "searching", label: null, box: null, stepId: resolved?.steps[index]?.id ?? null },
      revision: get().revision + 1,
    })
  },

  exit() {
    const { tourId, index, progress } = get()
    // Leaving is not completing, and is not forgetting. Progress stays so the
    // Tour Center can offer "Resume", and the business data is untouched.
    const entry = tourId ? progress[tourId] : undefined
    set({
      ...(tourId
        ? {
            progress: {
              ...progress,
              [tourId]: {
                step: index,
                status: entry?.status === "completed" ? ("completed" as const) : ("in-progress" as const),
                updatedAt: Date.now(),
                paused: true,
                skipped: entry?.skipped,
              },
            },
          }
        : {}),
      status: "idle",
      tourId: null,
      index: 0,
      resolved: null,
      confirmed: false,
      notice: null,
      target: { state: "idle", label: null, box: null, stepId: null },
      revision: get().revision + 1,
    })
  },

  finish() {
    const { tourId, progress, resolved, index } = get()
    const entry = tourId ? progress[tourId] : undefined
    set({
      ...(tourId
        ? {
            progress: {
              ...progress,
              [tourId]: {
                step: Math.max(0, (resolved?.steps.length ?? 1) - 1),
                status: "completed" as const,
                updatedAt: Date.now(),
                paused: false,
                skipped: entry?.skipped,
              },
            },
          }
        : {}),
      status: "finished",
      index: Math.max(0, (resolved?.steps.length ?? 1) - 1),
      target: { state: "idle", label: null, box: null, stepId: null },
      revision: get().revision + 1,
    })
  },

  restart() {
    const tourId = get().tourId ?? null
    if (!tourId) return
    get().start(tourId, { atStep: 0 })
  },

  confirm() {
    set({ confirmed: true, revision: get().revision + 1 })
  },

  setNotice(notice) {
    set({ notice })
  },

  observe(patch) {
    const next = get().target
    set({
      target: {
        state: patch.state ?? next.state,
        label: patch.label !== undefined ? patch.label : next.label,
        box: patch.box !== undefined ? patch.box : next.box,
        stepId: patch.stepId !== undefined ? patch.stepId : next.stepId,
      },
    })
  },

  setContext(ctx) {
    const base = recompute({ ...get(), ctx })
    set({ ctx, resolved: base.resolved, index: base.index, revision: get().revision + 1 })
  },

  setProjectId(projectId) {
    const base = recompute({ ...get(), projectId })
    set({ projectId, resolved: base.resolved, index: base.index, revision: get().revision + 1 })
  },

  hydrate(progress) {
    set({ progress })
  },

  mountEngine() {
    if (get().engineMounted) return
    set({ engineMounted: true })
  },

  currentStep() {
    const { resolved, index } = get()
    return resolved?.steps[index] ?? null
  },
}))

/** Read-only selector for components that must not re-render on DOM updates. */
export function selectVisibleStep(state: TourStore) {
  return state.status === "active" || state.status === "paused" ? (state.resolved?.steps[state.index] ?? null) : null
}

export function selectProgressFor(state: TourStore, tourId: string): TourProgress | undefined {
  return state.progress[tourId]
}
