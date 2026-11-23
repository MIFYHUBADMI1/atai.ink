import { describe, expect, it } from "vitest"
import {
  planHistoricalGrantReconciliation,
  planSubscriptionRefund,
} from "./subscription-refunds"

describe("planSubscriptionRefund (M-14)", () => {
  it("reverses the exact credits recorded on the payment, never a catalog amount", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 123_456,
      originalAmount: 9999,
      refundAmount: 9999,
    })
    expect(plan.ok).toBe(true)
    expect(plan.creditsToReverse).toBe(123_456)
    expect(plan.fullRefund).toBe(true)
  })

  it("uses the actual grant for a partial refund proportionally", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 600_000,
      originalAmount: 12_000,
      refundAmount: 3_000,
    })
    expect(plan.ok).toBe(true)
    expect(plan.partialRefund).toBe(true)
    expect(plan.creditsToReverse).toBe(150_000)
  })

  it("cannot reverse more than the original payment's grant across refunds", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 600_000,
      creditsReversed: 500_000,
      originalAmount: 12_000,
      refundAmount: 6_000,
    })
    expect(plan.ok).toBe(true)
    expect(plan.creditsToReverse).toBe(100_000)
  })

  it("a duplicate refund after the whole grant was reversed is a no-op", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 600_000,
      creditsReversed: 600_000,
      originalAmount: 12_000,
      refundAmount: 12_000,
    })
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe("already_reversed")
    expect(plan.creditsToReverse).toBe(0)
  })

  it("a needs_review grant is never reversed by guessing", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 600_000,
      grantStatus: "needs_review",
      originalAmount: 12_000,
      refundAmount: 12_000,
    })
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe("grant_history_unresolved")
    expect(plan.creditsToReverse).toBe(0)
  })

  it("a payment with no recorded grant is unresolved", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 0,
      originalAmount: 12_000,
      refundAmount: 12_000,
    })
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe("no_recorded_grant")
  })

  it("a partial refund larger than the remaining grant is capped and flagged", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 600_000,
      creditsReversed: 590_000,
      originalAmount: 12_000,
      refundAmount: 6_000,
    })
    expect(plan.ok).toBe(true)
    expect(plan.creditsToReverse).toBe(10_000)
    expect(plan.reviewReason).toBe("partial_refund_exceeds_remaining_grant")
  })

  it("rounds deterministically and a final full refund mops up the remainder", () => {
    const first = planSubscriptionRefund({
      creditsGranted: 100_001,
      originalAmount: 12_000,
      refundAmount: 3_960,
    })
    const second = planSubscriptionRefund({
      creditsGranted: 100_001,
      creditsReversed: first.creditsToReverse,
      originalAmount: 12_000,
      refundAmount: 3_960,
    })
    const third = planSubscriptionRefund({
      creditsGranted: 100_001,
      creditsReversed: first.creditsToReverse + second.creditsToReverse,
      originalAmount: 12_000,
      refundAmount: 4_080,
    })
    const final = planSubscriptionRefund({
      creditsGranted: 100_001,
      creditsReversed:
        first.creditsToReverse + second.creditsToReverse + third.creditsToReverse,
      originalAmount: 12_000,
      refundAmount: 12_000,
    })

    expect(first.creditsToReverse).toBe(33_000)
    expect(second.creditsToReverse).toBe(33_000)
    expect(third.creditsToReverse).toBe(34_000)
    expect(final.creditsToReverse).toBe(1)
    expect(
      first.creditsToReverse +
        second.creditsToReverse +
        third.creditsToReverse +
        final.creditsToReverse,
    ).toBe(100_001)
  })

  it("a refund without an original amount is unresolved, not a full reversal", () => {
    const plan = planSubscriptionRefund({
      creditsGranted: 600_000,
      refundAmount: 6_000,
    })
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe("original_amount_missing")
    expect(plan.creditsToReverse).toBe(0)
  })
})

describe("planHistoricalGrantReconciliation", () => {
  const payment = {
    paymentType: "subscription",
    status: "succeeded" as const,
    creditsGranted: undefined,
    grantStatus: undefined,
  }

  it("links a single unambiguous grant", () => {
    const plan = planHistoricalGrantReconciliation({
      payment,
      grants: [
        {
          id: "ledger_1",
          amount: 50_000,
          metadata: { bucketId: "bucket_1" },
        },
      ],
    })
    expect(plan).toEqual({
      action: "link",
      creditsGranted: 50_000,
      ledgerEntryIds: ["ledger_1"],
      bucketIds: ["bucket_1"],
      grantStatus: "granted",
    })
  })

  it("marks a payment with no matching grant for review", () => {
    const plan = planHistoricalGrantReconciliation({ payment, grants: [] })
    expect(plan).toEqual({ action: "review", reason: "no_matching_grant" })
  })

  it("marks ambiguous grants for review instead of picking one", () => {
    const plan = planHistoricalGrantReconciliation({
      payment,
      grants: [
        { id: "ledger_1", amount: 50_000 },
        { id: "ledger_2", amount: 50_000 },
      ],
    })
    expect(plan).toEqual({ action: "review", reason: "ambiguous_matching_grant" })
  })

  it("does not touch permanent packs", () => {
    const plan = planHistoricalGrantReconciliation({
      payment: { ...payment, paymentType: "permanent_credit_pack" },
      grants: [{ id: "ledger_1", amount: 50_000 }],
    })
    expect(plan).toEqual({ action: "review", reason: "not_a_subscription_payment" })
  })

  it("is idempotent for an already-flagged payment", () => {
    const plan = planHistoricalGrantReconciliation({
      payment: { ...payment, grantStatus: "needs_review" },
      grants: [{ id: "ledger_1", amount: 50_000 }],
    })
    expect(plan).toEqual({ action: "review", reason: "already_flagged" })
  })
})
