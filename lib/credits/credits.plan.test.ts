import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  addTransaction: vi.fn(),
  grantCredits: vi.fn(),
  getAvailableCredits: vi.fn(),
}))

vi.mock("@/lib/store/store", () => ({
  cryptoId: vi.fn(() => "abc"),
  store: { addTransaction: mocks.addTransaction, getBalance: vi.fn() },
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/billing/runtime-config", () => ({
  getBuildTierCosts: vi.fn(async () => ({ simple: 1, medium: 2, complex: 3 })),
  getExistingBusinessCosts: vi.fn(async () => ({ readCost: 40, assessmentCost: 60 })),
  getMirrorPipelineCosts: vi.fn(async () => ({
    scrapeCost: 5,
    heavyScrapeCost: 100,
    planCost: 5,
    heavyPlanCost: 100,
    deepCrawlCost: 500,
    heavyDeepCrawlCost: 1000,
  })),
  DEFAULT_MIRROR_PIPELINE_COSTS: {
    scrapeCost: 5,
    heavyScrapeCost: 100,
    planCost: 5,
    heavyPlanCost: 100,
    deepCrawlCost: 500,
    heavyDeepCrawlCost: 1000,
  },
}))
vi.mock("@/lib/billing/credit-service", () => ({
  getAvailableCredits: mocks.getAvailableCredits,
  grantCredits: mocks.grantCredits,
}))

import { chargeDeepCrawlCredits, chargePlanCredits, chargeScrapeCredits, refundPlanCredits } from "./credits"

describe("research credit charges", () => {
  beforeEach(() => {
    mocks.addTransaction.mockReset()
    mocks.addTransaction.mockResolvedValue(undefined)
    mocks.grantCredits.mockReset()
    mocks.grantCredits.mockResolvedValue({ success: true })
  })

  it("records a scrape as website_scrape, not a build", async () => {
    await chargeScrapeCredits("u1", "p1")

    expect(mocks.addTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -5, ledgerTransactionType: "website_scrape" }),
    )
  })

  it("records a deep crawl as deep_crawl, not a build", async () => {
    await chargeDeepCrawlCredits("u1", "p1")

    expect(mocks.addTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -500, ledgerTransactionType: "deep_crawl" }),
    )
  })

  it("charges the plan before generation and returns a refundable handle", async () => {
    const charge = await chargePlanCredits("u1", "p1")

    expect(charge).toEqual({ amount: 5, idempotencyKey: "plan_p1_abc" })
    expect(mocks.addTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "plan_p1_abc",
        amount: -5,
        ledgerTransactionType: "plan_generation",
        metadata: { projectId: "p1" },
      }),
    )
  })

  it("prices heavy mode from heavyPlanCost", async () => {
    const charge = await chargePlanCredits("u1", "p1", "heavy")

    expect(charge?.amount).toBe(100)
    expect(mocks.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: -100 }))
  })

  it("skips the ledger entirely when the plan is configured free", async () => {
    const { getMirrorPipelineCosts } = await import("@/lib/billing/runtime-config")
    vi.mocked(getMirrorPipelineCosts).mockResolvedValueOnce({
      scrapeCost: 5,
      heavyScrapeCost: 100,
      planCost: 0,
      heavyPlanCost: 100,
      deepCrawlCost: 500,
      heavyDeepCrawlCost: 1000,
    })

    const charge = await chargePlanCredits("u1", "p1")

    expect(charge).toBeNull()
    expect(mocks.addTransaction).not.toHaveBeenCalled()
  })

  it("refunds a plan charge to permanent credits with a derived key", async () => {
    await refundPlanCredits("u1", "p1", { amount: 5, idempotencyKey: "plan_p1_abc" })

    expect(mocks.grantCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        creditType: "permanent",
        amount: 5,
        transactionType: "other_reversal",
        idempotencyKey: "plan_p1_abc_refund",
        projectId: "p1",
      }),
    )
  })

  it("does nothing when there is no charge to refund", async () => {
    await refundPlanCredits("u1", "p1", null)
    await refundPlanCredits("u1", "p1", { amount: 0, idempotencyKey: "plan_p1_abc" })

    expect(mocks.grantCredits).not.toHaveBeenCalled()
  })

  it("never throws when the refund itself fails", async () => {
    mocks.grantCredits.mockRejectedValueOnce(new Error("ledger down"))

    await expect(
      refundPlanCredits("u1", "p1", { amount: 5, idempotencyKey: "plan_p1_abc" }),
    ).resolves.toBeUndefined()
  })
})
