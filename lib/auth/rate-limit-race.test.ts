/**
 * Fixed-window rate limiter — concurrency races.
 *
 * The bucket is created with an upsert on a unique `key` index. Two requests
 * that both miss the in-window increment can race on that insert; the loser
 * used to receive a raw Mongo E11000 error, which the route layer turned
 * into an HTTP 500 — a spurious server fault on a legitimate request.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFindOneAndUpdate, mockUpdateOne } = vi.hoisted(() => ({
  mockFindOneAndUpdate: vi.fn(),
  mockUpdateOne: vi.fn(),
}))

vi.mock("@/lib/db/collections", () => ({
  rateLimitsCol: vi.fn(async () => ({
    findOneAndUpdate: mockFindOneAndUpdate,
    updateOne: mockUpdateOne,
  })),
  ensureIndexes: vi.fn(async () => undefined),
}))

import { checkRateLimit, resetMemoryRateLimitForTests } from "./rate-limit"
import { AppError } from "@/lib/errors"

describe("checkRateLimit — upsert race", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMemoryRateLimitForTests()
  })

  it("folds a duplicate-key race into the window the winner created instead of throwing E11000", async () => {
    // 1st call: no in-window doc → upsert path → duplicate key (someone else won)
    mockFindOneAndUpdate.mockResolvedValueOnce(null)
    mockUpdateOne.mockRejectedValueOnce(
      new Error("E11000 duplicate key error collection: atai.rate_limits index: key_1 dup key"),
    )
    // 2nd call: the winner's window is now visible → fold this request in
    mockFindOneAndUpdate.mockResolvedValueOnce({ count: 2 })

    await expect(
      checkRateLimit({ action: "login", identifier: "race@example.com", limit: 5, windowMs: 60_000 }),
    ).resolves.toBeUndefined()
  })

  it("still rejects with the limit error when the folded window is already over the limit", async () => {
    mockFindOneAndUpdate.mockResolvedValueOnce(null)
    mockUpdateOne.mockRejectedValueOnce(
      new Error("E11000 duplicate key error collection: atai.rate_limits index: key_1 dup key"),
    )
    mockFindOneAndUpdate.mockResolvedValueOnce({ count: 99, windowStart: Date.now() })

    await expect(
      checkRateLimit({ action: "login", identifier: "race2@example.com", limit: 5, windowMs: 60_000 }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it("rethrows a non-duplicate-key failure from the upsert", async () => {
    mockFindOneAndUpdate.mockResolvedValueOnce(null)
    mockUpdateOne.mockRejectedValueOnce(new Error("not authorized on atai"))

    await expect(
      checkRateLimit({ action: "login", identifier: "db-down@example.com", limit: 5, windowMs: 60_000 }),
    ).rejects.toThrow(/not authorized/)
  })
})
