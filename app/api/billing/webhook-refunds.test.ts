import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Phase 3 — Workstream D refund-accounting integrity tests (§11 "Refunds and
 * revenue"). Deterministic, mocked provider events; no real payments, refunds
 * or grants are ever executed.
 *
 * The payment collection is a tiny in-memory fake keyed on `dodoPaymentId`
 * (mirroring the real unique index) so replays exercise the SAME code paths
 * the recovery worker uses.
 */

vi.mock("server-only", () => ({}))

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  payments: [] as Row[],
  inserted: [] as Row[],
  reversed: [] as Row[],
  granted: [] as Row[],
  reverseShouldFail: false,
}))

function payColFake() {
  return {
    async findOne(query: Record<string, unknown>) {
      const id = query.dodoPaymentId
      if (typeof id !== "string") return null
      return state.payments.find((p) => p.dodoPaymentId === id) ?? null
    },
    async insertOne(doc: Record<string, unknown>) {
      if (state.payments.some((p) => p.dodoPaymentId === doc.dodoPaymentId)) {
        throw new Error("E11000 duplicate key error")
      }
      state.payments.push(doc)
      state.inserted.push(doc)
      return { acknowledged: true }
    },
    async updateOne(query: Record<string, unknown>, update: Record<string, unknown>) {
      const id = (query.dodoPaymentId ?? query._id) as string
      const doc = state.payments.find((p) => p.dodoPaymentId === id)
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      const inc = (update.$inc ?? {}) as Record<string, number>
      for (const [k, v] of Object.entries(inc)) doc[k] = ((doc[k] as number) ?? 0) + v
      const set = (update.$set ?? {}) as Record<string, unknown>
      for (const [k, v] of Object.entries(set)) doc[k] = v
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }
}

const { mockEventCol, mockVerify } = vi.hoisted(() => ({
  mockEventCol: {
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
  },
  mockVerify: vi.fn(),
}))

vi.mock("@/lib/billing/dodo-webhook", () => ({ verifyWebhookSignature: mockVerify }))

vi.mock("@/lib/db/collections", () => ({
  webhookEventsCol: vi.fn().mockResolvedValue(mockEventCol),
  paymentRecordsCol: vi.fn().mockResolvedValue(payColFake()),
  subscriptionRecordsCol: vi.fn().mockResolvedValue({ findOne: vi.fn(), updateOne: vi.fn(), insertOne: vi.fn() }),
  creditLedgerCol: vi.fn().mockResolvedValue({ findOne: vi.fn().mockResolvedValue(null) }),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  grantCredits: (params: Record<string, unknown>) => {
    state.granted.push(params)
    return Promise.resolve({ success: true, ledgerEntry: { id: "le_grant" } })
  },
  grantSubscriptionCredits: vi.fn().mockResolvedValue(true),
  expireSubscriptionCredits: vi.fn().mockResolvedValue(undefined),
  reverseCredits: (params: Record<string, unknown>) => {
    state.reversed.push(params)
    if (state.reverseShouldFail) return Promise.resolve({ success: false })
    return Promise.resolve({ success: true })
  },
}))

vi.mock("@/lib/billing/activate-subscription", () => ({
  activatePaidSubscription: vi.fn().mockResolvedValue({ ok: true, planId: "pro" }),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "./webhook/route"

function webhookRequest(payload: unknown, webhookId = `wh_${Math.random().toString(36).slice(2)}`) {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-signature": "v1,deadbeef",
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    },
  })
}

async function deliver(payload: unknown, webhookId?: string) {
  const res = await POST(webhookRequest(payload, webhookId))
  // Ack = durably recorded, never "effects completed" (Workstream A invariant).
  expect(res.status).toBe(200)
  return res
}

function lastEvent(): Record<string, unknown> {
  const calls = mockEventCol.updateOne.mock.calls
  const last = calls[calls.length - 1] as [unknown, { $set: Record<string, unknown> }]
  return last[1].$set
}

function seedPayment(overrides: Record<string, unknown> = {}) {
  state.payments.push({
    _id: `oid_${state.payments.length}`,
    id: "pay_local_1",
    dodoPaymentId: "pay_1000",
    userId: "u1",
    amount: 5000, // minor units — US$50.00
    currency: "USD",
    status: "succeeded",
    paymentType: "permanent_credit_pack",
    creditsGranted: 10_000,
    creditType: "permanent",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  })
}

function payment(dodoPaymentId: string) {
  return state.payments.find((p) => p.dodoPaymentId === dodoPaymentId)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.payments = []
  state.inserted = []
  state.reversed = []
  state.granted = []
  state.reverseShouldFail = false
  mockVerify.mockReturnValue({ valid: true })
  mockEventCol.findOne.mockResolvedValue(null)
  mockEventCol.insertOne.mockResolvedValue({ acknowledged: true })
  mockEventCol.updateOne.mockResolvedValue({ acknowledged: true })
})

