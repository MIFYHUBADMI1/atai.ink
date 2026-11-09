import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), createIndex: vi.fn(), claim: vi.fn(), remove: vi.fn() }))
vi.mock("@/lib/db/mongodb", () => ({ getDb: mocks.getDb }))
import { acquireAiLease, AI_CONCURRENT_OPERATIONS, AI_DEADLINE_MS, AI_LEASE_MS } from "./ai-lease"

interface Lease { _id: string; owner: string; operation: string; expiresAt: Date }
let rows: Map<string, Lease>
beforeEach(() => {
  rows = new Map()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"))
  vi.resetAllMocks()
  mocks.getDb.mockResolvedValue({ collection: () => ({ createIndex: mocks.createIndex, findOneAndUpdate: mocks.claim, deleteOne: mocks.remove }) })
  mocks.createIndex.mockResolvedValue("expiresAt_1")
  mocks.claim.mockImplementation(async (filter, update, options) => {
    expect(options).toEqual({ upsert: true, returnDocument: "after" })
    const previous = rows.get(filter._id)
    if (previous && previous.expiresAt > filter.expiresAt.$lte) throw Object.assign(new Error("duplicate slot"), { code: 11000 })
    const row = { _id: filter._id, ...update.$set }
    rows.set(row._id, row)
    return row
  })
  mocks.remove.mockImplementation(async (filter) => {
    const matches = rows.get(filter._id)?.owner === filter.owner
    if (matches) rows.delete(filter._id)
    return { deletedCount: matches ? 1 : 0 }
  })
})
afterEach(() => vi.useRealTimers())

describe("AI lease contract (atomic in-memory collection, not Mongo integration)", () => {
  it("admits only the configured slots under concurrent acquisition", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => acquireAiLease("user-a", "visual")))
    const accepted = attempts.filter((result) => result.status === "fulfilled")
    const rejected = attempts.filter((result) => result.status === "rejected")
    expect(accepted).toHaveLength(AI_CONCURRENT_OPERATIONS)
    expect(rows.size).toBe(AI_CONCURRENT_OPERATIONS)
    for (const result of rejected) expect(result.reason).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 5 })
    for (const result of accepted) await result.value()
    expect(rows.size).toBe(0)
  })

  it("shares per-user slots across operation types without blocking another account", async () => {
    await acquireAiLease("user-a", "chat")
    await acquireAiLease("user-a", "resources")
    await expect(acquireAiLease("user-a", "visual")).rejects.toMatchObject({ code: "RATE_LIMITED" })
    await expect(acquireAiLease("user-b", "visual")).resolves.toBeTypeOf("function")
  })

  it("reclaims expired slots without waiting for Mongo TTL cleanup", async () => {
    await acquireAiLease("user-a", "chat")
    await acquireAiLease("user-a", "chat")
    expect(AI_LEASE_MS).toBeGreaterThan(AI_DEADLINE_MS)
    vi.advanceTimersByTime(AI_LEASE_MS)
    await expect(acquireAiLease("user-a", "visual")).resolves.toBeTypeOf("function")
    expect(rows.get("user-a:0")?.operation).toBe("visual")
  })

  it("does not let delayed cleanup delete a newer owner's lease", async () => {
    const oldRelease = await acquireAiLease("user-a", "chat")
    vi.advanceTimersByTime(AI_LEASE_MS)
    const newRelease = await acquireAiLease("user-a", "visual")
    const newOwner = rows.get("user-a:0")?.owner
    await oldRelease()
    expect(rows.get("user-a:0")?.owner).toBe(newOwner)
    await newRelease()
    expect(rows.size).toBe(0)
  })

  it("makes completed cleanup idempotent", async () => {
    const release = await acquireAiLease("user-a", "chat")
    await release()
    await release()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })

  it("can retry a failed cleanup without changing the owner filter", async () => {
    const release = await acquireAiLease("user-a", "chat")
    mocks.remove.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(release()).rejects.toThrow("database unavailable")
    expect(rows.size).toBe(1)
    await release()
    expect(rows.size).toBe(0)
    expect(mocks.remove.mock.calls[0][0]).toEqual(mocks.remove.mock.calls[1][0])
  })

  it("does not interpret non-duplicate database failures as available capacity", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(acquireAiLease("user-a", "chat")).rejects.toThrow("database unavailable")
    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(rows.size).toBe(0)
  })
})
