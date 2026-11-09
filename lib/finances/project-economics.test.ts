import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { ledgerColMock, usageColMock, ensureIndexesMock } = vi.hoisted(() => ({
  ledgerColMock: vi.fn(),
  usageColMock: vi.fn(),
  ensureIndexesMock: vi.fn(async () => {}),
}))

vi.mock("@/lib/db/collections", () => ({ creditLedgerCol: ledgerColMock }))
vi.mock("@/lib/db/runtime-collections", () => ({
  runtimeUsageCol: usageColMock,
  ensureRuntimeIndexes: ensureIndexesMock,
}))

import {
  classifyLedgerRow,
  foldLedgerRows,
  costStatusFromGroupParts,
  foldProviderCostRows,
  computeProjectEconomics,
  PROJECT_CREDIT_CONSUMPTION_TYPES,
  PROJECT_CREDIT_REVERSAL_TYPES,
  type LedgerGroupRow,
  type UsageCostGroupRow,
} from "./project-economics"
import { consumedCreditsValueUsd } from "@/lib/billing/credit-valuation"

/**
 * Phase 2 — project economics accounting. Deterministic fixtures, NO real
 * Mongo and NO billable operations: the collections are stubbed and every
 * aggregation input is a hand-written grouped row.
 */

// ─── classifyLedgerRow ──────────────────────────────────────────────────────

describe("classifyLedgerRow", () => {
  it("treats every declared consumption type as consumption when debit", () => {
    for (const t of PROJECT_CREDIT_CONSUMPTION_TYPES) {
      expect(classifyLedgerRow("debit", t)).toBe("consumption")
    }
  })

  it("treats every declared reversal type as reversal when credit", () => {
    for (const t of PROJECT_CREDIT_REVERSAL_TYPES) {
      expect(classifyLedgerRow("credit", t)).toBe("reversal")
    }
  })

  it("funding credits never net (catch-all protects future grant types)", () => {
    expect(classifyLedgerRow("credit", "signup_bonus")).toBe("funding_ignored")
    expect(classifyLedgerRow("credit", "plan_purchase")).toBe("funding_ignored")
    expect(classifyLedgerRow("credit", "subscription_renewal")).toBe("funding_ignored")
    expect(classifyLedgerRow("credit", "some_future_grant_type")).toBe("funding_ignored")
  })

  it("unknown direction and unknown debit types are unclassified, never guessed", () => {
    expect(classifyLedgerRow("", "runtime_usage")).toBe("unclassified")
    expect(classifyLedgerRow("debit", "signup_bonus")).toBe("unclassified")
    expect(classifyLedgerRow("credit", "runtime_usage")).toBe("funding_ignored")
  })
})

// ─── foldLedgerRows ─────────────────────────────────────────────────────────

function lrow(
  transactionType: string,
  direction: string,
  entries: number,
  credits: number,
  withProjectId?: number,
): LedgerGroupRow {
  return { _id: { transactionType, direction }, entries, credits, withProjectId }
}

