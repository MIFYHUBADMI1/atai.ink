import { describe, it, expect } from "vitest"
import {
  computeDowngradeImpact,
  planCustomerInitiatedDowngrade,
  applyWebhookDowngrade,
  maxBusinessesForPlan,
} from "./downgrade"

describe("downgrade two-flow (Gate 6, §Issue 4)", () => {
  it("catalog is the single source of truth for caps", () => {
    expect(maxBusinessesForPlan("growth")).toBe(4)
    // Explorer holds one planning business (production is capped separately).
    expect(maxBusinessesForPlan("explorer")).toBe(1)
    expect(maxBusinessesForPlan("scale")).toBe("unlimited")
  })

  it("downgrade into Explorer keeps one planning business", () => {
    const impact = computeDowngradeImpact("growth", "explorer", 4)
    expect(impact.allowedBusinessesInToPlan).toBe(1)
    expect(impact.overLimit).toBe(3)
    expect(impact.requiresActiveSelection).toBe(true)
  })

  it("growth → starter with 4 businesses is over limit by 3", () => {
    const impact = computeDowngradeImpact("growth", "starter", 4)
    expect(impact.allowedBusinessesInToPlan).toBe(1)
    expect(impact.overLimit).toBe(3)
    expect(impact.requiresActiveSelection).toBe(true)
    expect(impact.preservedReadonlyCount).toBe(3)
  })

  it("downgrade into a capped plan counts the destination cap (unlimited source ignored)", () => {
    const impact = computeDowngradeImpact("scale", "growth", 10)
    expect(impact.allowedBusinessesInToPlan).toBe(4)
    expect(impact.overLimit).toBe(6)
    expect(impact.withinLimit).toBe(false)
  })

  it("a destination with unlimited cap never over-limits", () => {
    const impact = computeDowngradeImpact("growth", "scale", 10)
    expect(impact.allowedBusinessesInToPlan).toBe("unlimited")
    expect(impact.overLimit).toBe(0)
    expect(impact.withinLimit).toBe(true)
  })

  it("customer-initiated flow returns consequences without deleting data", () => {
    const planned = planCustomerInitiatedDowngrade("growth", "starter", 4, true)
    expect(planned.impact.overLimit).toBe(3)
    expect(planned.consequences.length).toBeGreaterThan(0)
    expect(planned.scheduledAtPeriodEnd).toBe(true)
  })

  it("webhook-driven flow preserves first N active, marks rest readonly", () => {
    const ids = ["b1", "b2", "b3", "b4"]
    const result = applyWebhookDowngrade("growth", "starter", 4, ids)
    // Starter allows 1 → first stays active, remaining 3 go readonly.
    expect(result.preservedReadonly).toEqual(["b2", "b3", "b4"])
    expect(result.chooseActiveSelector).toBe(true)
  })

  it("webhook-driven flow with no over-limit keeps everything active", () => {
    const ids = ["b1"]
    const result = applyWebhookDowngrade("starter", "growth", 1, ids)
    expect(result.preservedReadonly).toEqual([])
    expect(result.chooseActiveSelector).toBe(false)
  })
})
