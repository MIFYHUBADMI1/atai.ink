import { describe, expect, it } from "vitest"
import { PERMANENT_CREDIT_PACKS, SUBSCRIPTION_PLANS } from "./config"
import { adviseUpgrade, parseRequiredCredits } from "./upgrade-options"

const catalog = { plans: SUBSCRIPTION_PLANS, packs: PERMANENT_CREDIT_PACKS }

describe("parseRequiredCredits", () => {
  it("reads grouped and underscored amounts", () => {
    expect(parseRequiredCredits("100,000")).toBe(100_000)
    expect(parseRequiredCredits("100_000")).toBe(100_000)
    expect(parseRequiredCredits(" 75000 ")).toBe(75_000)
  })

  it("treats anything unusable as unknown rather than guessing", () => {
    expect(parseRequiredCredits(null)).toBe(null)
    expect(parseRequiredCredits("")).toBe(null)
    expect(parseRequiredCredits("0")).toBe(null)
    expect(parseRequiredCredits("-500")).toBe(null)
    expect(parseRequiredCredits("ten thousand")).toBe(null)
    expect(parseRequiredCredits("1000; DROP TABLE")).toBe(null)
  })

  it("clamps an absurd request to a sane ceiling", () => {
    expect(parseRequiredCredits("99999999999")).toBe(100_000_000)
  })
})

describe("adviseUpgrade", () => {
  it("states the gap exactly", () => {
    const advice = adviseUpgrade({ ...catalog, required: 100_000, available: 420 })
    expect(advice.costKnown).toBe(true)
    expect(advice.shortfall).toBe(99_580)
  })

  it("offers the smallest pack that covers the gap", () => {
    const advice = adviseUpgrade({ ...catalog, required: 100_000, available: 0 })
    const pack = advice.options.find((option) => option.kind === "pack")
    expect(pack?.productId).toBe("perm_200k")
    expect(pack?.credits).toBeGreaterThanOrEqual(100_000)
    expect(pack?.cadence).toBe("one-time")
  })

  it("offers the cheapest plan whose monthly grant covers the gap", () => {
    const advice = adviseUpgrade({ ...catalog, required: 100_000, available: 0 })
    const plan = advice.options.find((option) => option.kind === "plan")
    expect(plan?.productId).toBe("starter")
    expect(plan?.credits).toBeGreaterThanOrEqual(100_000)
    expect(plan?.cadence).toBe("monthly")
  })

  it("recommends only an option that actually covers the gap", () => {
    const advice = adviseUpgrade({ ...catalog, required: 100_000, available: 0 })
    const recommended = advice.options.filter((option) => option.recommended)
    expect(recommended).toHaveLength(1)
    expect(recommended[0].credits).toBeGreaterThanOrEqual(advice.shortfall)
  })

  it("never badges a best value when nothing can cover it", () => {
    const advice = adviseUpgrade({ ...catalog, required: 60_000_000, available: 0 })
    expect(advice.anyOptionCovers).toBe(false)
    expect(advice.options.every((option) => !option.recommended)).toBe(true)
  })

  it("says so when the balance already covers the cost", () => {
    const advice = adviseUpgrade({ ...catalog, required: 100, available: 5_000 })
    expect(advice.shortfall).toBe(0)
    expect(advice.anyOptionCovers).toBe(true)
    expect(advice.options).toHaveLength(2)
  })

  it("still helps when the cost is unknown, without inventing a shortfall", () => {
    const advice = adviseUpgrade({ ...catalog, required: null, available: 0 })
    expect(advice.costKnown).toBe(false)
    expect(advice.required).toBe(null)
    expect(advice.shortfall).toBe(0)
    expect(advice.options.every((option) => !option.recommended)).toBe(true)
    expect(advice.options.length).toBeGreaterThan(0)
  })

  it("keeps the free tier out of the paid options", () => {
    const advice = adviseUpgrade({ ...catalog, required: 1, available: 0 })
    expect(advice.options.some((option) => option.productId === "free")).toBe(false)
    expect(advice.options.every((option) => option.priceUSD > 0)).toBe(true)
  })

  it("rounds credits per dollar down, never up", () => {
    const advice = adviseUpgrade({ ...catalog, required: 1, available: 0 })
    for (const option of advice.options) {
      expect(option.creditsPerDollar).toBeLessThanOrEqual(option.credits / option.priceUSD)
    }
  })
})