describe("foldLedgerRows", () => {
  it("bucket-split charges (…_sub + …_perm) sum once — no double count", () => {
    // A 1,000-credit charge split 600/400 across buckets arrives (post-group)
    // as entries:2, credits:1000 — summing amounts is exactly the charged total.
    const { economics } = foldLedgerRows([lrow("runtime_usage", "debit", 2, 1000, 2)])
    expect(economics.grossConsumedCredits).toBe(1000)
    expect(economics.reversalCredits).toBe(0)
    expect(economics.netConsumedCredits).toBe(1000)
    expect(economics.entriesWithFirstClassProjectId).toBe(2)
    expect(economics.legacyAttributedEntries).toBe(0)
  })

  it("verified reversals net; funding credits do NOT", () => {
    const { economics, negativeNet } = foldLedgerRows([
      lrow("build_reservation", "debit", 1, 500, 1),
      lrow("build_release", "credit", 1, 200, 1),
      lrow("signup_bonus", "credit", 1, 3000, 0),
      lrow("fork_royalty", "credit", 1, 40, 0),
    ])
    expect(economics.grossConsumedCredits).toBe(500)
    expect(economics.reversalCredits).toBe(200)
    expect(economics.netConsumedCredits).toBe(300)
    expect(negativeNet).toBe(false)
    const royalty = economics.byTransactionType.find((r) => r.transactionType === "fork_royalty")
    expect(royalty?.bucket).toBe("funding_ignored")
  })

  it("legacy reference-only rows are counted separately, never rewritten", () => {
    const { economics } = foldLedgerRows([lrow("ai_collaboration", "debit", 3, 45, 1)])
    expect(economics.entriesWithFirstClassProjectId).toBe(1)
    expect(economics.legacyAttributedEntries).toBe(2)
  })

  it("negative net is surfaced as an anomaly flag, never floored to 0", () => {
    const { economics, negativeNet } = foldLedgerRows([
      lrow("runtime_usage", "debit", 1, 10, 1),
      lrow("runtime_refund", "credit", 1, 30, 1),
    ])
    expect(economics.netConsumedCredits).toBe(-20)
    expect(negativeNet).toBe(true)
  })

  it("empty ledger → typed zeros", () => {
    const { economics, negativeNet } = foldLedgerRows([])
    expect(economics).toMatchObject({
      grossConsumedCredits: 0,
      reversalCredits: 0,
      netConsumedCredits: 0,
      legacyAttributedEntries: 0,
      entriesWithFirstClassProjectId: 0,
    })
    expect(economics.byTransactionType).toEqual([])
    expect(negativeNet).toBe(false)
  })
})

// ─── costStatusFromGroupParts / foldProviderCostRows ────────────────────────

describe("costStatusFromGroupParts", () => {
  const base = { numeric: true, source: "provider_reported", currency: "usd", statusHint: "" }
  it("explicit persisted status is authoritative (same precedence as deriveCostStatus)", () => {
    expect(costStatusFromGroupParts({ ...base, statusHint: "confirmed" })).toBe("confirmed")
    expect(costStatusFromGroupParts({ ...base, statusHint: "estimated" })).toBe("estimated")
    expect(costStatusFromGroupParts({ ...base, statusHint: "unavailable" })).toBe("unavailable")
    expect(costStatusFromGroupParts({ ...base, statusHint: "not_applicable" })).toBe("not_applicable")
  })
  it("legacy rows derive: numeric → confirmed, provider_estimated → estimated, non-numeric → unavailable", () => {
    expect(costStatusFromGroupParts(base)).toBe("confirmed")
    expect(costStatusFromGroupParts({ ...base, source: "provider_estimated" })).toBe("estimated")
    expect(costStatusFromGroupParts({ ...base, numeric: false })).toBe("unavailable")
  })
})

function crow(
  parts: Partial<UsageCostGroupRow["_id"]>,
  events: number,
  amount: number,
): UsageCostGroupRow {
  return {
    _id: { numeric: true, source: "provider_reported", currency: "usd", statusHint: "", ...parts },
    events,
    amount,
  }
}

describe("foldProviderCostRows", () => {
  it("keeps currencies separate — never sums UGX into USD", () => {
    const folded = foldProviderCostRows([
      crow({ currency: "usd" }, 2, 0.03),
      crow({ currency: "ugx" }, 1, 4000),
      crow({ currency: "" }, 1, 7),
    ])
    expect(folded.confirmedByCurrency).toEqual({ USD: 0.03, UGX: 4000, unknown: 7 })
    expect(folded.nonUsdEvents).toBe(2)
    expect(folded.eventsWithNumericCost).toBe(4)
  })

  it("estimated costs stay in their own classification bucket", () => {
    const folded = foldProviderCostRows([
      crow({ statusHint: "estimated" }, 1, 0.5),
      crow({ source: "provider_estimated" }, 1, 0.25),
    ])
    expect(folded.estimatedByCurrency).toEqual({ USD: 0.75 })
    expect(folded.confirmedByCurrency).toEqual({})
  })

  it("unavailable events are COUNTED, never summed as 0 into costs", () => {
    const folded = foldProviderCostRows([crow({ numeric: false, currency: "unknown" }, 9, 0)])
    expect(folded.unavailableEventCount).toBe(9)
    expect(folded.eventsWithNumericCost).toBe(0)
    expect(folded.confirmedByCurrency).toEqual({})
  })

  it("empty rows → typed zeros", () => {
    const folded = foldProviderCostRows([])
    expect(folded).toMatchObject({
      confirmedByCurrency: {},
      estimatedByCurrency: {},
      unavailableEventCount: 0,
      notApplicableEventCount: 0,
      eventsWithNumericCost: 0,
      nonUsdEvents: 0,
    })
  })
})

