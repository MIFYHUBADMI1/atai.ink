import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A refund can land while the annual sweep is issuing months. The sweep must
 * re-check the upfront charge before every month and stop immediately.
 */

vi.mock("server-only", () => ({}))

const h = vi.hoisted(() => {
  const state: {
    subscriptions: Record<string, unknown>[]
    payments: Record<string, unknown>[]
  } = { subscriptions: [], payments: [] }

  return {
    state,
    grantSubscriptionCredits: vi.fn(),
    linkSubscriptionGrantToPayment: vi.fn(async () => undefined),
    findSubscriptionGrantEntry: vi.fn(async () => ({
      id: "ledger_1",
      idempotencyKey: "annual_grant_sub_1_0",
      metadata: { bucketId: "bucket_1" },
    })),
  }
})

vi.mock("@/lib/db/collections", () => ({
  subscriptionRecordsCol: vi.fn(async () => ({
    find: () => ({ toArray: async () => h.state.subscriptions }),
  })),
  paymentRecordsCol: vi.fn(async () => ({
    findOne: async (filter: Record<string, unknown>) => {
      return (
        h.state.payments.find((payment) => {
          if (payment.subscriptionId !== filter.subscriptionId) return false
          if (payment.paymentType !== filter.paymentType) return false
          const status = filter.status as { $in?: string[] } | undefined
          return status?.$in ? status.$in.includes(payment.status as string) : true
        }) ?? null
      )
    },
  })),
  creditLedgerCol: vi.fn(async () => ({ findOne: async () => null })),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  grantSubscriptionCredits: h.grantSubscriptionCredits,
}))

vi.mock("@/lib/billing/subscription-payment-grants", () => ({
  findSubscriptionGrantEntry: h.findSubscriptionGrantEntry,
  linkSubscriptionGrantToPayment: h.linkSubscriptionGrantToPayment,
}))

import { runAnnualGrantSweep } from "@/lib/billing/entitlements/annual-scheduler"

const NOW = Date.UTC(2026, 0, 15)

describe("annual sweep vs a refund landing mid-run", () => {
  beforeEach(() => {
    h.state.subscriptions = []
    h.state.payments = []
    h.grantSubscriptionCredits.mockReset()
    h.linkSubscriptionGrantToPayment.mockClear()
    h.findSubscriptionGrantEntry.mockClear()
  })

  it("stops issuing months as soon as the upfront charge is fully refunded", async () => {
    h.state.subscriptions.push({
      id: "sub_1",
      userId: "user_1",
      dodoSubscriptionId: "sub_1",
      billingCycle: "annual",
      status: "active",
      currentPeriodStart: Date.UTC(2025, 10, 15),
      currentPeriodEnd: Date.UTC(2026, 10, 15),
      mirrorCredits: 500,
      purchasedTerms: {
        planId: "pro",
        monthlyCredits: 500,
        entitlementVersion: "ent_v1",
        annual: { months: 12, monthlyCredits: 500, totalCredits: 6000 },
      },
    })
    h.state.payments.push({
      subscriptionId: "sub_1",
      paymentType: "subscription",
      status: "succeeded",
      amount: 12000,
      refundedAmountMinor: 0,
    })

    h.grantSubscriptionCredits.mockImplementation(async () => {
      h.state.payments[0].status = "refunded"
      h.state.payments[0].refundedAmountMinor = 12000
      return true
    })

    const report = await runAnnualGrantSweep(NOW)

    expect(h.grantSubscriptionCredits).toHaveBeenCalledTimes(1)
    expect(report.granted).toBe(1)
    expect(report.skipped).toBe(1)
    expect(report.errors).toEqual([])
  })
})
