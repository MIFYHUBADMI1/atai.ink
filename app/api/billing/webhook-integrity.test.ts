import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const {
  mockVerifySignature,
  mockEventCol,
  mockPaymentCol,
  mockSubscriptionCol,
  mockLedgerCol,
  mockGrantCredits,
  mockReverseCredits,
  mockActivate,
} = vi.hoisted(() => {
  const eventCol = {
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
  }
  const paymentCol = {
    findOne: vi.fn(),
    insertOne: vi.fn(),
  }
  const subscriptionCol = {
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
  }
  const ledgerCol = { findOne: vi.fn() }
  return {
    mockVerifySignature: vi.fn(),
    mockEventCol: eventCol,
    mockPaymentCol: paymentCol,
    mockSubscriptionCol: subscriptionCol,
    mockLedgerCol: ledgerCol,
    mockGrantCredits: vi.fn(),
    mockReverseCredits: vi.fn(),
    mockActivate: vi.fn(),
  }
})

vi.mock("@/lib/billing/dodo-webhook", () => ({
  verifyWebhookSignature: mockVerifySignature,
}))

vi.mock("@/lib/db/collections", () => ({
  webhookEventsCol: vi.fn().mockResolvedValue(mockEventCol),
  paymentRecordsCol: vi.fn().mockResolvedValue(mockPaymentCol),
  subscriptionRecordsCol: vi.fn().mockResolvedValue(mockSubscriptionCol),
  creditLedgerCol: vi.fn().mockResolvedValue(mockLedgerCol),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  grantCredits: mockGrantCredits,
  grantSubscriptionCredits: vi.fn().mockResolvedValue(true),
  expireSubscriptionCredits: vi.fn().mockResolvedValue(undefined),
  reverseCredits: mockReverseCredits,
}))

