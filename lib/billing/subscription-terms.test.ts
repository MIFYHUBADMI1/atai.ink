import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

/**
 * Phase A1 — pinned subscription commercial terms.
 *
 * Covers the ten required invariants:
 *  1. a v1 subscriber keeps v1 terms after a v2 catalog is published;
 *  2. a renewal uses the original pinned credit allocation;
 *  3. a renewal never falls back to changed code constants;
 *  4. legacy subscriptions keep resolving;
 *  5. entitlements stay pinned after a catalog change;
 *  6. missing historical data is not fabricated;
 *  7. duplicate renewal events do not duplicate grants;
 *  8. annual allocations keep their monthly schedule;
 *  9. grandfathered accounts keep their behaviour;
 * 10. the migration is repeatable without changing migrated records.
 */

vi.mock("server-only", () => ({}))

type Doc = Record<string, any>

function eq(value: unknown, wanted: unknown): boolean {
  if (wanted === null) return value === null || value === undefined
  return value === wanted
}

function valueAt(doc: Doc, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(doc, key)) return doc[key]
  return key.split(".").reduce<unknown>((value, part) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = item && typeof item === "object" ? (item as Doc)[part] : undefined
        if (nested !== undefined) return nested
      }
      return undefined
    }
    if (value && typeof value === "object" && part in (value as Doc)) return (value as Doc)[part]
    return undefined
  }, doc)
}

function matches(doc: Doc, filter: Doc = {}): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((f) => matches(doc, f))
    if (key === "$and") return (cond as Doc[]).every((f) => matches(doc, f))
    const value = valueAt(doc, key)
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      return Object.entries(cond as Doc).every(([op, arg]) => {
        if (op === "$in") return (arg as unknown[]).some((a) => eq(value, a))
        if (op === "$ne") {
          if (Array.isArray(value)) return !value.some((item) => eq(item, arg))
          return !eq(value, arg)
        }
        if (op === "$exists") return arg ? value !== undefined : value === undefined
        if (op === "$lt") return (value as number) < (arg as number)
        if (op === "$lte") return (value as number) <= (arg as number)
        if (op === "$gte") return (value as number) >= (arg as number)
        throw new Error(`unsupported operator ${op}`)
      })
    }
    return eq(value, cond)
  })
}

function applyUpdate(doc: Doc, update: Doc): void {
  if (update.$set) Object.assign(doc, update.$set)
  if (update.$unset) for (const key of Object.keys(update.$unset)) delete doc[key]
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc as Record<string, number>)) doc[k] = (doc[k] ?? 0) + v
  if (update.$addToSet) {
    for (const [k, v] of Object.entries(update.$addToSet as Record<string, unknown>)) {
      if (!Array.isArray(doc[k])) doc[k] = []
      if (!doc[k].includes(v)) doc[k].push(v)
    }
  }
  if (update.$pull) {
    for (const [k, cond] of Object.entries(update.$pull as Record<string, Doc>)) {
      if (!Array.isArray(doc[k])) continue
      doc[k] = doc[k].filter((item: Doc) => !Object.entries(cond).every(([ck, cv]) => eq(item[ck], cv)))
    }
  }
}

