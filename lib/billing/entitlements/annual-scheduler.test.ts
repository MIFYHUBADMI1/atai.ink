import { describe, it, expect } from "vitest"
import { computeDueGrantMonths, addMonths, isAnnualSub, getCommercialPlanId } from "./annual-scheduler"
import type { SubscriptionRecord } from "@/lib/billing/billing-types"

function annualSub(over: Partial<SubscriptionRecord>): SubscriptionRecord {
  const start = Date.UTC(2026, 0, 1) // 2026-01-01
  return {
    id: "sub_1",
    userId: "user_1",
    dodoSubscriptionId: "dodo_1",
    planId: "business",
    planName: "Business",
    priceUSD: 2199.89,
    mirrorCredits: 0,
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: addMonths(start, 12),
    cancelAtPeriodEnd: false,
    billingCycle: "annual",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as SubscriptionRecord
}

describe("annual scheduler month math (Gate 5, §Issue 3)", () => {
  it("addMonths advances by whole months", () => {
    const start = Date.UTC(2026, 0, 15)
    expect(addMonths(start, 1)).toBe(Date.UTC(2026, 1, 15))
    expect(addMonths(start, 12)).toBe(Date.UTC(2027, 0, 15))
  })

  it("isAnnualSub detects the billing cycle", () => {
    expect(isAnnualSub(annualSub({}))).toBe(true)
    expect(isAnnualSub(annualSub({ billingCycle: "monthly" }))).toBe(false)
  })

  it("grants months whose window has begun, within the paid 12-month window", () => {
    const sub = annualSub({})
    const now = Date.UTC(2026, 2, 15) // mid-March (~2.5 months in)
    const due = computeDueGrantMonths(sub, true, now)
    // Months 0 (Jan), 1 (Feb), 2 (Mar) have begun; month 3 (Apr) has not.
    expect(due.map((d) => d.monthIndex)).toEqual([0, 1, 2])
  })

  it("stops granting when the annual payment did not succeed", () => {
    const sub = annualSub({})
    expect(computeDueGrantMonths(sub, false, Date.UTC(2026, 2, 15))).toEqual([])
  })

  it("does not grant after the paid window ends", () => {
    const sub = annualSub({})
    expect(computeDueGrantMonths(sub, true, addMonths(sub.currentPeriodStart, 13))).toEqual([])
  })

  it("does not grant if the subscription is cancelled", () => {
    const sub = annualSub({ status: "cancelled" })
    expect(computeDueGrantMonths(sub, true, Date.UTC(2026, 2, 15))).toEqual([])
  })

  it("resolves commercial plan id from stored field, else legacy", () => {
    expect(getCommercialPlanId(annualSub({}))).toBe("growth")
    expect(getCommercialPlanId(annualSub({ commercialPlanId: "scale", planId: "professional" }))).toBe("scale")
  })
})
