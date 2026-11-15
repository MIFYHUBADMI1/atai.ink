import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for subscription credit expiry.
 *
 * The reported bug: subscription credits bought months ago never expired.
 * Root cause — buckets carried expiresAt but NOTHING removed them (no sweep,
 * no lazy expiry, only webhook-driven paths), and the consumption planner
 * still spent expired buckets. These tests pin the fix:
 *
 *  1. expireOverdueBuckets removes overdue buckets, debits the flat fields and
 *     writes a per-bucket idempotent ledger entry.
 *  2. Legacy bucket-less accounts expire their flat subscription credits only
 *     after the grace window past subscriptionPeriodEnd.
 *  3. getBalance sweeps before reading (session-less).
 *  4. consumeCredits sweeps inside the transaction BEFORE planning — expired
 *     credits can never fund a consumption.
 *  5. expireSubscriptionCredits removes ALL buckets of one subscription
 *     (annual owns up to 12 under the same subscription id) without touching
 *     other subscriptions' buckets.
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

import {
  consumeCredits,
  expireOverdueBuckets,
  expireSubscriptionCredits,
  getBalance,
} from "./credit-service"

const now = 1_700_000_000_000
const DAY = 86_400_000

/**
 * The expiry sweep compares bucket deadlines against the real clock, while the
 * fixtures below are anchored to a fixed instant. The clock is pinned to that
 * instant for the whole file — without it the suite quietly rots: once wall
 * time passes the fixture dates, every "future" bucket becomes overdue and the
 * sweep fires a second time.
 *
 * Only `Date` is faked so real timers keep working.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.useRealTimers()
})

function resetMocks() {
  userFindOne.mockReset()
  userUpdateOne.mockReset()
  ledgerFindOne.mockReset()
  ledgerInsertOne.mockReset()
  withTransaction.mockReset()
  withTransaction.mockImplementation(async (fn: () => Promise<void>) => {
    await fn()
  })
  ledgerFindOne.mockResolvedValue(null)
  ledgerInsertOne.mockResolvedValue({ acknowledged: true })
  userUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
}

describe("expireOverdueBuckets", () => {
  beforeEach(resetMocks)

  it("removes overdue buckets, debits flat fields, and leaves live buckets untouched", async () => {
    const doc = {
      id: "u1",
      credits: 100_000,
      subscriptionCredits: 60_000,
      permanentCredits: 40_000,
      creditBuckets: [
        { subscriptionId: "subA", bucketId: "b_exp", planId: "starter", amount: 30_000, originalAmount: 30_000, expiresAt: now - 1_000, createdAt: now - 5 * DAY },
        { subscriptionId: "subA", bucketId: "b_live", planId: "starter", amount: 30_000, originalAmount: 30_000, expiresAt: now + DAY, createdAt: now },
      ],
    }
    userFindOne.mockResolvedValueOnce(doc) // probe
    userFindOne.mockResolvedValueOnce(doc) // in-transaction fresh read

    const result = await expireOverdueBuckets({ userId: "u1", now })

    expect(result).toEqual({ expiredCredits: 30_000, expiredBuckets: 1 })
    expect(userUpdateOne).toHaveBeenCalledTimes(1)
    const [, ops] = userUpdateOne.mock.calls[0]
    expect(ops.$inc).toEqual({ subscriptionCredits: -30_000, credits: -30_000 })
    expect(ops.$pull).toEqual({ creditBuckets: { expiresAt: { $lte: now } } })
    expect(ledgerInsertOne).toHaveBeenCalledTimes(1)
    const entry = ledgerInsertOne.mock.calls[0][0]
    expect(entry.amount).toBe(30_000)
    expect(entry.idempotencyKey).toBe("sub_expire_bucket_b_exp")
    expect(entry.transactionType).toBe("subscription_expiration")
    expect(entry.referenceId).toBe("subA")
  })

  it("expires legacy flat subscription credits only past the grace window", async () => {
    const stale = {
      id: "u2",
      credits: 50_000,
      subscriptionCredits: 50_000,
      permanentCredits: 0,
      subscriptionPeriodEnd: now - 10 * DAY,
    }
    userFindOne.mockResolvedValueOnce(stale) // probe
    userFindOne.mockResolvedValueOnce(stale) // fresh read

    const result = await expireOverdueBuckets({ userId: "u2", now })

    expect(result).toEqual({ expiredCredits: 50_000, expiredBuckets: 0 })
    const [, ops] = userUpdateOne.mock.calls[0]
    expect(ops.$inc).toEqual({ subscriptionCredits: -50_000, credits: -50_000 })
    const entry = ledgerInsertOne.mock.calls[0][0]
    expect(entry.idempotencyKey).toBe(`sub_expire_flat_u2_${Math.floor((now - 10 * DAY) / DAY)}`)
    expect(entry.referenceType).toBe("account")
  })

  it("does not expire legacy flat credits inside the grace window", async () => {
    const recent = {
      id: "u3",
      credits: 50_000,
      subscriptionCredits: 50_000,
      permanentCredits: 0,
      subscriptionPeriodEnd: now - DAY,
    }
    userFindOne.mockResolvedValue(recent) // probe + fresh read

    const result = await expireOverdueBuckets({ userId: "u3", now })

    expect(result).toEqual({ expiredCredits: 0, expiredBuckets: 0 })
    expect(userUpdateOne).not.toHaveBeenCalled()
    expect(ledgerInsertOne).not.toHaveBeenCalled()
  })

  it("is idempotent — a recorded bucket key debits nothing on re-run", async () => {
    const doc = {
      id: "u1",
      credits: 100_000,
      subscriptionCredits: 60_000,
      permanentCredits: 40_000,
      creditBuckets: [
        { subscriptionId: "subA", bucketId: "b_exp", planId: "starter", amount: 30_000, originalAmount: 30_000, expiresAt: now - 1_000, createdAt: now - 5 * DAY },
      ],
    }
    userFindOne.mockResolvedValueOnce(doc)
    userFindOne.mockResolvedValueOnce(doc)
    ledgerFindOne.mockResolvedValue({ idempotencyKey: "sub_expire_bucket_b_exp" })

    const result = await expireOverdueBuckets({ userId: "u1", now })

    expect(result).toEqual({ expiredCredits: 0, expiredBuckets: 0 })
    expect(userUpdateOne).not.toHaveBeenCalled()
    expect(ledgerInsertOne).not.toHaveBeenCalled()
  })

  it("no-ops with a single cheap probe when nothing is overdue", async () => {
    userFindOne.mockResolvedValueOnce(null) // probe finds no overdue credits
    userFindOne.mockResolvedValue({ id: "u9", credits: 500, subscriptionCredits: 0, permanentCredits: 500 })

    const result = await expireOverdueBuckets({ userId: "u9", now })

    expect(result).toEqual({ expiredCredits: 0, expiredBuckets: 0 })
    expect(userUpdateOne).not.toHaveBeenCalled()
  })
})

describe("getBalance lazy sweep", () => {
  beforeEach(resetMocks)

  it("session-less reads run the overdue probe before reading the balance", async () => {
    userFindOne.mockResolvedValueOnce(null) // probe: nothing overdue
    userFindOne.mockResolvedValueOnce({ id: "u1", credits: 100, subscriptionCredits: 100, permanentCredits: 0 })

    const balance = await getBalance("u1")
    expect(balance).toEqual({ total: 100, subscription: 100, permanent: 0 })
    expect(userUpdateOne).not.toHaveBeenCalled()
  })
})

describe("consumeCredits expiry guard", () => {
  beforeEach(resetMocks)

  it("cannot fund consumption with expired bucket credits", async () => {
    const preSweep = {
      id: "u1",
      credits: 70_000,
      subscriptionCredits: 50_000,
      permanentCredits: 20_000,
      creditBuckets: [
        { subscriptionId: "subA", bucketId: "b_exp", planId: "explorer", amount: 50_000, originalAmount: 50_000, expiresAt: now - 1_000, createdAt: now - 5 * DAY },
      ],
    }
    const postSweep = {
      id: "u1",
      credits: 20_000,
      subscriptionCredits: 0,
      permanentCredits: 20_000,
      creditBuckets: [],
    }
    userFindOne.mockResolvedValueOnce(preSweep) // sweep fresh read
    userFindOne.mockResolvedValueOnce(postSweep) // consume fresh read

    const result = await consumeCredits({
      userId: "u1",
      amount: 30_000,
      transactionType: "build_finalization",
      idempotencyKey: "consume_test_1",
    })

    // The expired 50k cannot fund it; only 20k permanent is actually spendable.
    expect(result.success).toBe(false)
    const [, sweepOps] = userUpdateOne.mock.calls[0]
    expect(sweepOps.$pull).toEqual({ creditBuckets: { expiresAt: { $lte: now } } })
    expect(ledgerInsertOne).toHaveBeenCalledTimes(1)
    expect(ledgerInsertOne.mock.calls[0][0].transactionType).toBe("subscription_expiration")
  })
})

describe("expireSubscriptionCredits (webhook path)", () => {
  beforeEach(resetMocks)

  it("removes ALL buckets of the subscription without touching other subscriptions", async () => {
    const doc = {
      id: "u4",
      credits: 750_000,
      subscriptionCredits: 750_000,
      permanentCredits: 0,
      creditBuckets: [
        { subscriptionId: "subX", bucketId: "b1", planId: "growth", amount: 400_000, originalAmount: 400_000, expiresAt: now + DAY, createdAt: now },
        { subscriptionId: "subX", bucketId: "b2", planId: "growth", amount: 300_000, originalAmount: 300_000, expiresAt: now + 32 * DAY, createdAt: now },
        { subscriptionId: "subY", bucketId: "b3", planId: "starter", amount: 50_000, originalAmount: 50_000, expiresAt: now + DAY, createdAt: now },
      ],
    }
    userFindOne.mockResolvedValue(doc)
    ledgerFindOne.mockResolvedValue(null)

    const renewalAt = now + DAY
    const ok = await expireSubscriptionCredits({
      userId: "u4",
      subscriptionId: "subX",
      periodStart: renewalAt,
    })

    expect(ok).toBe(true)
    expect(userUpdateOne).toHaveBeenCalledTimes(1)
    const [, ops] = userUpdateOne.mock.calls[0]
    expect(ops.$inc).toEqual({ subscriptionCredits: -700_000, credits: -700_000 })
    expect(ops.$pull).toEqual({ creditBuckets: { subscriptionId: "subX" } })
    const entry = ledgerInsertOne.mock.calls[0][0]
    expect(entry.amount).toBe(700_000)
    expect(entry.idempotencyKey).toBe(`sub_expire_subX_${Math.floor(renewalAt / DAY)}`)
    expect(entry.metadata.expiredBuckets).toBe(2)
  })
})