// ─── computeProjectEconomics (stubbed collections) ──────────────────────────

interface Fixture {
  ledger?: LedgerGroupRow[]
  totals?: { requests: number; succeeded: number; failed: number; refunded: number }
  costs?: UsageCostGroupRow[]
  grouped?: Record<string, Array<{ _id: string; requests: number; creditsCharged: number; usd: number; unavailableCount: number }>>
  daily?: Array<{ _id: string; requests: number; usd: number; unavailableCount: number; nonUsdCount: number }>
  orphanCount?: number
  /** find() returns documents; the service maps .requestId off each doc. */
  orphanSamples?: Array<{ requestId: string }>
}

function fakeCollections(fixture: Fixture) {
  ledgerColMock.mockResolvedValue({
    aggregate: () => ({ toArray: async () => fixture.ledger ?? [] }),
  })
  usageColMock.mockImplementation(() => ({
    aggregate: (pipeline: Array<Record<string, unknown>>) => ({
      toArray: async () => {
        const group = pipeline[1]?.$group as { _id: unknown } | undefined
        const id = group?._id as Record<string, unknown> | null | undefined
        if (id === null) return [{ _id: null, ...fixture.totals }]
        if (id && "numeric" in id) return fixture.costs ?? []
        if (id && "$dateToString" in id) return fixture.daily ?? []
        if (id && "$ifNull" in id) {
          const spec = id["$ifNull"] as [string, string]
          return fixture.grouped?.[spec[0].slice(1)] ?? []
        }
        return []
      },
    }),
    countDocuments: async () => fixture.orphanCount ?? 0,
    find: () => ({ toArray: async () => fixture.orphanSamples ?? [] }),
  }))
}

beforeEach(() => {
  ledgerColMock.mockReset()
  usageColMock.mockReset()
})