const h = vi.hoisted(() => {
  const state = {
    subs: [] as Doc[],
    projects: [] as Doc[],
    ledger: [] as Doc[],
    payments: [] as Doc[],
    versionSeedFails: false,
  }

  const grant = vi.fn(async (p: Doc) => {
    const key = `sub_grant_${p.subscriptionId}_period_${Math.floor(p.periodEnd / 86_400_000)}`
    if (state.ledger.some((r) => r.idempotencyKey === key)) return true
    state.ledger.push({
      id: `ledger_${key}`,
      idempotencyKey: key,
      userId: p.userId,
      amount: p.amount,
      planId: p.planId,
      transactionType: "subscription_grant",
      direction: "credit",
      referenceType: "subscription",
      referenceId: p.subscriptionId,
      createdAt: Date.now(),
      metadata: {
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        planId: p.planId,
        bucketId: `bucket_${key}`,
      },
    })
    return true
  })
  const expire = vi.fn(async () => undefined)
  const grantPack = vi.fn(async () => ({ success: true }))
  const reverse = vi.fn(async () => ({ success: true }))

  const subscriptionsCol = {
    async findOne(filter: Doc) {
      return state.subs.find((s) => matches(s, filter)) ?? null
    },
    find() {
      return { async toArray() { return state.subs.slice() } }
    },
    async countDocuments(filter: Doc = {}) {
      return state.subs.filter((s) => matches(s, filter)).length
    },
    async updateOne(filter: Doc, update: Doc) {
      const doc = state.subs.find((s) => matches(s, filter))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      applyUpdate(doc, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async insertOne(doc: Doc) {
      state.subs.push(doc)
      return { acknowledged: true }
    },
  }

  const projectsCol = {
    async countDocuments(filter: Doc = {}) {
      return state.projects.filter((p) => matches(p, filter)).length
    },
    async findOne(filter: Doc) {
      return state.projects.find((p) => matches(p, filter)) ?? null
    },
  }

  function makeCursor(initial: Doc[]) {
    let rows = initial
    const cursor = {
      sort(spec: Doc) {
        const entries = Object.entries(spec)
        rows = rows.slice().sort((a, b) => {
          for (const [key, dir] of entries) {
            const av = a[key] ?? 0
            const bv = b[key] ?? 0
            if (av < bv) return -1 * (dir as number)
            if (av > bv) return 1 * (dir as number)
          }
          return 0
        })
        return cursor
      },
      limit(n: number) {
        rows = rows.slice(0, n)
        return cursor
      },
      async toArray() {
        return rows.slice()
      },
    }
    return cursor
  }

  const ledgerCol = {
    async findOne(filter: Doc) {
      return state.ledger.find((r) => matches(r, filter)) ?? null
    },
    find(filter: Doc = {}) {
      return makeCursor(state.ledger.filter((r) => matches(r, filter)))
    },
    async updateOne(filter: Doc, update: Doc) {
      const doc = state.ledger.find((r) => matches(r, filter))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      applyUpdate(doc, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async insertOne(doc: Doc) {
      state.ledger.push(doc)
      return { acknowledged: true }
    },
  }

  const paymentsCol = {
    async findOne(filter: Doc) {
      return state.payments.find((r) => matches(r, filter)) ?? null
    },
    find(filter: Doc = {}) {
      return makeCursor(state.payments.filter((r) => matches(r, filter)))
    },
    async updateOne(filter: Doc, update: Doc) {
      const doc = state.payments.find((r) => matches(r, filter))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      applyUpdate(doc, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async insertOne(doc: Doc) {
      state.payments.push(doc)
      return { acknowledged: true }
    },
  }

  const versionCol = {
    async updateOne() {
      if (state.versionSeedFails) throw new Error("version store unavailable")
      return { acknowledged: true }
    },
  }

  return {
    state,
    grant,
    expire,
    grantPack,
    reverse,
    subscriptionsCol,
    projectsCol,
    ledgerCol,
    paymentsCol,
    versionCol,
    reset() {
      state.subs = []
      state.projects = []
      state.ledger = []
      state.payments = []
      state.versionSeedFails = false
      grant.mockClear()
      expire.mockClear()
      grantPack.mockClear()
      reverse.mockClear()
    },
  }
})

vi.mock("@/lib/db/collections", () => ({
  subscriptionRecordsCol: vi.fn(async () => h.subscriptionsCol),
  projectsCol: vi.fn(async () => h.projectsCol),
  creditLedgerCol: vi.fn(async () => h.ledgerCol),
  paymentRecordsCol: vi.fn(async () => h.paymentsCol),
  entitlementVersionsCol: vi.fn(async () => h.versionCol),
  planCatalogVersionsCol: vi.fn(async () => h.versionCol),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  grantSubscriptionCredits: h.grant,
  expireSubscriptionCredits: h.expire,
  grantCredits: h.grantPack,
  reverseCredits: h.reverse,
}))

vi.mock("@/lib/billing/dodo-service", () => ({ getDodoClient: vi.fn() }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  buildCommercialPurchasedTerms,
  buildPurchasedTermsFromRecord,
  annualMonthlyAllocation,
  resolveRenewalAllocation,
} from "./subscription-terms"
import { buildEntitlementSet, checkEntitlement } from "./entitlements/catalog"
import {
  computePinnedTermsForRecord,
  computeMigrationForRecord,
  migrateSubscriptionEntitlements,
} from "./entitlements/migrate"
import { runAnnualGrantSweep } from "./entitlements/annual-scheduler"
import { resolveScope } from "./entitlements/service"
import { activatePaidSubscription } from "./activate-subscription"
import { processDodoEvent } from "./dodo-event-processing"
import {
  PRICE_BOOK_VERSION,
  PRICE_BOOK_PRE_VERSIONING,
} from "./entitlements/price-book"
import { getCommercialPlanById } from "./entitlements/commercial-plans"
import type { PurchasedTerms, SubscriptionRecord } from "./billing-types"

const DAY_MS = 86_400_000
const ENV_KEYS = [
  "DODO_COMMERCIAL_PRODUCT_STARTER",
  "DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL",
  "DODO_COMMERCIAL_PRODUCT_GROWTH",
]

function termsFor(over: Partial<PurchasedTerms> = {}): PurchasedTerms {
  return {
    subscriptionId: "sub_local_1",
    dodoSubscriptionId: "dodo_1",
    dodoProductId: "pdt_starter_m",
    planId: "starter",
    commercialPlanId: "starter",
    planName: "Starter",
    billingInterval: "monthly",
    priceMinor: 8_999,
    currency: "USD",
    monthlyCredits: 150_000,
    entitlementSnapshot: buildEntitlementSet("starter", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    }),
    entitlementVersion: "ENT_V1",
    entitlementEvidence: "purchase",
    pricingVersion: PRICE_BOOK_VERSION,
    activatedAt: 1,
    periodStart: 1,
    periodEnd: 2,
    source: "activation",
    ...over,
  }
}

function subRecord(over: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  const now = Date.UTC(2026, 0, 1)
  return {
    id: "sub_local_1",
    userId: "u1",
    dodoSubscriptionId: "dodo_1",
    planId: "starter",
    planName: "Starter",
    priceUSD: 89.99,
    mirrorCredits: 150_000,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: now + 30 * DAY_MS,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as SubscriptionRecord
}

beforeEach(() => {
  h.reset()
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.DODO_COMMERCIAL_PRODUCT_STARTER = "pdt_starter_m"
  process.env.DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL = "pdt_starter_y"
  process.env.DODO_COMMERCIAL_PRODUCT_GROWTH = "pdt_growth_m"
})

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

// ─── 1, 2, 3, 7: activation + renewal ────────────────────────────────────────

describe("activation pins commercial terms", () => {
  it("a new commercial subscription saves its price, credits, snapshot and versions", async () => {
    const result = await activatePaidSubscription({
      subscriptionId: "dodo_new",
      productId: "pdt_starter_m",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })
    expect(result).toEqual({ ok: true, planId: "starter" })

    const record = h.state.subs.find((s) => s.dodoSubscriptionId === "dodo_new")!
    expect(record.termsStatus).toBe("pinned")
    expect(record.purchasedTerms).toMatchObject({
      dodoSubscriptionId: "dodo_new",
      dodoProductId: "pdt_starter_m",
      planId: "starter",
      commercialPlanId: "starter",
      billingInterval: "monthly",
      priceMinor: 8_999,
      currency: "USD",
      monthlyCredits: 150_000,
      pricingVersion: PRICE_BOOK_VERSION,
      source: "activation",
    })
    expect(record.purchasedTerms.entitlementSnapshot.commercialPlanId).toBe("starter")
    expect(record.entitlementSnapshot).toBeTruthy()
    expect(record.entitlementVersion).toBe("ENT_V1")
  })

  it("pins an existing pre-pinning record from its own stored evidence (M-08)", async () => {
    h.state.subs.push(
      subRecord({
        dodoSubscriptionId: "dodo_old",
        planId: "starter",
        commercialPlanId: "starter",
        priceUSD: 79,
        mirrorCredits: 300_000,
      }),
    )

    await activatePaidSubscription({
      subscriptionId: "dodo_old",
      productId: "pdt_starter_m",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })

    // Today's catalog says $89.99 / 150,000. The record bought $79 / 300,000.
    expect(h.grant).toHaveBeenCalledWith(expect.objectContaining({ amount: 300_000 }))
    const record = h.state.subs.find((s) => s.dodoSubscriptionId === "dodo_old")!
    expect(record.purchasedTerms).toMatchObject({
      priceMinor: 7_900,
      monthlyCredits: 300_000,
      entitlementEvidence: "legacy_mapping_provisional",
    })
    // Price/credits are reliable; the missing historical entitlement snapshot
    // keeps the record in review instead of pretending it was purchased.
    expect(record.termsStatus).toBe("needs_review")
    expect(record.termsReviewReason).toBe("missing_entitlement_snapshot")
  })

  it("never re-prices an existing record whose own terms cannot be reconstructed", async () => {
    // A corrupt/partial record: a known paid plan but no stored credits.
    h.state.subs.push(
      subRecord({
        dodoSubscriptionId: "dodo_broken",
        planId: "business",
        priceUSD: 139,
        mirrorCredits: 0,
      }),
    )

    const result = await activatePaidSubscription({
      subscriptionId: "dodo_broken",
      productId: "pdt_starter_m",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })

    expect(result).toEqual({ ok: false, reason: "existing_terms_unresolved" })
    expect(h.grant).not.toHaveBeenCalled()
    expect(h.state.subs[0].purchasedTerms).toBeUndefined()
    expect(h.state.subs[0].planId).toBe("business")
  })

  it("re-activation never re-prices an already-pinned subscription", async () => {
    const pinned = termsFor({ monthlyCredits: 111_111, priceMinor: 7_900 })
    h.state.subs.push(subRecord({ dodoSubscriptionId: "dodo_pinned", purchasedTerms: pinned, termsStatus: "pinned" }))

    const result = await activatePaidSubscription({
      subscriptionId: "dodo_pinned",
      productId: "pdt_starter_m",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })
    expect(result.ok).toBe(true)
    // The grant uses the pinned allocation, not today's 150,000 catalog value.
    expect(h.grant).toHaveBeenCalledWith(expect.objectContaining({ amount: 111_111 }))
    expect(h.state.subs[0].purchasedTerms.monthlyCredits).toBe(111_111)
    expect(h.state.subs[0].priceUSD).toBe(89.99)
  })
})

describe("renewal resolves the purchased allocation", () => {
  it("uses pinned terms even when the current catalog has different credits", async () => {
    h.state.subs.push(subRecord({ purchasedTerms: termsFor({ monthlyCredits: 123_456 }) }))
    const nextBilling = new Date(Date.now() + 30 * DAY_MS).toISOString()

    const outcome = await processDodoEvent(
      "subscription.renewed",
      {
        subscription_id: "dodo_1",
        product_id: "pdt_starter_m", // today's catalog says 150,000
        next_billing_date: nextBilling,
        metadata: { userId: "attacker", planId: "starter", credits: "999999999" },
      },
      "evt_renew_pinned",
    )

    expect(outcome).toEqual({ status: "processed" })
    expect(h.grant).toHaveBeenCalledTimes(1)
    expect(h.grant).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", amount: 123_456, planId: "starter" }),
    )
    // The webhook metadata's userId/credits were not trusted.
    expect(h.grant.mock.calls[0][0].userId).toBe("u1")
  })

  it("a legacy subscription without pinned terms uses its own stored allocation", async () => {
    h.state.subs.push(
      subRecord({ planId: "business", planName: "Business", priceUSD: 139, mirrorCredits: 600_000 }),
    )

    const outcome = await processDodoEvent(
      "subscription.renewed",
      {
        subscription_id: "dodo_1",
        next_billing_date: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        metadata: { userId: "u1", planId: "business" },
      },
      "evt_renew_legacy",
    )

    expect(outcome).toEqual({ status: "processed" })
    expect(h.grant).toHaveBeenCalledWith(expect.objectContaining({ amount: 600_000, planId: "business" }))
    // The renewal lazily pins the record's own original allocation, but without
    // a historical snapshot it stays explicitly in review.
    expect(h.state.subs[0].purchasedTerms).toMatchObject({
      planId: "business",
      monthlyCredits: 600_000,
      entitlementEvidence: "legacy_mapping_provisional",
    })
    expect(h.state.subs[0].termsStatus).toBe("needs_review")
    expect(h.state.subs[0].termsReviewReason).toBe("missing_entitlement_snapshot")
  })

  it("a record with no usable allocation is unresolved, not guessed", async () => {
    h.state.subs.push(subRecord({ planId: "business", mirrorCredits: 0, priceUSD: 139 }))

    const outcome = await processDodoEvent(
      "subscription.renewed",
      {
        subscription_id: "dodo_1",
        next_billing_date: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        metadata: { userId: "u1", planId: "business", credits: "600000" },
      },
      "evt_renew_missing",
    )

    expect(outcome).toMatchObject({ status: "unresolved" })
    expect(h.grant).not.toHaveBeenCalled()
  })

  it("duplicate renewal deliveries grant the period exactly once", async () => {
    h.state.subs.push(subRecord({ purchasedTerms: termsFor({ monthlyCredits: 123_456 }) }))
    const payload = {
      subscription_id: "dodo_1",
      product_id: "pdt_starter_m",
      next_billing_date: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      metadata: { userId: "u1" },
    }

    await processDodoEvent("subscription.renewed", payload, "evt_dup_1")
    await processDodoEvent("subscription.renewed", payload, "evt_dup_2")

    expect(h.grant).toHaveBeenCalledTimes(1)
    expect(h.state.ledger.filter((r) => String(r.idempotencyKey).startsWith("sub_grant_dodo_1_period_"))).toHaveLength(1)
  })
})

// ─── 4, 6, 8, 10: pure terms + migration ─────────────────────────────────────

describe("terms reconstruction preserves the original purchase", () => {
  it("keeps a v1 price/credits even though the live catalog now says v2", () => {
    // The live commercial catalog is $89.99 / 150,000. This record bought
    // $79.00 / 300,000 — those values must survive.
    const { terms } = buildPurchasedTermsFromRecord(
      subRecord({ planId: "starter", commercialPlanId: "starter", priceUSD: 79, mirrorCredits: 300_000 }),
    )
    expect(terms).toMatchObject({
      priceMinor: 7_900,
      monthlyCredits: 300_000,
      planId: "starter",
      pricingVersion: PRICE_BOOK_PRE_VERSIONING,
    })
  })

  it("does not fabricate terms when a paid record has no credit allocation", () => {
    const { terms, reviewReason } = buildPurchasedTermsFromRecord(
      subRecord({ planId: "business", mirrorCredits: 0 }),
    )
    expect(terms).toBeUndefined()
    expect(reviewReason).toBe("missing_credit_allocation")
  })

  it("does not fabricate terms for an unknown plan id", () => {
    const { terms, reviewReason } = buildPurchasedTermsFromRecord(
      subRecord({ planId: "mystery-plan", mirrorCredits: 100 }),
    )
    expect(terms).toBeUndefined()
    expect(reviewReason).toContain("unknown_plan_id")
  })

  it("annual terms carry the monthly issuance rules", () => {
    const { terms } = buildPurchasedTermsFromRecord(
      subRecord({
        planId: "starter",
        commercialPlanId: "starter",
        billingCycle: "annual",
        priceUSD: 989.89,
        mirrorCredits: 150_000,
      }),
    )
    expect(terms?.billingInterval).toBe("annual")
    expect(terms?.annual).toEqual({
      months: 12,
      monthlyCredits: 150_000,
      totalCredits: 1_800_000,
      issuance: "monthly",
    })
    expect(annualMonthlyAllocation(subRecord({ purchasedTerms: terms! }))).toBe(150_000)
  })

  it("annual allocation prefers pinned terms over the mutable top-level field", () => {
    const sub = subRecord({
      mirrorCredits: 999,
      billingCycle: "annual",
      purchasedTerms: termsFor({ billingInterval: "annual", monthlyCredits: 123 }),
    })
    expect(annualMonthlyAllocation(sub)).toBe(123)
  })

  it("the migration is repeatable and leaves migrated terms untouched", () => {
    const historical = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    const sub = subRecord({
      planId: "business",
      mirrorCredits: 600_000,
      priceUSD: 139,
      entitlementSnapshot: historical as unknown as Record<string, unknown>,
    })
    const first = computePinnedTermsForRecord(sub, { batchId: "batch_1", now: 1_000 })
    expect(first.changed).toBe(true)
    expect(first.payload?.termsStatus).toBe("pinned")
    expect(first.payload?.purchasedTerms?.entitlementEvidence).toBe("legacy_snapshot")
    // The stored snapshot is copied, never aliased and never mutated.
    expect(first.payload?.purchasedTerms?.entitlementSnapshot).toEqual(historical)
    expect(first.payload?.purchasedTerms?.entitlementSnapshot).not.toBe(historical)

    const migrated = { ...sub, ...first.payload } as SubscriptionRecord
    const second = computePinnedTermsForRecord(migrated, { batchId: "batch_2", now: 2_000 })
    expect(second.changed).toBe(false)
    expect(migrated.purchasedTerms?.monthlyCredits).toBe(600_000)
    expect(migrated.purchasedTerms?.priceMinor).toBe(13_900)
  })

  it("reliable price/credits without a historical snapshot are pinned provisionally", () => {
    const sub = subRecord({ planId: "business", mirrorCredits: 600_000, priceUSD: 139 })
    const { changed, payload } = computePinnedTermsForRecord(sub, { batchId: "batch_1" })
    expect(changed).toBe(true)
    expect(payload?.termsStatus).toBe("needs_review")
    expect(payload?.termsReviewReason).toBe("missing_entitlement_snapshot")
    expect(payload?.purchasedTerms).toMatchObject({
      priceMinor: 13_900,
      monthlyCredits: 600_000,
      entitlementEvidence: "legacy_mapping_provisional",
    })
  })

  it("marks a record needs_review instead of inventing data", () => {
    const sub = subRecord({ planId: "business", mirrorCredits: 0 })
    const { changed, payload } = computePinnedTermsForRecord(sub, { batchId: "batch_1" })
    expect(changed).toBe(true)
    expect(payload?.termsStatus).toBe("needs_review")
    expect(payload?.purchasedTerms).toBeUndefined()
    expect(payload?.termsReviewReason).toBe("missing_credit_allocation")
  })

  it("pins grandfathered legacy free behaviour when the account owns projects", () => {
    const sub = subRecord({ planId: "free", planName: "Free", priceUSD: 0, mirrorCredits: 0 })
    const { terms } = buildPurchasedTermsFromRecord(sub, { hasProjects: true })
    expect(terms?.entitlementSnapshot.grandfathered).toBe(true)
    expect(terms?.entitlementSnapshot.preserveLegacyBehavior).toBe(true)
  })

  it("the entitlement migration never rewrites a record with pinned terms", () => {
    const sub = subRecord({ purchasedTerms: termsFor({ monthlyCredits: 42 }) })
    const result = computeMigrationForRecord(sub, { batchId: "batch_x" })
    expect(result.changed).toBe(false)
    expect(result.payload).toBeUndefined()
  })

  it("keeps a commercial Explorer on Explorer (not the legacy paid Explorer)", () => {
    const sub = subRecord({
      planId: "explorer",
      commercialPlanId: "explorer",
      priceUSD: 0,
      mirrorCredits: 500,
    })
    const { payload } = computeMigrationForRecord(sub, { batchId: "batch_x" })
    expect(payload?.commercialPlanId).toBe("explorer")
  })
})

// ─── 5, 9: entitlement resolution ────────────────────────────────────────────

describe("entitlement resolution stays pinned", () => {
  it("uses the purchased snapshot rather than today's catalog caps", async () => {
    const purchased = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    // Simulate a catalog change that would cap Growth at 1 business.
    purchased.businesses.max = 7
    h.state.subs.push(
      subRecord({ commercialPlanId: "growth", planId: "growth", purchasedTerms: termsFor({ entitlementSnapshot: purchased }) }),
    )
    h.state.projects.push({ id: "p1", userId: "u1" }, { id: "p2", userId: "u1" })

    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.businesses.max).toBe(7)
    expect(set.businesses.current).toBe(2)
    // The pinned allocation also overrides the snapshot's catalog grant.
    expect(set.credits.monthlyGrant).toBe(150_000)
    expect(set.entitlementSource).toBe("pinned")
  })

  it("preserves grandfathered production capability from the pinned snapshot", async () => {
    const grandfathered = buildEntitlementSet(
      "explorer",
      { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 },
      { grandfathered: true, preserveLegacyBehavior: true, legacyPlanId: "free" },
    )
    h.state.subs.push(subRecord({ planId: "free", purchasedTerms: termsFor({ entitlementSnapshot: grandfathered }) }))
    h.state.projects.push({ id: "p1", userId: "u1" })

    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.grandfathered).toBe(true)
    expect(set.preserveLegacyBehavior).toBe(true)
    expect(set.planningOnly).toBe(false)
    expect(checkEntitlement(set, "buildProduction").allowed).toBe(true)
  })

  it("a commercial record without a snapshot is labelled needs_review, never pinned", async () => {
    h.state.subs.push(subRecord({ planId: "growth", commercialPlanId: "growth" }))
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    // The resolved capability is the legacy-compatible growth mapping, but the
    // source makes the missing snapshot explicit. It is never written back as
    // purchased terms by this read path.
    expect(set.entitlementSource).toBe("needs_review")
    expect(set.businesses.max).toBe(4)
  })

  it("does not downgrade a needs_review record while it awaits review", async () => {
    h.state.subs.push(
      subRecord({ planId: "mystery-plan", mirrorCredits: 100, termsStatus: "needs_review" }),
    )
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.preserveLegacyBehavior).toBe(true)
    expect(checkEntitlement(set, "buildProduction").allowed).toBe(true)
  })

  it("does not downgrade a needs_review commercial record either", async () => {
    h.state.subs.push(
      subRecord({
        planId: "growth",
        commercialPlanId: "growth",
        termsStatus: "needs_review",
      }),
    )
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.entitlementSource).toBe("needs_review")
    expect(set.preserveLegacyBehavior).toBe(true)
    expect(set.businesses.max).toBe("unlimited")
    expect(checkEntitlement(set, "buildProduction").allowed).toBe(true)
  })
})

describe("renewal resolution priority", () => {
  it("pinned terms beat a catalog allocation", () => {
    const result = resolveRenewalAllocation({
      subscription: subRecord({ purchasedTerms: termsFor({ monthlyCredits: 42 }) }),
      catalogAllocation: {
        planId: "starter",
        planName: "Starter",
        commercialPlanId: "starter",
        billingCycle: "monthly",
        monthlyCredits: 150_000,
      },
    })
    expect(result).toEqual({
      ok: true,
      allocation: expect.objectContaining({ monthlyCredits: 42, source: "pinned_terms" }),
    })
  })

  it("a resolvable product is used only when no subscription record exists", () => {
    const result = resolveRenewalAllocation({
      subscription: null,
      catalogAllocation: {
        planId: "business",
        planName: "Business",
        billingCycle: "monthly",
        monthlyCredits: 600_000,
      },
    })
    expect(result).toEqual({
      ok: true,
      allocation: expect.objectContaining({ monthlyCredits: 600_000, source: "catalog" }),
    })
  })

  it("reports unresolvable terms instead of guessing", () => {
    const result = resolveRenewalAllocation({ subscription: null })
    expect(result).toEqual({ ok: false, reason: "unresolvable_subscription_terms" })
  })
})

describe("commercial terms builder", () => {
  it("uses the published integer price and freezes the snapshot", () => {
    const plan = getCommercialPlanById("starter")!
    const terms = buildCommercialPurchasedTerms(
      {
        subscriptionRecordId: "sub_x",
        dodoSubscriptionId: "dodo_x",
        dodoProductId: "pdt_starter_y",
        activatedAt: 10,
        periodStart: 10,
        periodEnd: 20,
      },
      plan,
      "annual",
    )
    expect(terms.priceMinor).toBe(98_989)
    expect(terms.monthlyCredits).toBe(150_000)
    expect(terms.annual?.totalCredits).toBe(1_800_000)
    expect(terms.pricingVersion).toBe(PRICE_BOOK_VERSION)
    expect(terms.entitlementSnapshot.entitlementVersion).toBe("ENT_V1")
    expect(terms.entitlementEvidence).toBe("purchase")
  })
})

// ─── Verification pass: historical evidence and integration ──────────────────

describe("historical entitlement evidence", () => {
  it("uses a legacy top-level snapshot when purchasedTerms is absent", async () => {
    const legacySnapshot = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    legacySnapshot.businesses.max = 3
    h.state.subs.push(
      subRecord({
        planId: "business",
        entitlementSnapshot: legacySnapshot as unknown as Record<string, unknown>,
      }),
    )
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.businesses.max).toBe(3)
    expect(set.entitlementSource).toBe("pinned")
  })

  it("labels a provisional snapshot as review_provisional", async () => {
    const provisional = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    provisional.businesses.max = 2
    h.state.subs.push(
      subRecord({
        planId: "business",
        mirrorCredits: 600_000,
        priceUSD: 139,
        purchasedTerms: termsFor({
          planId: "business",
          commercialPlanId: "growth",
          entitlementSnapshot: provisional,
          entitlementEvidence: "legacy_mapping_provisional",
        }),
        termsStatus: "needs_review",
        termsReviewReason: "missing_entitlement_snapshot",
      }),
    )
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.businesses.max).toBe(2)
    expect(set.entitlementSource).toBe("review_provisional")
  })

  it("a catalog upgrade cannot raise a pinned subscriber's caps", async () => {
    // The live Growth plan allows 4 businesses. This subscriber bought 1.
    const pinned = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    pinned.businesses.max = 1
    pinned.productionApps.max = 1
    h.state.subs.push(
      subRecord({
        commercialPlanId: "growth",
        planId: "growth",
        purchasedTerms: termsFor({
          planId: "growth",
          commercialPlanId: "growth",
          entitlementSnapshot: pinned,
        }),
      }),
    )
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.businesses.max).toBe(1)
    expect(set.productionApps.max).toBe(1)
  })

  it("a catalog downgrade cannot lower a pinned subscriber's caps", async () => {
    // The live Growth plan allows 4 businesses. This subscriber bought 10.
    const pinned = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    pinned.businesses.max = 10
    h.state.subs.push(
      subRecord({
        commercialPlanId: "growth",
        planId: "growth",
        purchasedTerms: termsFor({
          planId: "growth",
          commercialPlanId: "growth",
          entitlementSnapshot: pinned,
        }),
      }),
    )
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.businesses.max).toBe(10)
  })

  it("a legacy subscriber with no terms keeps its legacy capabilities", async () => {
    h.state.subs.push(subRecord({ planId: "business", planName: "Business", priceUSD: 139, mirrorCredits: 600_000 }))
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.entitlementSource).toBe("legacy")
    expect(set.commercialPlanId).toBe("growth")
    expect(set.businesses.max).toBe(4)
  })
})

