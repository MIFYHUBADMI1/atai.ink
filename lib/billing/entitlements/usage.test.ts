import { describe, it, expect } from "vitest"
import { computeUsageAlerts, USAGE_WARN_RATIO } from "./usage"
import { buildEntitlementSet } from "./catalog"

const growth = buildEntitlementSet("growth", { businesses: 1, productionApps: 1, subdomains: 0, customDomainsConsumed: 0 })

describe("computeUsageAlerts (missing-area: usage alerts)", () => {
  it("warns when credits cross the 80% threshold", () => {
    const alerts = computeUsageAlerts(growth, { creditsUsed: 320_000, creditsTotal: 400_000, businessCount: 1 })
    expect(alerts.creditUsageRatio).toBeCloseTo(0.8)
    expect(alerts.creditsNearLimit).toBe(true)
    expect(alerts.creditsAtLimit).toBe(false)
    expect(alerts.warnings.some((w) => w.includes("80%"))).toBe(true)
  })

  it("flags at-limit when fully consumed", () => {
    const alerts = computeUsageAlerts(growth, { creditsUsed: 400_000, creditsTotal: 400_000, businessCount: 1 })
    expect(alerts.creditsAtLimit).toBe(true)
    expect(alerts.creditUsageRatio).toBe(1)
  })

  it("stays quiet well under the threshold", () => {
    const alerts = computeUsageAlerts(growth, { creditsUsed: 100_000, creditsTotal: 400_000, businessCount: 1 })
    expect(alerts.creditsNearLimit).toBe(false)
    expect(alerts.creditsAtLimit).toBe(false)
    expect(alerts.warnings).toHaveLength(0)
  })

  it("warns as business slots run low (growth = 4 cap)", () => {
    const alerts = computeUsageAlerts(growth, { creditsUsed: 0, creditsTotal: 400_000, businessCount: 3 })
    expect(alerts.businessCapNear).toBe(true)
    expect(alerts.businessCapReached).toBe(false)
  })

  it("flags business cap reached", () => {
    const alerts = computeUsageAlerts(growth, { creditsUsed: 0, creditsTotal: 400_000, businessCount: 4 })
    expect(alerts.businessCapReached).toBe(true)
  })

  it("never warns about unlimited business plans", () => {
    const scale = buildEntitlementSet("scale", { businesses: 50, productionApps: 50, subdomains: 0, customDomainsConsumed: 0 })
    const alerts = computeUsageAlerts(scale, { creditsUsed: 0, creditsTotal: 1_200_000, businessCount: 50 })
    expect(alerts.businessCapReached).toBe(false)
    expect(alerts.businessCapNear).toBe(false)
  })

  it("exposes the configured warn ratio", () => {
    expect(USAGE_WARN_RATIO).toBe(0.8)
  })
})