describe("payment without a refund", () => {
  it("grants once and leaves the payment untouched", async () => {
    await deliver({
      type: "payment.succeeded",
      data: {
        payment_id: "pay_1000",
        total_amount: 5000,
        currency: "USD",
        metadata: { userId: "u1", credits: "10000", packageId: "pack_10k" },
      },
    })
    expect(state.granted).toHaveLength(1)
    expect(state.granted[0]).toMatchObject({ amount: 10_000, idempotencyKey: "payment_pay_1000" })
    expect(state.reversed).toHaveLength(0)
    const refundRows = state.inserted.filter((r) => r.paymentType === "refund")
    expect(refundRows).toHaveLength(0)
    expect(lastEvent().status).toBe("processed")
  })
})

describe("full refund", () => {
  beforeEach(() => seedPayment())

  it("reverses the grant under the stable refund key and keeps the original row", async () => {
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_1", payment_id: "pay_1000", amount: 5000, currency: "USD" },
    })

    expect(state.reversed).toHaveLength(1)
    expect(state.reversed[0]).toMatchObject({
      userId: "u1",
      amount: 10_000,
      transactionType: "refund_reversal",
      idempotencyKey: "refund_rf_1",
      referenceType: "refund",
      referenceId: "rf_1",
    })

    // The refund is its own traceable row with a NEGATIVE amount...
    const refundRow = payment("rf_1")
    expect(refundRow).toBeTruthy()
    expect(refundRow).toMatchObject({
      paymentType: "refund",
      status: "refunded",
      amount: -5000,
      currency: "USD",
      originalPaymentId: "pay_1000",
      refundId: "rf_1",
    })

    // ...and the original payment is NOT overwritten as if it never happened:
    // its own identity, amount and grant history survive.
    const original = payment("pay_1000")
    expect(original).toMatchObject({
      amount: 5000,
      creditsGranted: 10_000,
      createdAt: 1_700_000_000_000,
      userId: "u1",
      status: "refunded",
      refundedAmountMinor: 5000,
    })
    expect(lastEvent().status).toBe("processed")
  })

  it("repeated refund events do not duplicate the reversal or the progress", async () => {
    const payload = {
      type: "refund.succeeded",
      data: { refund_id: "rf_1", payment_id: "pay_1000", amount: 5000, currency: "USD" },
    }
    await deliver(payload, "wh_a")
    await deliver(payload, "wh_b")

    expect(state.reversed).toHaveLength(1)
    expect(state.inserted.filter((r) => r.paymentType === "refund")).toHaveLength(1)
    expect(payment("pay_1000")?.refundedAmountMinor).toBe(5000)
  })
})

describe("partial refund", () => {
  beforeEach(() => seedPayment())

  it("reverses only the proportional share and marks the payment partially refunded", async () => {
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_half", payment_id: "pay_1000", amount: 1250, currency: "USD" },
    })
    expect(state.reversed[0]).toMatchObject({ amount: 2_500 })
    expect(state.reversed[0]!.metadata).toMatchObject({ partialRefund: true })
    expect(payment("pay_1000")).toMatchObject({ status: "partially_refunded", refundedAmountMinor: 1250 })
  })

  it("keeps distinct legitimate partial refunds distinguishable", async () => {
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_a", payment_id: "pay_1000", amount: 1000, currency: "USD" },
    })
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_b", payment_id: "pay_1000", amount: 2000, currency: "USD" },
    })
    expect(state.reversed.map((r) => r.idempotencyKey)).toEqual(["refund_rf_a", "refund_rf_b"])
    expect(state.reversed.map((r) => r.amount)).toEqual([2_000, 4_000])
    expect(payment("pay_1000")).toMatchObject({ status: "partially_refunded", refundedAmountMinor: 3000 })
    expect(payment("rf_a")).toBeTruthy()
    expect(payment("rf_b")).toBeTruthy()
  })

  it("never guesses a ratio when the original amount is unknown", async () => {
    seedPayment({ dodoPaymentId: "pay_noamt", amount: undefined })
    state.payments = state.payments.filter((p) => p.dodoPaymentId !== "pay_1000")
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_x", payment_id: "pay_noamt", amount: 1250, currency: "USD" },
    })
    // No authoritative original amount → the agreed policy is the FULL grant
    // reversal, labeled in metadata, rather than an invented ratio.
    expect(state.reversed[0]).toMatchObject({ amount: 10_000 })
    expect(state.reversed[0]!.metadata).toMatchObject({ partialRefund: false })
    // The refund row still carries its own amount; the original is not given a
    // fabricated monetary progress against an unknown total.
    expect(payment("pay_noamt")?.refundedAmountMinor).toBe(1250)
  })
})

describe("refund rows are never double-netted", () => {
  it("a refund event never writes a second collection row", async () => {
    seedPayment()
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_1", payment_id: "pay_1000", amount: 5000, currency: "USD" },
    })
    const collections = state.inserted.filter((r) => r.paymentType !== "refund")
    expect(collections).toHaveLength(0)
    // The original payment row is still a single row — its status advanced, it
    // was not duplicated into "before/after" copies.
    expect(state.payments.filter((p) => p.dodoPaymentId === "pay_1000")).toHaveLength(1)
  })
})

