import { getTour, isStepAvailable, type TourContext } from "../registry"
import { resolveTourRoute } from "../routes"
import type { TourDefinition, TourStep } from "../types"

/**
 * A tour is a list of steps, but a founder only ever sees the steps that exist
 * for them: a switched-off feature, or a business-scoped step with no
 * business, is removed rather than failed. Positions are always relative to
 * this resolved list, so "Step 4 of 11" is truthful.
 */
export interface ResolvedTour {
  tour: TourDefinition
  steps: TourStep[]
  /** Steps that were dropped, for the honest "not available to you" note. */
  hidden: TourStep[]
  projectId: string | null
}

export function resolveTour(
  tourId: string,
  ctx: TourContext,
  projectId: string | null,
): { tour: TourDefinition; resolved: ResolvedTour } | null {
  const tour = getTour(tourId)
  if (!tour) return null
  const visible: TourStep[] = []
  const hidden: TourStep[] = []
  for (const step of tour.steps) {
    if (isStepAvailable(step, ctx, projectId ?? undefined)) visible.push(step)
    else hidden.push(step)
  }
  return { tour, resolved: { tour, steps: visible, hidden, projectId } }
}

/**
 * The path a step must be viewed on: its own `route`, else the previous
 * step's route, else the tour's start route. Steps inherit a page so the
 * engine does not navigate pointlessly between stops on the same screen.
 */
export function routeForSteps(resolved: ResolvedTour, index: number): { route: string; needsProject: boolean } {
  for (let i = index; i >= 0; i -= 1) {
    const step = resolved.steps[i]
    if (step?.route) {
      return {
        route: safeHref(step.route, resolved.projectId),
        needsProject: Boolean(step.requiresProject),
      }
    }
  }
  return { route: safeHref(resolved.tour.startRoute, resolved.projectId), needsProject: Boolean(resolved.tour.requiresProject) }
}

/** Never throws at render time: an unresolvable project route means the
 * founder has no business, and the engine handles that as a missing step. */
export function safeHref(routeId: string, projectId: string | null): string {
  try {
    return resolveTourRoute(routeId as never, projectId ?? undefined)
  } catch {
    return ""
  }
}

export function stepTitle(resolved: ResolvedTour, index: number): string | null {
  return resolved.steps[index]?.title ?? null
}

/** Minutes still to spend, rounded up, from the tour's own estimate. */
export function remainingMinutes(totalMinutes: number, steps: number, index: number): number {
  if (steps <= 0) return 0
  const perStep = totalMinutes / steps
  return Math.max(1, Math.ceil(perStep * (steps - index)))
}