vi.mock("@/lib/billing/activate-subscription", () => ({
  activatePaidSubscription: mockActivate,
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "./webhook/route"

// Phase 1 — payment-event persistence integrity for the Dodo webhook.

function webhookRequest(payload: unknown, webhookId = "wh_1") {
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

function lastEventStatus(): { status?: string; error?: string } {
  const calls = mockEventCol.updateOne.mock.calls
  const last = calls[calls.length - 1] as [unknown, { $set: Record<string, unknown> }] | undefined
  return last ? { status: last[1].$set.status as string, error: last[1].$set.error as string } : {}
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifySignature.mockReturnValue({ valid: true })
  mockEventCol.findOne.mockResolvedValue(null)
  mockEventCol.insertOne.mockResolvedValue({ acknowledged: true })
  mockEventCol.updateOne.mockResolvedValue({ acknowledged: true })
  mockPaymentCol.findOne.mockResolvedValue(null)
  mockPaymentCol.insertOne.mockResolvedValue({ acknowledged: true })
  mockSubscriptionCol.updateOne.mockResolvedValue({ acknowledged: true })
  mockLedgerCol.findOne.mockResolvedValue(null)
  mockGrantCredits.mockResolvedValue({ success: true, ledgerEntry: { id: "le1" } })
  mockReverseCredits.mockResolvedValue({ success: true, ledgerEntry: { id: "le2" } })
  mockActivate.mockResolvedValue({ ok: true, planId: "pro" })
})

describe("signature verification and idempotency are preserved", () => {
  it("rejects invalid signatures with 401 and persists nothing", async () => {
    mockVerifySignature.mockReturnValue({ valid: false, error: "bad sig" })
    const res = await POST(webhookRequest({ type: "payment.succeeded", data: {} }))
    expect(res.status).toBe(401)
    expect(mockEventCol.insertOne).not.toHaveBeenCalled()
  })

  it("ignores a duplicate webhook-id without reprocessing", async () => {
    mockEventCol.findOne.mockResolvedValue({ webhookId: "wh_1" })
    const res = await POST(webhookRequest({ type: "payment.succeeded", data: { payment_id: "pay_1" } }, "wh_1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.duplicate).toBe(true)
    expect(mockGrantCredits).not.toHaveBeenCalled()
    expect(mockEventCol.insertOne).not.toHaveBeenCalled()
  })

  it("processes a legitimate credit-pack payment and records it", async () => {
    const res = await POST(webhookRequest({
      type: "payment.succeeded",
      data: {
        payment_id: "pay_100",
        total_amount: 2000,
        currency: "USD",
        metadata: { userId: "u1", credits: 5000, packageId: "pack_5k" },
      },
    }))
    expect(res.status).toBe(200)
    expect(mockGrantCredits).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", amount: 5000, idempotencyKey: "payment_pay_100" }),
    )
    expect(mockPaymentCol.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ dodoPaymentId: "pay_100", amount: 2000, currency: "USD", status: "succeeded" }),
    )
    expect(lastEventStatus().status).toBe("processed")
  })
})

describe("unmatched verified events stay discoverable (§7.1)", () => {
  it("marks an unattributable payment.succeeded as unresolved and grants nothing", async () => {
    await POST(webhookRequest({
      type: "payment.succeeded",
      data: { payment_id: "pay_200", total_amount: 5000, currency: "USD", metadata: {} },
    }))
    expect(mockGrantCredits).not.toHaveBeenCalled()
    expect(mockPaymentCol.insertOne).not.toHaveBeenCalled()
    const evt = lastEventStatus()
    expect(evt.status).toBe("unresolved")
    expect(evt.error).toMatch(/could not be attributed/i)
  })

  it("marks an unattributable subscription.active as unresolved", async () => {
    mockActivate.mockResolvedValue({ ok: false, reason: "missing_user" })
    await POST(webhookRequest({
      type: "subscription.active",
      data: { subscription_id: "sub_9", product_id: "prod_x" },
    }))
    expect(lastEventStatus().status).toBe("unresolved")
  })
})

describe("unknown amounts are never fabricated (§7.2)", () => {
  it("records payment.failed without amount/currency when the provider omitted them", async () => {
    await POST(webhookRequest({
      type: "payment.failed",
      data: { payment_id: "pay_300" },
    }))
    expect(mockPaymentCol.insertOne).toHaveBeenCalled()
    const record = mockPaymentCol.insertOne.mock.calls[0][0] as Record<string, unknown>
    expect(record.amount).toBeUndefined()
    expect(record.currency).toBeUndefined()
    expect(record.status).toBe("failed")
  })

  it("preserves provider amounts when present on payment.failed", async () => {
    await POST(webhookRequest({
      type: "payment.failed",
      data: { payment_id: "pay_301", total_amount: 1500, currency: "EUR" },
    }))
    const record = mockPaymentCol.insertOne.mock.calls[0][0] as Record<string, unknown>
    expect(record.amount).toBe(1500)
    expect(record.currency).toBe("EUR")
  })
})

describe("persistence failures are observable (§7.3)", () => {
  it("marks the event failed when the payment-record write fails", async () => {
    mockPaymentCol.insertOne.mockRejectedValue(new Error("write concern failure"))
    const res = await POST(webhookRequest({
      type: "payment.succeeded",
      data: {
        payment_id: "pay_400",
        total_amount: 1000,
        currency: "USD",
        metadata: { userId: "u1", credits: 2500 },
      },
    }))
    // The event is retained and marked failed — never reported as processed.
    expect(res.status).toBe(200) // still acknowledged as received
    expect(lastEventStatus().status).toBe("failed")
    expect(lastEventStatus().error).toMatch(/write concern failure/)
  })

  it("marks the event failed when the credit grant itself fails", async () => {
    mockGrantCredits.mockResolvedValue({ success: false, ledgerEntry: {} })
    await POST(webhookRequest({
      type: "payment.succeeded",
      data: {
        payment_id: "pay_401",
        total_amount: 1000,
        currency: "USD",
        metadata: { userId: "u1", credits: 2500 },
      },
    }))
    expect(lastEventStatus().status).toBe("failed")
  })

  it("keeps refund handling fail-loud on reversal failure", async () => {
    mockPaymentCol.findOne.mockImplementation(async (query: { dodoPaymentId?: string }) =>
      query.dodoPaymentId === "pay_5"
        ? { userId: "u1", dodoPaymentId: "pay_5", creditsGranted: 1000, creditType: "permanent" }
        : null,
    )
    mockReverseCredits.mockResolvedValue({ success: false, ledgerEntry: {} })
    await POST(webhookRequest({
      type: "refund.succeeded",
      data: { refund_id: "rf_1", payment_id: "pay_5", amount: 1000, currency: "USD" },
    }))
    expect(lastEventStatus().status).toBe("failed")
  })
})
