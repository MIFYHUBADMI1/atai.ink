import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildEntitlementSet } from "@/lib/billing/entitlements/catalog"

vi.mock("server-only", () => ({}))

const { subFindOne, subUpdateOne, subInsertOne, grantSubscriptionCredits, resolveRuntimeCatalogProduct } =
  vi.hoisted(() => ({
    subFindOne: vi.fn(),
    subUpdateOne: vi.fn(),
    subInsertOne: vi.fn(),
    grantSubscriptionCredits: vi.fn(),
    resolveRuntimeCatalogProduct: vi.fn(),
  }))

vi.mock("@/lib/db/collections", () => ({
  subscriptionRecordsCol: vi.fn(async () => ({
    findOne: subFindOne,
    updateOne: subUpdateOne,
    insertOne: subInsertOne,
  })),
}))
vi.mock("@/lib/billing/credit-service", () => ({ grantSubscriptionCredits }))
vi.mock("@/lib/billing/subscription-payment-grants", () => ({
  findSubscriptionGrantEntry: vi.fn(async () => null),
  linkSubscriptionGrantToPayment: vi.fn(async () => ({ linked: false })),
}))
vi.mock("@/lib/billing/dodo-service", () => ({ getDodoClient: vi.fn() }))
vi.mock("@/lib/billing/catalog/runtime", () => ({ resolveRuntimeCatalogProduct }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { activatePaidSubscription } from "./activate-subscription"

const DAY_MS = 86_400_000
const SNAPSHOT = buildEntitlementSet(
  "starter",
  { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 },
  { legacyPlanId: "starter" },
)

describe("activatePaidSubscription — active database catalog", () => {
  beforeEach(() => {
    subFindOne.mockReset().mockResolvedValue(null)
    subUpdateOne.mockReset().mockResolvedValue({ modifiedCount: 1 })
    subInsertOne.mockReset().mockResolvedValue({ insertedId: "x" })
    grantSubscriptionCredits.mockReset().mockResolvedValue(true)
    resolveRuntimeCatalogProduct.mockReset().mockResolvedValue({
      productId: "prod_subscription_starter",
      versionId: "prod_subscription_starter_v2",
      planId: "starter",
      planName: "Starter Database",
      productType: "subscription",
      billingCycle: "monthly",
      priceMinor: 9_999,
      monthlyCredits: 175_000,
      oneTimeCredits: 0,
      dodoProductId: "pdt_db_starter",
      entitlementSnapshot: SNAPSHOT,
      entitlementVersion: "ENT_DB_V1",
      pricingVersion: "PRICE_BOOK_DB",
      commercialPlanId: "starter",
    })
  })

  it("pins the database price, credits and entitlement snapshot", async () => {
    const result = await activatePaidSubscription({
      subscriptionId: "dodo_sub_db",
      productId: "pdt_db_starter",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })

    expect(result).toEqual({ ok: true, planId: "starter" })
    expect(grantSubscriptionCredits).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 175_000, planId: "starter" }),
    )
    const record = subInsertOne.mock.calls[0][0]
    expect(record).toMatchObject({
      planId: "starter",
      planName: "Starter Database",
      commercialPlanId: "starter",
      priceUSD: 99.99,
      mirrorCredits: 175_000,
    })
    expect(record.purchasedTerms).toMatchObject({
      planId: "starter",
      priceMinor: 9_999,
      monthlyCredits: 175_000,
      entitlementVersion: "ENT_DB_V1",
      pricingVersion: "PRICE_BOOK_DB",
    })
    expect(record.purchasedTerms.entitlementSnapshot.commercialPlanId).toBe("starter")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps a legacy Dodo product on its legacy allocation", async () => {
    vi.stubEnv("DODO_PRODUCT_STARTER", "dodo_legacy_starter")
    resolveRuntimeCatalogProduct.mockResolvedValue(null)

    const result = await activatePaidSubscription({
      subscriptionId: "dodo_sub_legacy",
      productId: "dodo_legacy_starter",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })

    expect(result).toEqual({ ok: true, planId: "starter" })
    expect(resolveRuntimeCatalogProduct).toHaveBeenCalledWith(
      expect.objectContaining({ allowPlanFallback: false }),
    )
    expect(grantSubscriptionCredits).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 300_000, planId: "starter" }),
    )
    expect(subInsertOne.mock.calls[0][0]).toMatchObject({ priceUSD: 79, mirrorCredits: 300_000 })
  })

  it("does not use the database catalog for a non-subscription product", async () => {
    resolveRuntimeCatalogProduct.mockResolvedValue({
      productId: "prod_pack_perm_500k",
      versionId: "prod_pack_perm_500k_v1",
      planId: "perm_500k",
      planName: "500,000 Credits",
      productType: "credit_pack",
      billingCycle: "one_time",
      priceMinor: 11_900,
      monthlyCredits: 0,
      oneTimeCredits: 500_000,
      dodoProductId: "pdt_perm_500k",
      entitlementSnapshot: null,
      entitlementVersion: "ENT_V1",
      pricingVersion: "PRICE_BOOK_V1",
    })

    const result = await activatePaidSubscription({
      subscriptionId: "dodo_sub_db",
      productId: "pdt_perm_500k",
      metadata: { userId: "u1", planId: "perm_500k" },
    })

    expect(result).toEqual({ ok: false, reason: "missing_plan" })
    expect(grantSubscriptionCredits).not.toHaveBeenCalled()
  })
})
