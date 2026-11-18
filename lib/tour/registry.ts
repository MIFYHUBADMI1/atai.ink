import type { TourCategory, TourDefinition, TourFeatureFlags, TourStep } from "./types"
import { createBusinessTour, welcomeTour } from "./tours/getting-started"
import { existingBusinessTour } from "./tours/existing-business"
import { cofounderTour, workspaceTour } from "./tours/business"
import { hostingTour, marketTour } from "./tours/operations"
import { competitionTour, financesTour, intelligenceTour, learningTour } from "./tours/money"
import { PAGE_TOURS } from "./tours/pages"

const MAIN_TOURS: TourDefinition[] = [
  welcomeTour,
  createBusinessTour,
  existingBusinessTour,
  workspaceTour,
  cofounderTour,
  hostingTour,
  marketTour,
  financesTour,
  competitionTour,
  intelligenceTour,
  learningTour,
]

/** A founder's context: what they have, and which optional features are on. */
export interface TourContext {
  features: TourFeatureFlags
  projectCount: number
}

export const ALL_TOURS: TourDefinition[] = [...MAIN_TOURS, ...PAGE_TOURS]
export { MAIN_TOURS, PAGE_TOURS }

const BY_ID = new Map<string, TourDefinition>(ALL_TOURS.map((tour) => [tour.id, tour]))

export const TOUR_IDS: string[] = ALL_TOURS.map((tour) => tour.id)

export function getTour(id: string | null | undefined): TourDefinition | null {
  if (!id) return null
  return BY_ID.get(id) ?? null
}

/**
 * Whether to offer a tour at all. A step-level condition does not hide a tour;
 * it only removes that step when the engine runs — except for whole features,
 * where showing a tour of a switched-off page would be a lie.
 */
export function isTourAvailable(tour: TourDefinition, ctx: TourContext): boolean {
  if (tour.requiresFeature && !ctx.features[tour.requiresFeature]) return false
  if (tour.requiresProject && ctx.projectCount === 0) return false
  return true
}

/** Whether one step can be shown for this founder right now. */
export function isStepAvailable(step: TourStep, ctx: TourContext, projectId?: string): boolean {
  if (step.requiresFeature && !ctx.features[step.requiresFeature]) return false
  if (step.requiresProject && !projectId) return false
  return true
}

/**
 * How many stops of a tour this founder would actually be walked through.
 * The placeholder id only stands in for "has at least one business", which is
 * all `isStepAvailable` checks — no tour ever navigates by this value.
 */
export function visibleStepCount(tour: TourDefinition, ctx: TourContext): number {
  const project = ctx.projectCount > 0 ? "present" : undefined
  return tour.steps.filter((step) => isStepAvailable(step, ctx, project)).length
}

/** The short tour belonging to a page, if one exists. */
export function pageTourForRoute(route: string): TourDefinition | null {
  return ALL_TOURS.find((tour) => tour.id.startsWith("page-") && tour.startRoute === route) ?? null
}

/** Everything worth offering from a page: its own tour plus full tours that start there. */
export function toursForRoute(route: string): TourDefinition[] {
  return ALL_TOURS.filter((tour) => tour.startRoute === route)
}

export const TOUR_CATEGORY_ORDER: TourCategory[] = [
  "Getting started",
  "Building a business",
  "Managing a business",
  "Growing a business",
  "Understanding finances",
  "Advanced features",
]

export function availableToursByCategory(
  ctx: TourContext,
): Array<{ category: TourCategory; tours: TourDefinition[] }> {
  return TOUR_CATEGORY_ORDER.map((category) => ({
    category,
    tours: MAIN_TOURS.filter((tour) => tour.category === category && isTourAvailable(tour, ctx)),
  })).filter((group) => group.tours.length > 0)
}

/** Every element id any shipped tour expects to find in the real markup. */
export function referencedTargets(): string[] {
  const ids = new Set<string>()
  for (const tour of ALL_TOURS) {
    for (const step of tour.steps) {
      if (step.target) ids.add(step.target)
      if (step.verify?.type === "element") ids.add(step.verify.target)
    }
  }
  return [...ids]
}