describe("computeProjectEconomics", () => {
  it("assembles credits + per-currency provider cost + diagnostics without double counting", async () => {
    fakeCollections({
      ledger: [
        lrow("runtime_usage", "debit", 2, 600, 2),
        lrow("runtime_refund", "credit", 1, 100, 1),
        lrow("plan_purchase", "credit", 1, 10_000, 0),
      ],
      totals: { requests: 5, succeeded: 4, failed: 1, refunded: 1 },
      costs: [
        crow({ currency: "usd" }, 2, 0.02),
        crow({ currency: "ugx" }, 1, 7500),
        crow({ numeric: false, currency: "unknown" }, 1, 0),
      ],
      grouped: {
        capability: [{ _id: "ai.text", requests: 4, creditsCharged: 600, usd: 0.02, unavailableCount: 1 }],
        provider: [{ _id: "openrouter", requests: 4, creditsCharged: 600, usd: 0.02, unavailableCount: 1 }],
        model: [{ _id: "openai/gpt-test", requests: 4, creditsCharged: 600, usd: 0.02, unavailableCount: 1 }],
      },
      daily: [{ _id: "2026-10-24", requests: 4, usd: 0.02, unavailableCount: 1, nonUsdCount: 1 }],
      orphanCount: 2,
      orphanSamples: [{ requestId: "rtreq_a" }, { requestId: "rtreq_b" }],
    })

    const res = await computeProjectEconomics({ projectId: "p1", userId: "u1" })

    // Credits: ledger is the ONLY source; runtime telemetry is never added.
    expect(res.credits.grossConsumedCredits).toBe(600)
    expect(res.credits.reversalCredits).toBe(100)
    expect(res.credits.netConsumedCredits).toBe(500)
    expect(res.credits.referenceValueUsd).toBe(consumedCreditsValueUsd(500))
    expect(res.credits.valuationVersion).toBe("ATAI_CREDIT_VALUATION_V1")
    // Provider cost: per currency, never merged; unavailable counted.
    expect(res.providerCost.confirmedByCurrency).toEqual({ USD: 0.02, UGX: 7500 })
    expect(res.providerCost.unavailableEventCount).toBe(1)
    expect(res.providerCost.eventsWithNumericCost).toBe(3)
    expect(res.providerCost.costCoverageRatio).toBe(3 / 4)
    expect(res.providerCost.succeededEvents).toBe(4)
    expect(res.providerCost.refundedEvents).toBe(1)
    // Grouped rows carry their own label field.
    expect(res.providerCost.byCapability[0]).toMatchObject({ capability: "ai.text", requests: 4 })
    expect(res.providerCost.byProvider[0]).toMatchObject({ provider: "openrouter" })
    expect(res.providerCost.byModel[0]).toMatchObject({ model: "openai/gpt-test" })
    expect(res.providerCost.daily[0]).toMatchObject({ date: "2026-10-24", nonUsdCount: 1 })
    // Diagnostics are discoverable, records untouched.
    expect(res.diagnostics.billableUsageWithoutLedgerKey).toEqual({
      count: 2,
      sampleRequestIds: ["rtreq_a", "rtreq_b"],
    })
    expect(res.diagnostics.negativeNetConsumption).toBe(false)
    expect(res.diagnostics.nonUsdProviderCostEvents).toBe(1)
    // Revenue is explicitly NOT calculated from the credit valuation.
    expect(res.recognizedRevenue.status).toBe("not_supported")
    // Bounded ledger + window clamp.
    expect(res.window.to - res.window.from).toBeLessThanOrEqual(90 * 24 * 60 * 60 * 1000)
  })

  it("filters ledger by the owner-checked userId (defense-in-depth)", async () => {
    fakeCollections({})
    let ledgerMatch: Record<string, unknown> | undefined
    ledgerColMock.mockImplementation(() => ({
      aggregate: (pipeline: Array<Record<string, unknown>>) => {
        ledgerMatch = pipeline[0].$match as Record<string, unknown>
        return { toArray: async () => [] }
      },
    }))
    await computeProjectEconomics({ projectId: "p1", userId: "u1" })
    expect(ledgerMatch?.userId).toBe("u1")
    expect(ledgerMatch?.$or).toEqual([{ projectId: "p1" }, { referenceType: "project", referenceId: "p1" }])
  })

  it("empty project → typed zero result, coverage null (not a fake 100%)", async () => {
    fakeCollections({})
    const res = await computeProjectEconomics({ projectId: "empty", userId: "u1" })
    expect(res.credits.netConsumedCredits).toBe(0)
    expect(res.credits.referenceValueUsd).toBe(0)
    expect(res.providerCost.costCoverageRatio).toBeNull()
    expect(res.providerCost.confirmedByCurrency).toEqual({})
    expect(res.recognizedRevenue.status).toBe("not_supported")
  })
})

// ─── Phase 3 Workstream F: reversal multiplicity + vocabulary alignment ──────