describe("refund that cannot be safely applied stays discoverable", () => {
  it("refund succeeds but the credit reversal fails → event is failed, not processed", async () => {
    seedPayment()
    state.reverseShouldFail = true
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_fail", payment_id: "pay_1000", amount: 5000, currency: "USD" },
    })
    const evt = lastEvent()
    expect(evt.status).toBe("failed")
    expect(String(evt.error)).toMatch(/reversal failed/i)
    // The discrepancy is preserved, not silently "handled": no refund row and
    // no progress on the original, so recovery can re-run it idempotently.
    expect(payment("rf_fail")).toBeUndefined()
    expect(payment("pay_1000")?.refundedAmountMinor).toBeUndefined()
    expect(payment("pay_1000")?.status).toBe("succeeded")
  })

  it("refund with no matching original payment grants nothing and stays unresolved", async () => {
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_orphan", payment_id: "pay_missing", amount: 5000, currency: "USD" },
    })
    expect(state.reversed).toHaveLength(0)
    expect(state.inserted).toHaveLength(0)
    const evt = lastEvent()
    expect(evt.status).toBe("unresolved")
    expect(String(evt.error)).toMatch(/no matching original payment/i)
  })

  it("currency mismatch is never converted or guessed", async () => {
    seedPayment({ currency: "USD" })
    await deliver({
      type: "refund.succeeded",
      data: { refund_id: "rf_eur", payment_id: "pay_1000", amount: 5000, currency: "EUR" },
    })
    expect(state.reversed).toHaveLength(0)
    const evt = lastEvent()
    expect(evt.status).toBe("unresolved")
    expect(String(evt.error)).toMatch(/currency/i)
    expect(payment("pay_1000")?.status).toBe("succeeded")
  })

  it("a refund event without refund/payment identifiers attributes nothing", async () => {
    seedPayment()
    await deliver({ type: "refund.succeeded", data: { amount: 5000, currency: "USD" } })
    expect(state.reversed).toHaveLength(0)
    expect(lastEvent().status).toBe("unresolved")
  })

  it("amount absent → nothing is recorded as a confirmed monetary refund", async () => {
    seedPayment()
    await deliver({ type: "refund.succeeded", data: { refund_id: "rf_noamt", payment_id: "pay_1000" } })
    const refundRow = payment("rf_noamt")
    expect(refundRow).toBeTruthy()
    expect(refundRow!.amount).toBeUndefined()
    // Credit reversal still follows the confirmed grant (Dodo confirmed the
    // refund), but no progress FIGURE is invented on the original.
    expect(state.reversed).toHaveLength(1)
    expect(payment("pay_1000")).toMatchObject({ status: "refunded" })
    expect(payment("pay_1000")?.refundedAmountMinor).toBeUndefined()
  })
})

describe("failed and cancelled payments are not revenue", () => {
  it("payment.failed records the provider status and grants nothing", async () => {
    await deliver({ type: "payment.failed", data: { payment_id: "pay_f", total_amount: 5000, currency: "USD" } })
    expect(state.granted).toHaveLength(0)
    expect(payment("pay_f")).toMatchObject({ status: "failed" })
    expect(payment("pay_f")?.paymentType).not.toBe("permanent_credit_pack")
  })

  it("payment.cancelled records the provider status and grants nothing", async () => {
    await deliver({ type: "payment.cancelled", data: { payment_id: "pay_c", total_amount: 5000, currency: "USD" } })
    expect(state.granted).toHaveLength(0)
    expect(payment("pay_c")).toMatchObject({ status: "cancelled" })
  })
})

describe("mixed currencies stay separated at the record layer", () => {
  it("records each payment in the currency the provider reported", async () => {
    await deliver({
      type: "payment.succeeded",
      data: { payment_id: "pay_usd", total_amount: 5000, currency: "USD", metadata: { userId: "u1", credits: "10000" } },
    })
    await deliver({
      type: "payment.succeeded",
      data: { payment_id: "pay_eur", total_amount: 4500, currency: "EUR", metadata: { userId: "u1", credits: "10000" } },
    })
    expect(payment("pay_usd")).toMatchObject({ amount: 5000, currency: "USD" })
    expect(payment("pay_eur")).toMatchObject({ amount: 4500, currency: "EUR" })
    expect(payment("pay_eur")?.currency).not.toBe("USD")
  })

  it("an omitted currency is stored as absent, never defaulted to USD", async () => {
    await deliver({
      type: "payment.succeeded",
      data: { payment_id: "pay_nocur", total_amount: 5000, metadata: { userId: "u1", credits: "10000" } },
    })
    expect(payment("pay_nocur")?.currency).toBeUndefined()
  })
})