describe("version seeding integrity", () => {
  it("a version-seeding failure cannot break activation or entitlements", async () => {
    h.state.versionSeedFails = true

    const result = await activatePaidSubscription({
      subscriptionId: "dodo_nover",
      productId: "pdt_starter_m",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })
    expect(result).toEqual({ ok: true, planId: "starter" })

    const record = h.state.subs.find((s) => s.dodoSubscriptionId === "dodo_nover")!
    expect(record.purchasedTerms.entitlementSnapshot).toBeTruthy()
    expect(record.termsStatus).toBe("pinned")

    h.state.projects.push({ id: "p1", userId: "u1" })
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.commercialPlanId).toBe("starter")
    expect(set.entitlementSource).toBe("pinned")
  })
})

describe("migration integration", () => {
  it("apply is idempotent and never overwrites pinned terms", async () => {
    const historical = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    h.state.subs.push(
      subRecord({
        id: "sub_mig",
        dodoSubscriptionId: "dodo_mig",
        planId: "business",
        priceUSD: 139,
        mirrorCredits: 600_000,
        entitlementSnapshot: historical as unknown as Record<string, unknown>,
      }),
    )
    const prePinned = termsFor({
      subscriptionId: "sub_pin",
      dodoSubscriptionId: "dodo_pin",
      monthlyCredits: 42,
      priceMinor: 1_234,
    })
    h.state.subs.push(
      subRecord({
        id: "sub_pin",
        dodoSubscriptionId: "dodo_pin",
        purchasedTerms: prePinned,
        termsStatus: "pinned",
      }),
    )

    const first = await migrateSubscriptionEntitlements({ mode: "apply", batchId: "batch_1" })
    expect(first.errors).toEqual([])

    const migrated = h.state.subs.find((s) => s.id === "sub_mig")!
    const pinnedRecord = h.state.subs.find((s) => s.id === "sub_pin")!
    expect(migrated.purchasedTerms.entitlementEvidence).toBe("legacy_snapshot")
    expect(migrated.termsStatus).toBe("pinned")
    const migratedJson = JSON.stringify(migrated.purchasedTerms)
    const pinnedJson = JSON.stringify(pinnedRecord.purchasedTerms)

    const second = await migrateSubscriptionEntitlements({ mode: "apply", batchId: "batch_2" })
    expect(second.errors).toEqual([])
    expect(JSON.stringify(migrated.purchasedTerms)).toBe(migratedJson)
    expect(JSON.stringify(pinnedRecord.purchasedTerms)).toBe(pinnedJson)
    expect(migrated.termsMigrationBatchId).toBe("batch_1")
    expect(pinnedRecord.termsMigrationBatchId).toBeUndefined()
  })
})

