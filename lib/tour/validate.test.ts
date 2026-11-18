import { describe, expect, it } from "vitest"
import { ALL_TOURS, MAIN_TOURS, PAGE_TOURS, TOUR_IDS, getTour, isTourAvailable, visibleStepCount, type TourContext } from "./registry"
import { validateTour, validateTours } from "./validate"
import type { TourDefinition, TourStep } from "./types"

/**
 * The rules that keep a tour honest are only worth having if they actually
 * fire, so this file checks both directions: every shipped definition passes,
 * and each rule rejects a deliberately broken copy of a real step.
 */

const CONTEXT: TourContext = {
  features: {
    growth: true,
    marketStudio: true,
    studio: true,
    seoAudit: true,
    growthTasks: true,
    campaigns: true,
    lessons: true,
  },
  projectCount: 2,
}

describe("shipped tours", () => {
  it("are all structurally valid", () => {
    expect(validateTours(ALL_TOURS)).toEqual([])
  })

  it("have unique ids and every id resolves", () => {
    expect(TOUR_IDS.length).toBe(ALL_TOURS.length)
    expect(new Set(TOUR_IDS).size).toBe(TOUR_IDS.length)
    for (const id of TOUR_IDS) expect(getTour(id)?.id).toBe(id)
  })

  it("offer ten full walkthroughs plus at least one tour per page", () => {
    expect(MAIN_TOURS.length).toBeGreaterThanOrEqual(10)
    expect(PAGE_TOURS.length).toBeGreaterThanOrEqual(10)
  })

  it("chain into a next tour rather than ending in a dead end", () => {
    for (const tour of MAIN_TOURS) {
      if (!tour.offerNext) continue
      expect(getTour(tour.offerNext), `${tour.id} offers an unknown tour`).not.toBeNull()
    }
  })

  it("never shrink to nothing on a brand new account", () => {
    const fresh: TourContext = { ...CONTEXT, projectCount: 0 }
    const starter = MAIN_TOURS.filter((tour) => isTourAvailable(tour, fresh))
    expect(starter.length).toBeGreaterThan(0)
    for (const tour of starter) {
      expect(visibleStepCount(tour, fresh), `${tour.id} has no visible stops`).toBeGreaterThan(0)
    }
  })

  it("hide a tour when its feature is switched off", () => {
    const off: TourContext = { ...CONTEXT, features: { ...CONTEXT.features, seoAudit: false } }
    const hidden = MAIN_TOURS.filter((tour) => tour.requiresFeature === "seoAudit")
    for (const tour of hidden) expect(isTourAvailable(tour, off)).toBe(false)
  })
})

function step(overrides: Partial<TourStep>): TourStep {
  return {
    id: "probe",
    kind: "info",
    title: "Probe",
    text: "A step used only to prove a rule fires.",
    ...overrides,
  } as TourStep
}

function tourWith(stepValue: TourStep): TourDefinition {
  return {
    id: "probe-tour",
    title: "Probe tour",
    blurb: "Proves a validation rule.",
    category: "Getting started",
    minutes: 3,
    startRoute: "dashboard",
    steps: [step({ id: "open", kind: "info", title: "Open", text: "Orienting first stop." }), stepValue],
  }
}

const messages = (stepValue: TourStep) =>
  validateTour(tourWith(stepValue)).map((issue) => issue.message).join(" | ")

describe("validation rules", () => {
  it("rejects an unregistered element", () => {
    expect(messages(step({ target: "does-not-exist" as never }))).toMatch(/not a registered element/i)
  })

  it("rejects an unregistered route", () => {
    expect(messages(step({ route: "nowhere" as never }))).toMatch(/not a registered tour route/i)
  })

  it("refuses to ask the founder to operate a control that spends credits", () => {
    const text = "Press it and credits are spent, shown on the button first."
    expect(messages(step({ kind: "click", target: "market-launch-kit", instruction: text, text }))).toMatch(
      /credits control|may only be explained as information/i,
    )
  })

  it("refuses to ask the founder to operate a payment, publish or delete control", () => {
    for (const target of ["settings-billing-checkout", "app-publish", "env-manager"] as const) {
      expect(messages(step({ kind: "action", target, instruction: "Do it yourself here." })), target).toMatch(
        /may only be explained as information/i,
      )
    }
  })

  it("allows a free control to be operated", () => {
    expect(messages(step({ kind: "click", target: "cofounder-input", instruction: "Ask one question." }))).toBe("")
  })

  it("requires an interactive step to say what to do", () => {
    expect(messages(step({ kind: "input", target: "cofounder-input" }))).toMatch(/must tell the founder what to do/i)
  })

  it("requires a business before sending a founder to a business page", () => {
    expect(messages(step({ route: "projectPlan" }))).toMatch(/does not mark requiresProject/i)
  })

  it("requires credit-spending copy to mention credits", () => {
    expect(messages(step({ costsCredits: true, text: "This runs the research." }))).toMatch(/never says credits/i)
  })

  it("rejects an unverifiable promise: verifying against something unregistered", () => {
    expect(messages(step({ verify: { type: "element", target: "ghost" as never } }))).toMatch(/unregistered element/i)
  })

  it("rejects a tour that estimates an implausible length", () => {
    const long = { ...tourWith(step({})), minutes: 90 }
    expect(validateTour(long).map((i) => i.message).join()).toMatch(/between 1 and 45/)
  })

  it("opens by explaining rather than demanding", () => {
    const demanding = { ...tourWith(step({})), steps: [step({ id: "act", kind: "action", target: "cofounder-input" })] }
    expect(validateTour(demanding).map((i) => i.message).join()).toMatch(/open by explaining/i)
  })

  it("catches duplicate step ids", () => {
    const dupe = { ...tourWith(step({ id: "open" })) }
    expect(validateTour(dupe).map((i) => i.message).join()).toMatch(/Duplicate step id/)
  })
})
