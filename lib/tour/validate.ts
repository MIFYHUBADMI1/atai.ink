import { TOUR_TARGETS, isTourTargetId, targetRisk, type TourTargetId } from "./targets"
import { isTourRouteId, tourRouteScope } from "./routes"
import type { TourDefinition, TourStep } from "./types"

/**
 * Structural rules a tour must satisfy before it ships. These run in tests
 * (not in the browser) so a bad definition fails loudly during development
 * instead of dead-ending a founder mid-tour.
 */

const INTERACTIVE_KINDS = new Set(["click", "input", "action", "completion"])
const CREDIT_WORDS = /credit/i

export interface TourIssue {
  tour: string
  step?: string
  message: string
}

function validateStep(tour: TourDefinition, step: TourStep): TourIssue[] {
  const issues: TourIssue[] = []
  const at = (message: string) => issues.push({ tour: tour.id, step: step.id, message })

  if (!step.id || !step.title || !step.text) at("Steps need an id, a title and a description.")

  if (step.target !== undefined && !isTourTargetId(step.target)) {
    at(`Targets "${step.target}", which is not a registered element.`)
  } else if (step.target !== undefined && !TOUR_TARGETS[step.target as TourTargetId]) {
    at(`Targets "${step.target}", which no longer exists in the target registry.`)
  }

  if (step.route !== undefined && !isTourRouteId(step.route)) {
    at(`Navigates to "${step.route}", which is not a registered tour route.`)
  } else if (
    step.route !== undefined &&
    tourRouteScope(step.route) === "project" &&
    !step.requiresProject &&
    !tour.requiresProject
  ) {
    at("Navigates to a business page but does not mark requiresProject.")
  }

  if (INTERACTIVE_KINDS.has(step.kind)) {
    if (!step.instruction) at(`${step.kind} steps must tell the founder what to do.`)
    if (step.target !== undefined && targetRisk(step.target) !== "none") {
      at(
        `Asks the founder to operate "${step.target}", which is a ${targetRisk(step.target)} control. ` +
          "Spend, publish, payment and deletion controls may only be explained as information.",
      )
    }
  }

  if (step.costsCredits && !CREDIT_WORDS.test(`${step.text} ${step.instruction ?? ""} ${step.why ?? ""}`)) {
    at("Is marked costsCredits but never says credits are involved.")
  }

  if (step.verify) {
    if (step.verify.type === "element" && !isTourTargetId(step.verify.target)) {
      at("Verifies against an unregistered element.")
    }
    if (step.verify.type === "route" && !isTourRouteId(step.verify.route)) {
      at("Verifies against an unregistered route.")
    }
  }

  return issues
}

export function validateTour(tour: TourDefinition): TourIssue[] {
  const issues: TourIssue[] = []

  if (!tour.id || !tour.title || !tour.blurb) issues.push({ tour: tour.id ?? "?", message: "Missing id, title or blurb." })
  if (tour.minutes <= 0 || tour.minutes > 45) {
    issues.push({ tour: tour.id, message: "Estimated minutes must be between 1 and 45 — do not promise an hour." })
  }
  if (!isTourRouteId(tour.startRoute)) {
    issues.push({ tour: tour.id, message: `startRoute "${tour.startRoute}" is not registered.` })
  }
  if (tour.steps.length === 0) issues.push({ tour: tour.id, message: "Has no steps." })

  const seen = new Set<string>()
  for (const step of tour.steps) {
    if (seen.has(step.id)) issues.push({ tour: tour.id, step: step.id, message: "Duplicate step id." })
    seen.add(step.id)
    issues.push(...validateStep(tour, step))
  }

  // The first step should orient the founder before asking for work.
  const first = tour.steps[0]
  if (first && first.kind !== "info" && first.kind !== "navigate") {
    issues.push({ tour: tour.id, step: first.id, message: "Tours should open by explaining, not by demanding an action." })
  }

  return issues
}

export function validateTours(tours: TourDefinition[]): TourIssue[] {
  const issues: TourIssue[] = []
  const ids = new Set<string>()
  for (const tour of tours) {
    if (ids.has(tour.id)) issues.push({ tour: tour.id, message: "Duplicate tour id." })
    ids.add(tour.id)
    issues.push(...validateTour(tour))
  }
  return issues
}
