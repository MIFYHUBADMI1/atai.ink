import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const database = vi.hoisted(() => {
  const rows = new Map<string, { count: number; windowStart: number; expiresAt: Date }>()
  return {
    rows,
    findOneAndUpdate: vi.fn(async (filter, update) => {
      const row = rows.get(filter.key)
      if (!row || row.windowStart <= filter.windowStart.$gt) return null
      row.count += update.$inc.count
      return { ...row }
    }),
    updateOne: vi.fn(async (filter, update) => {
      const row = rows.get(filter.key)
      if (row && row.windowStart > filter.windowStart.$lte) throw new Error("E11000 duplicate key")
      rows.set(filter.key, { ...update.$set })
      return { matchedCount: row ? 1 : 0 }
    }),
  }
})
vi.mock("@/lib/db/collections", () => ({
  ensureIndexes: async () => undefined,
  rateLimitsCol: async () => database,
}))
import { checkRateLimit, resetMemoryRateLimitForTests } from "./rate-limit"
import { handleRouteError } from "@/lib/api/respond"

const params = { action: "test", identifier: "caller", limit: 3, windowMs: 60_000 }
beforeEach(() => {
  vi.clearAllMocks()
  database.rows.clear()
  resetMemoryRateLimitForTests()
})
afterEach(() => vi.restoreAllMocks())

describe("shared fixed-window enforcement", () => {
  it("admits exactly the limit when 30 requests race on an absent bucket", async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => checkRateLimit(params)))
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3)
    const rejected = results.filter((r) => r.status === "rejected")
    expect(rejected).toHaveLength(27)
    for (const result of rejected) expect(result.reason).toMatchObject({ code: "RATE_LIMITED" })
    expect(database.rows.size).toBe(1)
  })
  it("enforces the shared count even when every caller has an empty process-local cache", async () => {
    for (let index = 0; index < 3; index++) {
      resetMemoryRateLimitForTests()
      await checkRateLimit(params)
    }
    resetMemoryRateLimitForTests()
    await expect(checkRateLimit(params)).rejects.toMatchObject({ code: "RATE_LIMITED" })
  })
  it("expires the local rejection at Mongo's boundary, not a new full window", async () => {
    const start = Date.now() - 59_000
    database.rows.set("test:caller", { count: 3, windowStart: start, expiresAt: new Date(start + 60_000) })
    const clock = vi.spyOn(Date, "now").mockReturnValue(start + 59_000)
    const error = await checkRateLimit(params).catch((error: unknown) => error)
    expect(error).toMatchObject({ code: "RATE_LIMITED" })
    const response = handleRouteError("test", error)
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("1")
    clock.mockReturnValue(start + 60_000)
    await expect(checkRateLimit(params)).resolves.toBeUndefined()
    expect(database.rows.get("test:caller")?.count).toBe(1)
  })
  it("fails closed when the post-conflict bucket cannot be found", async () => {
    database.findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    database.updateOne.mockRejectedValueOnce(new Error("E11000 duplicate key"))
    await expect(checkRateLimit(params)).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" })
  })
  it("does not convert a storage failure into a successful attempt", async () => {
    database.findOneAndUpdate.mockRejectedValueOnce(new Error("storage down"))
    await expect(checkRateLimit(params)).rejects.toThrow("storage down")
  })
})
