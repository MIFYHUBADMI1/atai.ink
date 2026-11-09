import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for the credit-enforcement defects found in the
 * application audit:
 *
 *  1. `MongoStore.reserveCreditsAtomic` always returned `true`, so the
 *     "insufficient credits" guards in the build pipeline
 *     (lib/analysis/pipeline.ts) and the planning orchestrator
 *     (lib/planning/orchestrator.ts) could never fire.
 *
 *  2. `MongoStore.addTransaction` swallowed a debit the ledger denied, so a
 *     scrape / plan / deep-crawl charge against an underfunded account
 *     produced no ledger entry and no error — the provider work was
 *     delivered for free.
 *
 * The DataStore contract (lib/store/store.ts) explicitly requires
 * `reserveCreditsAtomic` to return false — without writing anything — when
 * the balance is insufficient.
 */

const { reserveCreditsMock, consumeCreditsMock, grantCreditsMock, availableMock, historyMock } =
  vi.hoisted(() => ({
    reserveCreditsMock: vi.fn(),
    consumeCreditsMock: vi.fn(),
    grantCreditsMock: vi.fn(),
    availableMock: vi.fn(),
    historyMock: vi.fn(),
  }))

vi.mock("@/lib/billing/credit-service", () => ({
  reserveCredits: reserveCreditsMock,
  consumeCredits: consumeCreditsMock,
  grantCredits: grantCreditsMock,
  getAvailableCredits: availableMock,
  getCreditHistory: historyMock,
}))

vi.mock("@/lib/db/collections", () => ({
  usersCol: vi.fn(async () => ({ findOne: vi.fn(), updateOne: vi.fn(), find: vi.fn(), insertOne: vi.fn() })),
  projectsCol: vi.fn(async () => ({})),
  buildRunsCol: vi.fn(async () => ({})),
  creditLedgerCol: vi.fn(async () => ({})),
}))

vi.mock("@/lib/db/runtime-collections", () => ({
  apiKeysCol: vi.fn(async () => ({})),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { MongoStore } from "./mongo-store"

describe("MongoStore credit enforcement", () => {
  beforeEach(() => {
    reserveCreditsMock.mockReset()
    consumeCreditsMock.mockReset()
    grantCreditsMock.mockReset()
    availableMock.mockReset()
    historyMock.mockReset()
  })

  describe("reserveCreditsAtomic", () => {
    it("returns false when the reservation is denied for insufficient credits", async () => {
      reserveCreditsMock.mockResolvedValue(false)
      const store = new MongoStore()

      const reserved = await store.reserveCreditsAtomic("u1", 50_000, {
        id: "tx1",
        userId: "u1",
        type: "reserve",
        amount: -50_000,
        reason: "Application build",
        buildRunId: "run1",
        createdAt: Date.now(),
      })

      expect(reserved).toBe(false)
    })

    it("returns true when the reservation succeeds", async () => {
      reserveCreditsMock.mockResolvedValue(true)
      const store = new MongoStore()

      const reserved = await store.reserveCreditsAtomic("u1", 50_000, {
        id: "tx2",
        userId: "u1",
        type: "reserve",
        amount: -50_000,
        reason: "Application build",
        buildRunId: "run2",
        createdAt: Date.now(),
      })

      expect(reserved).toBe(true)
    })

    it("propagates a real reservation failure instead of reporting success", async () => {
      reserveCreditsMock.mockRejectedValue(new Error("mongo down"))
      const store = new MongoStore()

      await expect(
        store.reserveCreditsAtomic("u1", 50_000, {
          id: "tx3",
          userId: "u1",
          type: "reserve",
          amount: -50_000,
          reason: "Application build",
          buildRunId: "run3",
          createdAt: Date.now(),
        }),
      ).rejects.toThrow("mongo down")
    })
  })

  describe("addTransaction", () => {
    it("throws INSUFFICIENT_CREDITS instead of silently dropping a denied debit", async () => {
      consumeCreditsMock.mockResolvedValue({
        success: false,
        subscriptionConsumed: 0,
        permanentConsumed: 0,
      })
      const store = new MongoStore()

      await expect(
        store.addTransaction({
          id: "tx4",
          userId: "u1",
          type: "consume",
          amount: -100,
          reason: "Website scrape (Heavy mode)",
          createdAt: Date.now(),
        }),
      ).rejects.toThrow(/Insufficient credits/i)
    })

    it("records the debit when the ledger accepts it", async () => {
      consumeCreditsMock.mockResolvedValue({
        success: true,
        subscriptionConsumed: 100,
        permanentConsumed: 0,
      })
      const store = new MongoStore()

      await store.addTransaction({
        id: "tx5",
        userId: "u1",
        type: "consume",
        amount: -100,
        reason: "Website scrape (Heavy mode)",
        createdAt: Date.now(),
      })

      expect(consumeCreditsMock).toHaveBeenCalledTimes(1)
      expect(consumeCreditsMock.mock.calls[0][0]).toMatchObject({
        userId: "u1",
        amount: 100,
        idempotencyKey: "tx5",
      })
    })

    it("routes a refund through the grant path", async () => {
      grantCreditsMock.mockResolvedValue({ success: true, ledgerEntry: {} })
      const store = new MongoStore()

      await store.addTransaction({
        id: "tx6",
        userId: "u1",
        type: "refund",
        amount: 100,
        reason: "Refund — operation failed",
        createdAt: Date.now(),
      })

      expect(grantCreditsMock).toHaveBeenCalledTimes(1)
      expect(consumeCreditsMock).not.toHaveBeenCalled()
    })
  })
})