describe("annual sweep integration", () => {
  it("grants the pinned monthly allocation, not mirrorCredits or the catalog", async () => {
    const now = Date.UTC(2026, 5, 1)
    h.state.subs.push(
      subRecord({
        billingCycle: "annual",
        currentPeriodStart: now - DAY_MS,
        currentPeriodEnd: now + 300 * DAY_MS,
        mirrorCredits: 999_999,
        purchasedTerms: termsFor({ billingInterval: "annual", monthlyCredits: 111 }),
      }),
    )
    h.state.payments.push({
      subscriptionId: "dodo_1",
      paymentType: "subscription",
      status: "succeeded",
    })

    const report = await runAnnualGrantSweep(now)
    expect(report.errors).toEqual([])
    expect(report.granted).toBeGreaterThanOrEqual(1)
    expect(h.grant).toHaveBeenCalledWith(expect.objectContaining({ amount: 111, planId: "starter" }))
    expect(h.grant).not.toHaveBeenCalledWith(expect.objectContaining({ amount: 999_999 }))
  })

  it("honors the pinned annual month count and annual monthly allocation", async () => {
    const now = Date.UTC(2026, 5, 1)
    h.state.subs.push(
      subRecord({
        billingCycle: "annual",
        currentPeriodStart: now - 200 * DAY_MS,
        currentPeriodEnd: now + 200 * DAY_MS,
        purchasedTerms: termsFor({
          billingInterval: "annual",
          monthlyCredits: 999,
          annual: { months: 6, monthlyCredits: 222, totalCredits: 1_332, issuance: "monthly" },
        }),
      }),
    )
    h.state.payments.push({
      subscriptionId: "dodo_1",
      paymentType: "subscription",
      status: "succeeded",
    })

    const report = await runAnnualGrantSweep(now)
    expect(report.errors).toEqual([])
    expect(report.granted).toBe(6)
    expect(h.grant).toHaveBeenCalledWith(expect.objectContaining({ amount: 222 }))
    expect(h.grant).not.toHaveBeenCalledWith(expect.objectContaining({ amount: 999 }))
  })
})

