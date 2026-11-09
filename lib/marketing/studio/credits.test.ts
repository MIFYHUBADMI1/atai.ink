import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { grantMock, consumeMock, availableMock } = vi.hoisted(() => ({
  grantMock: vi.fn(),
  consumeMock: vi.fn(),
  availableMock: vi.fn(),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  consumeCredits: consumeMock,
  grantCredits: grantMock,
  getAvailableCredits: availableMock,
}))

vi.mock("@/lib/store/store", () => ({ cryptoId: () => "cid" }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { chargeStudioCredits, refundStudioCredits, getStudioCost } from "./credits"

/**
 * Phase 2 — Studio credit accounting must (1) stamp first-class projectId on
 * BOTH sides of the ledger movement and (2) make the refund key deterministic
 * when the caller passes the same intentKey it charged with, so a retried
 * failure path cannot double-refund (the charge.ts discipline).
 */

describe("chargeStudioCredits", () => {
  beforeEach(() => {
    consumeMock.mockReset()
    grantMock.mockReset()
    availableMock.mockReset()
    availableMock.mockResolvedValue(1000)
    consumeMock.mockResolvedValue({ success: true })
    delete process.env.STUDIO_CREDIT_COST
  })

  it("writes first-class projectId alongside the legacy reference pair", async () => {
    await expect(chargeStudioCredits("u1", "p1")).resolves.toBe(true)

    const arg = consumeMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.projectId).toBe("p1")
    expect(arg.referenceType).toBe("project")
    expect(arg.referenceId).toBe("p1")
    expect(arg.transactionType).toBe("ai_collaboration")
    expect(arg.amount).toBe(getStudioCost())
  })

  it("an intentKey makes the charge idempotent across retries", async () => {
    await chargeStudioCredits("u1", "p1", "action_42")
    await chargeStudioCredits("u1", "p1", "action_42")
    const keys = consumeMock.mock.calls.map((c) => (c[0] as Record<string, unknown>).idempotencyKey)
    expect(keys).toEqual(["studio_action_42", "studio_action_42"])
  })

  it("without an intentKey the key is random (a fresh generation always charges)", async () => {
    await chargeStudioCredits("u1", "p1")
    const arg = consumeMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.idempotencyKey).toBe("cid")
  })
})

describe("refundStudioCredits", () => {
  beforeEach(() => {
    consumeMock.mockReset()
    grantMock.mockReset()
    delete process.env.STUDIO_CREDIT_COST
  })

  it("mirrors the charge: first-class projectId + other_reversal", async () => {
    await refundStudioCredits("u1", "p1", "action_42")
    const arg = grantMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.projectId).toBe("p1")
    expect(arg.referenceId).toBe("p1")
    expect(arg.transactionType).toBe("other_reversal")
    expect(arg.creditType).toBe("permanent")
  })

  it("the refund key is deterministic for the same intentKey (retried failure cannot double-refund)", async () => {
    await refundStudioCredits("u1", "p1", "action_42")
    await refundStudioCredits("u1", "p1", "action_42")
    const keys = grantMock.mock.calls.map((c) => (c[0] as Record<string, unknown>).idempotencyKey)
    expect(keys).toEqual(["studio_action_42_refund", "studio_action_42_refund"])
  })

  it("without an intentKey the refund key is namespaced-random (never bare cryptoId)", async () => {
    await refundStudioCredits("u1", "p1")
    const arg = grantMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.idempotencyKey).toBe("studio_refund_cid")
  })

  it("never throws when the ledger rejects the reversal", async () => {
    grantMock.mockRejectedValue(new Error("ledger down"))
    await expect(refundStudioCredits("u1", "p1", "x")).resolves.toBeUndefined()
  })
})
