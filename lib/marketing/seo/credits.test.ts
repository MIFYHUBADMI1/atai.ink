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

// Price is admin data: the default is 100 credits per audit.
const { costMock } = vi.hoisted(() => ({ costMock: vi.fn(async () => ({ auditCost: 100 })) }))
vi.mock("@/lib/billing/runtime-config", () => ({ getSeoAuditCosts: costMock }))

import {
  chargeSeoAuditCredits,
  getSeoAuditAffordability,
  getSeoAuditCost,
  refundSeoAuditCredits,
} from "./credits"

/**
 * A refund must never throw (it would mask the audit error), but it must REPORT
 * what happened so the failed audit row can say whether credits came back.
 */

describe("refundSeoAuditCredits", () => {
  beforeEach(() => {
    grantMock.mockReset()
    consumeMock.mockReset()
    availableMock.mockReset()
  })

  it("skips the ledger and reports not_charged when nothing was charged", async () => {
    await expect(refundSeoAuditCredits("u1", "p1", 0)).resolves.toBe("not_charged")
    expect(grantMock).not.toHaveBeenCalled()
  })

  it("refunds the exact amount that was charged", async () => {
    grantMock.mockResolvedValue({ success: true })

    await expect(refundSeoAuditCredits("u1", "p1", 15)).resolves.toBe("refunded")

    expect(grantMock).toHaveBeenCalledTimes(1)
    const arg = grantMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.amount).toBe(15)
    expect(arg.userId).toBe("u1")
    expect(arg.referenceId).toBe("p1")
    // Phase 2: first-class project attribution mirrors the charge.
    expect(arg.projectId).toBe("p1")
  })

  it("reports failed instead of throwing when the ledger rejects the reversal", async () => {
    grantMock.mockRejectedValue(new Error("ledger down"))

    await expect(refundSeoAuditCredits("u1", "p1", 15)).resolves.toBe("failed")
  })
})

/**
 * Phase 2 — every feature writer must stamp the server-validated projectId as
 * a FIRST-CLASS ledger field (not only the legacy referenceType/referenceId
 * pair), so project accounting can attribute without guessing.
 */
describe("chargeSeoAuditCredits attribution", () => {
  it("writes first-class projectId alongside the legacy reference pair", async () => {
    availableMock.mockResolvedValue(100)
    consumeMock.mockResolvedValue({ success: true })

    await expect(chargeSeoAuditCredits("u1", "p1")).resolves.toBe(true)

    const arg = consumeMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.projectId).toBe("p1")
    expect(arg.referenceType).toBe("project")
    expect(arg.referenceId).toBe("p1")
    expect(arg.transactionType).toBe("ai_collaboration")
  })
})

describe("the audit price is admin data", () => {
  beforeEach(() => {
    costMock.mockResolvedValue({ auditCost: 100 })
    grantMock.mockReset()
    consumeMock.mockReset()
    availableMock.mockReset()
  })

  it("charges the configured 100 credits by default", async () => {
    await expect(getSeoAuditCost()).resolves.toBe(100)
  })

  it("follows an admin repricing", async () => {
    costMock.mockResolvedValue({ auditCost: 250 })

    await expect(getSeoAuditCost()).resolves.toBe(250)
  })

  it("debits exactly the configured amount", async () => {
    availableMock.mockResolvedValue(500)
    consumeMock.mockResolvedValue({ success: true })

    await expect(chargeSeoAuditCredits("u1", "p1", "intent-1")).resolves.toBe(true)

    const arg = consumeMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.amount).toBe(100)
    expect(arg.idempotencyKey).toBe("seo_intent-1")
  })

  it("refuses when the balance is below the configured price", async () => {
    availableMock.mockResolvedValue(99)

    await expect(chargeSeoAuditCredits("u1", "p1")).resolves.toBe(false)
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it("quotes the configured price to the founder", async () => {
    availableMock.mockResolvedValue(100)

    await expect(getSeoAuditAffordability("u1")).resolves.toEqual({ cost: 100, available: 100, affordable: true })
  })

  it("treats a zero price as free without touching the ledger", async () => {
    costMock.mockResolvedValue({ auditCost: 0 })

    await expect(chargeSeoAuditCredits("u1", "p1")).resolves.toBe(true)
    expect(consumeMock).not.toHaveBeenCalled()
  })
})