describe("plan change re-pinning", () => {
  it("does not re-pin a duplicate same-plan event", async () => {
    h.state.subs.push(
      subRecord({ purchasedTerms: termsFor({ monthlyCredits: 111, priceMinor: 7_900 }) }),
    )
    const before = JSON.stringify(h.state.subs[0].purchasedTerms)

    await processDodoEvent(
      "subscription.plan_changed",
      { subscription_id: "dodo_1", product_id: "pdt_starter_m" },
      "evt_same_plan",
    )

    expect(JSON.stringify(h.state.subs[0].purchasedTerms)).toBe(before)
    expect(h.state.subs[0].purchasedTerms.monthlyCredits).toBe(111)
  })

  it("re-pins only when the event represents a genuinely different plan", async () => {
    h.state.subs.push(subRecord({ purchasedTerms: termsFor({ monthlyCredits: 111 }) }))

    await processDodoEvent(
      "subscription.plan_changed",
      { subscription_id: "dodo_1", product_id: "pdt_growth_m" },
      "evt_new_plan",
    )

    expect(h.state.subs[0].purchasedTerms.commercialPlanId).toBe("growth")
    expect(h.state.subs[0].purchasedTerms.monthlyCredits).toBe(400_000)
    expect(h.state.subs[0].purchasedTerms.priceMinor).toBe(19_999)
  })

  it("re-pins when the same plan moves to a different billing interval", async () => {
    h.state.subs.push(
      subRecord({
        purchasedTerms: termsFor({ billingInterval: "monthly", monthlyCredits: 111 }),
      }),
    )

    await processDodoEvent(
      "subscription.plan_changed",
      { subscription_id: "dodo_1", product_id: "pdt_starter_y" },
      "evt_interval_change",
    )

    expect(h.state.subs[0].purchasedTerms.billingInterval).toBe("annual")
    expect(h.state.subs[0].purchasedTerms.priceMinor).toBe(98_989)
    expect(h.state.subs[0].purchasedTerms.annual?.totalCredits).toBe(1_800_000)
  })

  it("does nothing when no subscription record exists to re-pin", async () => {
    const result = await processDodoEvent(
      "subscription.plan_changed",
      { subscription_id: "dodo_missing", product_id: "pdt_growth_m" },
      "evt_missing_sub",
    )
    expect(result).toEqual({ status: "processed" })
    expect(h.state.subs).toHaveLength(0)
  })
})


