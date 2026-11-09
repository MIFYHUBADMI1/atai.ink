import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for `grantCredits`:
 *
 *  1. It must refuse to grant credits to a user id that does not exist.
 *     Previously the balance update silently matched nothing while the
 *     ledger entry was still written — creating a ledger entry for a
 *     non-existent account, and letting an admin credit grant report
 *     success for an id that was never registered.
 *
 *  2. The ledger's balanceBefore / balanceAfter must describe the state the
 *     grant actually applied to, i.e. be read INSIDE the transaction.
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
    startSession: () => ({
      withTransaction,
      endSession: vi.fn(async () => {}),
    }),
  })),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { grantCredits } from "./credit-service"
import type { ClientSession } from "mongodb"

describe("grantCredits", () => {
  beforeEach(() => {
    userFindOne.mockReset()
    userUpdateOne.mockReset()
    ledgerFindOne.mockReset()
    ledgerInsertOne.mockReset()
    withTransaction.mockReset()

    // Default: a real, existing, funded user.
    userFindOne.mockResolvedValue({
      id: "u1",
      credits: 100,
      subscriptionCredits: 100,
      permanentCredits: 0,
    })
    userUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    ledgerFindOne.mockResolvedValue(null)
    ledgerInsertOne.mockResolvedValue({ acknowledged: true })
    withTransaction.mockImplementation(async (fn: () => Promise<void>) => {
      await fn()
    })
  })

  it("refuses to grant credits to a user that does not exist", async () => {
    userUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })

    await expect(
      grantCredits({
        userId: "ghost",
        creditType: "permanent",
        amount: 500,
        transactionType: "admin_adjustment",
        idempotencyKey: "admin_1_ghost_500_x",
      }),
    ).rejects.toThrow(/does not exist/i)

    // No ledger entry may exist for a grant that never happened.
    expect(ledgerInsertOne).not.toHaveBeenCalled()
  })

  it("writes a ledger entry for an existing user", async () => {
    const result = await grantCredits({
      userId: "u1",
      creditType: "permanent",
      amount: 500,
      transactionType: "signup_bonus",
      idempotencyKey: "welcome_u1",
    })

    expect(result.success).toBe(true)
    expect(ledgerInsertOne).toHaveBeenCalledTimes(1)

    const entry = ledgerInsertOne.mock.calls[0][0] as Record<string, unknown>
    expect(entry.balanceBefore).toBe(100)
    expect(entry.balanceAfter).toBe(600)
    expect(entry.direction).toBe("credit")
  })

  it("reads the balance once, inside the transaction, so the snapshot matches the grant", async () => {
    await grantCredits({
      userId: "u1",
      creditType: "permanent",
      amount: 500,
      transactionType: "signup_bonus",
      idempotencyKey: "welcome_u1_b",
    })

    // Exactly one balance read — and it participates in the transaction.
    // Before the fix the balance was read once outside the transaction and
    // once inside, so two concurrent grants could record the same "before".
    expect(userFindOne).toHaveBeenCalledTimes(1)
    const sessionArg = userFindOne.mock.calls[0][1] as { session?: unknown }
    expect(sessionArg.session).toBeTruthy()

    const entry = ledgerInsertOne.mock.calls[0][0] as Record<string, unknown>
    expect(entry.balanceBefore).toBe(100)
    expect(entry.balanceAfter).toBe(600)
  })

  it("joins the caller's active transaction for both balance and ledger without closing it", async () => {
    const session = { inTransaction: () => true, endSession: vi.fn(), withTransaction: vi.fn() }
    await grantCredits({ userId: "u1", creditType: "permanent", amount: 500, transactionType: "referral_bonus", idempotencyKey: "referral_verification_r", session: session as unknown as ClientSession })
    expect(userUpdateOne).toHaveBeenCalledWith({ id: "u1" }, expect.objectContaining({ $inc: { permanentCredits: 500, credits: 500 } }), { session })
    expect(ledgerInsertOne).toHaveBeenCalledWith(expect.objectContaining({ amount: 500, balanceBefore: 100, balanceAfter: 600 }), { session })
    expect(withTransaction).not.toHaveBeenCalled()
    expect(session.withTransaction).not.toHaveBeenCalled()
    expect(session.endSession).not.toHaveBeenCalled()
  })

  it("rejects a caller session without an active transaction before any writes", async () => {
    const session = { inTransaction: () => false }
    await expect(grantCredits({ userId: "u1", creditType: "permanent", amount: 500, transactionType: "referral_bonus", idempotencyKey: "referral_verification_r", session: session as unknown as ClientSession })).rejects.toThrow("active transaction")
    expect(userUpdateOne).not.toHaveBeenCalled()
    expect(ledgerInsertOne).not.toHaveBeenCalled()
  })

  it("is idempotent — a replay returns the existing entry and grants nothing", async () => {
    ledgerFindOne.mockResolvedValue({
      id: "ledger_existing",
      idempotencyKey: "welcome_u1_c",
      amount: 500,
      direction: "credit",
    })

    const result = await grantCredits({
      userId: "u1",
      creditType: "permanent",
      amount: 500,
      transactionType: "signup_bonus",
      idempotencyKey: "welcome_u1_c",
    })

    expect(result.success).toBe(true)
    expect(result.ledgerEntry.id).toBe("ledger_existing")
    expect(userUpdateOne).not.toHaveBeenCalled()
    expect(ledgerInsertOne).not.toHaveBeenCalled()
  })
})
