import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

/**
 * Attribution tests for activatePaidSubscription (subscription.active path).
 *
 * The critical invariant: a commercial purchase must NEVER be attributed to a
 * legacy plan. Commercial Starter shares the id "starter" with the legacy $79
 * plan, and Growth/Scale don't exist in the legacy catalog at all — so legacy-
 * first resolution either charges the wrong price/credits or fails outright.
 *
 * Annual invariant: the upfront yearly charge grants ONLY month 0 at
 * activation, with a periodEnd anchored to addMonths(now, 1) so the annual
 * sweep's month-0 grant deduplicates on the same idempotency key.
 */

vi.mock("server-only", () => ({}))

const { subFindOne, subUpdateOne, subInsertOne, grantSubscriptionCredits } = vi.hoisted(() => ({
  subFindOne: vi.fn(),
  subUpdateOne: vi.fn(),
  subInsertOne: vi.fn(),
  grantSubscriptionCredits: vi.fn(),
}))

vi.mock("@/lib/db/collections", () => ({
  subscriptionRecordsCol: vi.fn(async () => ({
    findOne: subFindOne,
    updateOne: subUpdateOne,
    insertOne: subInsertOne,
  })),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  grantSubscriptionCredits,
}))

vi.mock("@/lib/billing/subscription-payment-grants", () => ({
  findSubscriptionGrantEntry: vi.fn(async () => null),
  linkSubscriptionGrantToPayment: vi.fn(async () => ({ linked: false })),
}))

vi.mock("@/lib/billing/dodo-service", () => ({
  getDodoClient: vi.fn(),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const ENV_KEYS = [
  "DODO_COMMERCIAL_PRODUCT_STARTER",
  "DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL",
  "DODO_COMMERCIAL_PRODUCT_GROWTH",
  "DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL",
  "DODO_COMMERCIAL_PRODUCT_SCALE",
]

const DAY_MS = 86_400_000

async function loadActivate() {
  vi.resetModules()
  return (await import("./activate-subscription")).activatePaidSubscription
}

describe("activatePaidSubscription — commercial attribution", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
    process.env.DODO_COMMERCIAL_PRODUCT_STARTER = "pdt_starter_m"
    process.env.DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL = "pdt_starter_y"
    process.env.DODO_COMMERCIAL_PRODUCT_GROWTH = "pdt_growth_m"
    process.env.DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL = "pdt_growth_y"
    process.env.DODO_COMMERCIAL_PRODUCT_SCALE = "pdt_scale_m"
    subFindOne.mockReset().mockResolvedValue(null)
    subUpdateOne.mockReset().mockResolvedValue({ modifiedCount: 1 })
    subInsertOne.mockReset().mockResolvedValue({ insertedId: "x" })
    grantSubscriptionCredits.mockReset().mockResolvedValue(true)
  })
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
    vi.resetModules()
  })

  it("attributes a commercial Growth purchase to Growth (absent from the legacy catalog)", async () => {
    const activate = await loadActivate()
    const nextBilling = new Date(Date.now() + 30 * DAY_MS).toISOString()
    const result = await activate({
      subscriptionId: "dodo_sub_1",
      productId: "pdt_growth_m",
      metadata: { userId: "u1", planId: "growth", billingCycle: "monthly", credits: "400000" },
      nextBillingDate: nextBilling,
    })
    expect(result).toEqual({ ok: true, planId: "growth" })
    expect(grantSubscriptionCredits).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", amount: 400_000, planId: "growth" }),
    )
    const record = subInsertOne.mock.calls[0][0]
    expect(record).toMatchObject({
      planId: "growth",
      commercialPlanId: "growth",
      billingCycle: "monthly",
      priceUSD: 199.99,
      mirrorCredits: 400_000,
    })
  })

  it("does NOT mis-attribute commercial Starter to the legacy $79 starter", async () => {
    const activate = await loadActivate()
    const result = await activate({
      subscriptionId: "dodo_sub_2",
      productId: "pdt_starter_m",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })
    expect(result).toEqual({ ok: true, planId: "starter" })
    const record = subInsertOne.mock.calls[0][0]
    expect(record.priceUSD).toBe(89.99)
    expect(record.mirrorCredits).toBe(150_000)
    expect(record.commercialPlanId).toBe("starter")
    expect(grantSubscriptionCredits).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 150_000 }),
    )
  })

  it("annual activation grants only month 0, anchored so the sweep deduplicates", async () => {
    const activate = await loadActivate()
    const now = Date.now()
    const nextBilling = new Date(now + 365 * DAY_MS).toISOString()
    const result = await activate({
      subscriptionId: "dodo_sub_3",
      productId: "pdt_starter_y",
      metadata: { userId: "u1", planId: "starter", billingCycle: "annual" },
      nextBillingDate: nextBilling,
    })
    expect(result.ok).toBe(true)

    const grant = grantSubscriptionCredits.mock.calls[0][0]
    expect(grant.amount).toBe(150_000)
    // Month-0 window ends ~1 month out, NOT at the yearly period end — the
    // sweep's month-0 grant uses the same window and must dedupe.
    expect(grant.periodEnd).toBeLessThan(now + 32 * DAY_MS)
    expect(grant.periodEnd).toBeGreaterThan(now + 27 * DAY_MS)

    const record = subInsertOne.mock.calls[0][0]
    expect(record.billingCycle).toBe("annual")
    expect(record.priceUSD).toBe(989.89)
    // The stored paid period spans the full year for the sweep to slice.
    expect(record.currentPeriodEnd).toBe(new Date(nextBilling).getTime())
  })

  it("falls back to metadata billingCycle when the product id does not resolve", async () => {
    const activate = await loadActivate()
    const result = await activate({
      subscriptionId: "dodo_sub_4",
      productId: "pdt_unknown_shape",
      metadata: { userId: "u1", planId: "scale", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })
    expect(result).toEqual({ ok: true, planId: "scale" })
    expect(subInsertOne.mock.calls[0][0]).toMatchObject({
      commercialPlanId: "scale",
      priceUSD: 499.99,
    })
  })

  it("legacy purchases keep legacy attribution (no commercial product match)", async () => {
    const activate = await loadActivate()
    const result = await activate({
      subscriptionId: "dodo_sub_5",
      productId: "pdt_legacy_business",
      metadata: { userId: "u1", planId: "business", credits: "600000" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })
    expect(result).toEqual({ ok: true, planId: "business" })
    const record = subInsertOne.mock.calls[0][0]
    expect(record).toMatchObject({ planId: "business", priceUSD: 139, mirrorCredits: 600_000 })
    expect(record.commercialPlanId).toBeUndefined()
    expect(record.billingCycle).toBe("monthly")
  })
})