describe("Phase 3 — refund/reversal rows cannot distort project economics", () => {
  it("every shared reversal-vocabulary type nets when credit-direction", async () => {
    const { CREDIT_REVERSAL_TRANSACTION_TYPES } = await import("@/lib/billing/reversal-types")
    for (const t of CREDIT_REVERSAL_TRANSACTION_TYPES) {
      expect(classifyLedgerRow("credit", t)).toBe("reversal")
    }
    // A historical `build_refund` row is a credits-back movement: if project
    // accounting ignored it, net consumption would be OVERSTATED. This is the
    // regression the Phase 3 vocabulary alignment fixes.
    const { economics } = foldLedgerRows([
      lrow("build_reservation", "debit", 1, 500, 1),
      lrow("build_refund", "credit", 1, 500, 1),
    ])
    expect(economics.netConsumedCredits).toBe(0)
  })

  it("a Dodo clawback (refund_reversal, debit) neither charges nor nets a project", () => {
    // `reverseCredits` writes direction "debit": it takes purchased credits BACK
    // from the account. That is not project work and not a consumption refund,
    // so it must stay visible but inert.
    const { economics } = foldLedgerRows([
      lrow("runtime_usage", "debit", 2, 600, 2),
      lrow("runtime_refund", "credit", 1, 100, 1),
      lrow("refund_reversal", "debit", 1, 10_000, 1),
    ])
    expect(economics.grossConsumedCredits).toBe(600)
    expect(economics.reversalCredits).toBe(100)
    expect(economics.netConsumedCredits).toBe(500)
    const clawback = economics.byTransactionType.find((r) => r.transactionType === "refund_reversal")
    expect(clawback?.bucket).toBe("unclassified")
    expect(clawback?.credits).toBe(10_000)
  })

  it("one refund written as a reversal row offsets exactly once — never twice", () => {
    // The same economic movement appearing under two DIFFERENT reversal types
    // (a runtime refund plus an administrative other_reversal) offsets the sum
    // of both rows, and the sum can only exceed consumption if the data really
    // says so — which raises the anomaly flag instead of being floored.
    const { economics, negativeNet } = foldLedgerRows([
      lrow("runtime_usage", "debit", 1, 300, 1),
      lrow("runtime_refund", "credit", 1, 300, 1),
      lrow("other_reversal", "credit", 1, 300, 1),
    ])
    expect(economics.grossConsumedCredits).toBe(300)
    expect(economics.reversalCredits).toBe(600)
    expect(economics.netConsumedCredits).toBe(-300)
    expect(negativeNet).toBe(true)
  })

  it("a bucket-split charge refunded by one row nets to exactly zero", () => {
    // consumeCredits writes `…_sub` + `…_perm` for a split charge (2 entries,
    // amounts summing to the charge); the refund path writes ONE credit row.
    const { economics, negativeNet } = foldLedgerRows([
      lrow("ai_collaboration", "debit", 2, 1000, 2),
      lrow("other_reversal", "credit", 1, 1000, 1),
    ])
    expect(economics.grossConsumedCredits).toBe(1000)
    expect(economics.netConsumedCredits).toBe(0)
    expect(negativeNet).toBe(false)
  })

  it("account-level payments and grants never become project figures", async () => {
    fakeCollections({
      ledger: [
        lrow("credit_purchase", "credit", 1, 100_000, 0),
        lrow("subscription_grant", "credit", 1, 50_000, 0),
        lrow("welcome_bonus", "credit", 1, 5_000, 0),
        lrow("runtime_usage", "debit", 1, 120, 1),
      ],
      totals: { requests: 1, succeeded: 1, failed: 0, refunded: 0 },
      costs: [crow({}, 1, 0.01)],
    })
    const res = await computeProjectEconomics({ projectId: "p1", userId: "u1" })
    expect(res.credits.grossConsumedCredits).toBe(120)
    expect(res.credits.reversalCredits).toBe(0)
    expect(res.credits.netConsumedCredits).toBe(120)
    expect(res.credits.byTransactionType.filter((r) => r.bucket === "funding_ignored")).toHaveLength(3)
    // No revenue/profit figure is invented from the valuation.
    expect(res.recognizedRevenue.status).toBe("not_supported")
    expect(JSON.stringify(res)).not.toMatch(/"(profit|margin|roi|revenueUsd)"/)
  })

  it("credits come from the ledger only — runtime telemetry is reported separately", async () => {
    fakeCollections({
      ledger: [lrow("runtime_usage", "debit", 1, 120, 1)],
      totals: { requests: 3, succeeded: 3, failed: 0, refunded: 0 },
      costs: [crow({}, 3, 0.03)],
      // Telemetry claims a DIFFERENT (larger) credit number on purpose.
      grouped: {
        capability: [{ _id: "ai.text", requests: 3, creditsCharged: 999_999, usd: 0.03, unavailableCount: 0 }],
      },
    })
    const res = await computeProjectEconomics({ projectId: "p1", userId: "u1" })
    expect(res.credits.netConsumedCredits).toBe(120)
    expect(res.providerCost.byCapability[0]?.creditsChargedTelemetry).toBe(999_999)
    // Provider cost still comes from usage rows only — never from credits.
    expect(res.providerCost.confirmedByCurrency).toEqual({ USD: 0.03 })
    expect(res.providerCost.eventsWithNumericCost).toBe(3)
  })
})
