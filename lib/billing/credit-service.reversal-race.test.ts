import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for the reverseCredits race (audit finding):
 *
 *  The bucket balance used to be read OUTSIDE the transaction and the debit
 *  guarded only on the flat `credits` field. A concurrent consume could
 *  drain the specific bucket between the read and the debit, driving the
 *  bucket negative while the flat guard still passed.
 *
 *  Now the balance is re-read inside every transaction attempt, clamped,
 *  and the debit is guarded on the bucket field itself.
 */

vi.mock("server-only", () => ({}))

const { userFindOne, userUpdateOne, ledgerFindOne, ledgerInsertOne, withTransaction } = vi.hoisted(
  () => ({
    userFindOne: vi.fn(),
    userUpdateOne: vi.fn(),
    ledgerFindOne: vi.fn(),
    ledgerInsertOne: vi.fn(),
    withTransaction: vi.fn(),
  }),
)

vi.mock("@/lib/db/collections", () => ({
  usersCol: vi.fn(async () => ({ findOne: userFindOne, updateOne: userUpdateOne })),
  creditLedgerCol: vi.fn(async () => ({ findOne: ledgerFindOne, insertOne: ledgerInsertOne })),
}))

vi.mock("@/lib/db/mongodb", () => ({
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({ withTransaction, endSession: vi.fn(async () => {}) }),
  })),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { reverseCredits } from "./credit-service"

const params = {
  userId: "u1",
  creditType: "permanent" as const,
  amount: 100,
  transactionType: "refund_reversal" as const,
  idempotencyKey: "rev_1",
}

describe("reverseCredits", () => {
  beforeEach(() => {
    userFindOne.mockReset()
    userUpdateOne.mockReset()
    ledgerFindOne.mockReset()
    ledgerInsertOne.mockReset()
    withTransaction.mockReset()

    ledgerFindOne.mockResolvedValue(null)
    ledgerInsertOne.mockResolvedValue({ acknowledged: true })
    userUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    withTransaction.mockImplementation(async (fn: () => Promise<void>) => {
      await fn()
    })
  })

  it("guards the debit on the bucket field, not only the flat total", async () => {
    userFindOne.mockResolvedValue({
      id: "u1", credits: 200, subscriptionCredits: 100, permanentCredits: 100,
    })

    await reverseCredits(params)

    const filter = (userUpdateOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(filter.credits).toEqual({ $gte: 100 })
    expect(filter.permanentCredits).toEqual({ $gte: 100 })
  })

  it("clamps to the balance re-read inside the transaction, not a stale pre-txn read", async () => {
    // First txn attempt sees the bucket drained by a concurrent consume.
    userFindOne
      .mockResolvedValueOnce({
        id: "u1", credits: 150, subscriptionCredits: 100, permanentCredits: 50,
      })

    await reverseCredits({ ...params, creditType: "permanent", amount: 100 })

    const [, updateOps] = (userUpdateOne.mock.calls[0] as unknown[]) as [unknown, { $inc: Record<string, number> }]
    expect(updateOps.$inc.permanentCredits).toBe(-50)
    expect(updateOps.$inc.credits).toBe(-50)

    const entry = (ledgerInsertOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(entry.amount).toBe(50)
    expect(entry.balanceBefore).toBe(50)
    expect(entry.balanceAfter).toBe(0)
  })

  it("does not debit or write the ledger when the bucket is empty at txn time", async () => {
    userFindOne.mockResolvedValue({
      id: "u1", credits: 100, subscriptionCredits: 100, permanentCredits: 0,
    })

    const result = await reverseCredits(params)

    expect(result.success).toBe(false)
    expect(userUpdateOne).not.toHaveBeenCalled()
    expect(ledgerInsertOne).not.toHaveBeenCalled()
  })
})
