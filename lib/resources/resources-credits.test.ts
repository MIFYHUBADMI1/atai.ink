import { beforeEach, describe, expect, it, vi } from "vitest"

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

import {
  chargeActionPlan,
  chargeMarketResearch,
  chargeCompetitors,
  chargeMarketingPlaybook,
  refundResources,
} from "./resources-credits"
import { RESOURCES_CREDIT_COSTS } from "./credit-costs"

/**
 * Phase 2 — Resources AI charges/refunds must carry the server-validated
 * projectId as a FIRST-CLASS ledger field so project accounting attributes
 * them without falling back to legacy reference guessing.
 */

describe("resources credits — first-class project attribution", () => {
  beforeEach(() => {
    consumeMock.mockReset()
    grantMock.mockReset()
    availableMock.mockReset()
    availableMock.mockResolvedValue(100_000)
    consumeMock.mockResolvedValue({ success: true })
  })

  const chargers: Array<[string, (u: string, p: string) => Promise<boolean>, keyof typeof RESOURCES_CREDIT_COSTS]> = [
    ["chargeActionPlan", chargeActionPlan, "actionPlan"],
    ["chargeMarketResearch", chargeMarketResearch, "marketResearch"],
    ["chargeCompetitors", chargeCompetitors, "competitors"],
    ["chargeMarketingPlaybook", chargeMarketingPlaybook, "marketingPlaybook"],
  ]

  for (const [name, fn, op] of chargers) {
    it(`${name} stamps projectId + legacy reference pair`, async () => {
      await expect(fn("u1", "p1")).resolves.toBe(true)
      const arg = consumeMock.mock.calls[0][0] as Record<string, unknown>
      expect(arg.projectId).toBe("p1")
      expect(arg.referenceType).toBe("project")
      expect(arg.referenceId).toBe("p1")
      expect(arg.amount).toBe(RESOURCES_CREDIT_COSTS[op])
    })
  }

  it("refundResources mirrors the charge with first-class projectId", async () => {
    await refundResources("u1", "p1", "actionPlan")
    const arg = grantMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.projectId).toBe("p1")
    expect(arg.referenceId).toBe("p1")
    expect(arg.transactionType).toBe("other_reversal")
    expect(arg.creditType).toBe("permanent")
  })

  it("refund never throws when the ledger rejects the reversal", async () => {
    grantMock.mockRejectedValue(new Error("ledger down"))
    await expect(refundResources("u1", "p1", "competitors")).resolves.toBeUndefined()
  })
})
