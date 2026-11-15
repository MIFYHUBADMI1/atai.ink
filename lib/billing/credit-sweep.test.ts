import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The daily cron sweep expires overdue subscription credits for accounts that
 * never trigger a lazy read (no login since their period ended). It must:
 *  - sweep every overdue account,
 *  - report what it expired,
 *  - keep going (and report) when one account fails.
 */

vi.mock("server-only", () => ({}))

const { findToArray, findMock, expireOverdueBucketsMock } = vi.hoisted(() => ({
  findToArray: vi.fn(),
  findMock: vi.fn(),
  expireOverdueBucketsMock: vi.fn(),
}))

vi.mock("@/lib/db/collections", () => ({
  usersCol: vi.fn(async () => ({ find: findMock })),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  expireOverdueBuckets: expireOverdueBucketsMock,
  overdueCreditsFilter: vi.fn(() => ({ $or: [] })),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sweepExpiredSubscriptionCredits } from "./credit-sweep"

describe("sweepExpiredSubscriptionCredits", () => {
  beforeEach(() => {
    findToArray.mockReset()
    findMock.mockReset()
    expireOverdueBucketsMock.mockReset()
    findMock.mockImplementation(() => ({ toArray: findToArray }))
  })

  it("expires every overdue account and totals the result", async () => {
    findToArray.mockResolvedValue([{ id: "u1" }, { id: "u2" }])
    expireOverdueBucketsMock.mockResolvedValueOnce({ expiredCredits: 100, expiredBuckets: 1 })
    expireOverdueBucketsMock.mockResolvedValueOnce({ expiredCredits: 0, expiredBuckets: 0 })

    const report = await sweepExpiredSubscriptionCredits()

    expect(report.scanned).toBe(2)
    expect(report.usersExpired).toBe(1)
    expect(report.expiredCredits).toBe(100)
    expect(report.expiredBuckets).toBe(1)
    expect(report.errors).toEqual([])
    expect(expireOverdueBucketsMock).toHaveBeenCalledTimes(2)
  })

  it("records a failing account and keeps sweeping the rest", async () => {
    findToArray.mockResolvedValue([{ id: "u1" }, { id: "u2" }])
    expireOverdueBucketsMock.mockRejectedValueOnce(new Error("txn conflict"))
    expireOverdueBucketsMock.mockResolvedValueOnce({ expiredCredits: 42, expiredBuckets: 2 })

    const report = await sweepExpiredSubscriptionCredits()

    expect(report.usersExpired).toBe(1)
    expect(report.expiredCredits).toBe(42)
    expect(report.errors).toEqual([{ userId: "u1", error: "txn conflict" }])
  })

  it("is a no-op when no account holds overdue credits", async () => {
    findToArray.mockResolvedValue([])

    const report = await sweepExpiredSubscriptionCredits()

    expect(report).toEqual({
      scanned: 0,
      usersExpired: 0,
      expiredBuckets: 0,
      expiredCredits: 0,
      errors: [],
    })
    expect(expireOverdueBucketsMock).not.toHaveBeenCalled()
  })
})