// ─── M-22: live resource counters on pinned snapshots ────────────────────────

describe("pinned snapshots keep live domain and subdomain usage", () => {
  it("counts successful deployments and active custom domains without changing purchased caps", async () => {
    const pinned = buildEntitlementSet("growth", {
      businesses: 0,
      productionApps: 0,
      subdomains: 0,
      customDomainsConsumed: 0,
    })
    pinned.subdomains.max = 1
    pinned.customDomainsIncluded.max = 1
    h.state.subs.push(
      subRecord({
        commercialPlanId: "growth",
        planId: "growth",
        purchasedTerms: termsFor({ entitlementSnapshot: pinned }),
      }),
    )
    h.state.projects.push(
      { id: "p1", userId: "u1", deployment: { status: "success", customDomain: "shop.example.com" } },
      { id: "p2", userId: "u1", deployment: { status: "failed" } },
      { id: "p3", userId: "u1", deploymentHistory: [{ status: "success", customDomain: "legacy.example.com" }] },
    )

    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.subdomains.max).toBe(1)
    expect(set.subdomains.current).toBe(1)
    expect(set.customDomainsIncluded.max).toBe(1)
    expect(set.customDomainsIncluded.consumed).toBe(2)
    expect(checkEntitlement(set, "connectSubdomain").allowed).toBe(false)
    expect(checkEntitlement(set, "registerCustomDomain").allowed).toBe(false)
  })

  it("a failed deployment does not consume a subdomain slot", async () => {
    h.state.projects.push({ id: "p1", userId: "u1", deployment: { status: "failed" } })
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.subdomains.current).toBe(0)
  })
})

