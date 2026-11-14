import { describe, it, expect } from "vitest"
import { computeMigrationForRecord } from "./migrate"
import type { SubscriptionRecord } from "@/lib/billing/billing-types"

function makeSub(over: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    id: "sub_1",
    userId: "user_1",
    dodoSubscriptionId: "dodo_1",
    planId: "free",
    planName: "Free",
    priceUSD: 0,
    mirrorCredits: 0,
    status: "active",
    currentPeriodStart: 0,
    currentPeriodEnd: 0,
    cancelAtPeriodEnd: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as SubscriptionRecord
}

describe("legacy → commercial migration (Gate 4)", () => {
  it("maps a legacy free user with projects to grandfathered explorer", () => {
    const { changed, payload } = computeMigrationForRecord(makeSub({ planId: "free", mirrorCredits: 0 }), {
      hasProjects: true,
      batchId: "b1",
    })
    expect(changed).toBe(true)
    expect(payload?.commercialPlanId).toBe("explorer")
    expect(payload?.legacyPlanId).toBe("free")
    expect(payload?.grandfathered).toBe(true)
    expect(payload?.entitlementSnapshot).toBeTypeOf("object")
  })

  it("maps legacy business to growth", () => {
    const { payload } = computeMigrationForRecord(makeSub({ planId: "business" }), { batchId: "b1" })
    expect(payload?.commercialPlanId).toBe("growth")
  })

  it("is a no-op for already-migrated records (idempotent)", () => {
    const already = makeSub({ planId: "free", commercialPlanId: "explorer", migrationBatchId: "prev" })
    const { changed } = computeMigrationForRecord(already, { batchId: "b2" })
    expect(changed).toBe(false)
  })

  it("re-migrates when forced", () => {
    const already = makeSub({ planId: "free", commercialPlanId: "explorer", migrationBatchId: "prev" })
    const { changed, payload } = computeMigrationForRecord(already, { batchId: "b2", force: true })
    expect(changed).toBe(true)
    expect(payload?.migrationBatchId).toBe("b2")
  })

  it("never renames the stored planId (preserved verbatim in legacyPlanId)", () => {
    const { payload } = computeMigrationForRecord(makeSub({ planId: "explorer" }), { batchId: "b1" })
    // Paid legacy `explorer` maps to `starter` but legacy id is preserved.
    expect(payload?.commercialPlanId).toBe("starter")
    expect(payload?.legacyPlanId).toBe("explorer")
  })
})