// ─── M-22: terminated subscriptions do not keep paid capabilities ────────────

describe("terminated subscriptions fall back to Explorer", () => {
  it("a cancelled paid account with projects cannot build production", async () => {
    h.state.subs.push(
      subRecord({
        status: "cancelled",
        commercialPlanId: "growth",
        planId: "growth",
        purchasedTerms: termsFor({ entitlementSnapshot: buildEntitlementSet("growth", {
          businesses: 0,
          productionApps: 0,
          subdomains: 0,
          customDomainsConsumed: 0,
        }) }),
      }),
    )
    h.state.projects.push({ id: "p1", userId: "u1" })

    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.entitlementSource).toBe("free")
    expect(set.preserveLegacyBehavior).toBe(false)
    expect(checkEntitlement(set, "buildProduction").allowed).toBe(false)
    expect(checkEntitlement(set, "useStorage").allowed).toBe(false)
  })

  it("a legacy free account that never subscribed keeps its existing capability", async () => {
    h.state.projects.push({ id: "p1", userId: "u1" })
    const set = await resolveScope({ kind: "user", userId: "u1" }, { fresh: true })
    expect(set.entitlementSource).toBe("free")
    expect(set.preserveLegacyBehavior).toBe(true)
    expect(checkEntitlement(set, "buildProduction").allowed).toBe(true)
  })
})
