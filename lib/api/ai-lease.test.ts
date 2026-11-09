import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ rows: new Map<string, any>(), fail: false }))
vi.mock("@/lib/db/mongodb", () => ({ getDb: async () => ({ collection: () => ({
  createIndex: vi.fn(async () => "expiry"),
  findOneAndUpdate: async (filter: any, update: any) => {
    if (state.fail) throw new Error("storage unavailable")
    const current = state.rows.get(filter._id)
    if (current && current.expiresAt > filter.expiresAt.$lte) throw Object.assign(new Error("duplicate"), { code: 11000 })
    const next = { _id: filter._id, ...update.$set }
    state.rows.set(filter._id, next)
    return next
  },
  deleteOne: async (filter: any) => {
    if (state.rows.get(filter._id)?.owner === filter.owner) state.rows.delete(filter._id)
  },
}) }) }))
import { acquireAiLease, AI_LEASE_MS } from "./ai-lease"

beforeEach(() => { state.rows.clear(); state.fail = false })
afterEach(() => { vi.useRealTimers() })

describe("distributed lease algorithm (shared in-memory Mongo model, not infrastructure proof)", () => {
  it("admits exactly two simultaneous operations for one user", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => acquireAiLease("a", "chat")))
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2)
    expect(state.rows.size).toBe(2)
    for (const result of results) if (result.status === "fulfilled") await result.value()
    expect(state.rows.size).toBe(0)
  })
  it("shares limits across module instances and operation types, but not users", async () => {
    await acquireAiLease("a", "chat")
    vi.resetModules()
    const other = await import("./ai-lease")
    await other.acquireAiLease("a", "visual")
    await expect(acquireAiLease("a", "analysis")).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 5 })
    await expect(other.acquireAiLease("b", "chat")).resolves.toBeTypeOf("function")
  })
  it("recovers crashed leases without allowing an old owner to release its replacement", async () => {
    vi.useFakeTimers()
    const old = await acquireAiLease("a", "chat")
    await acquireAiLease("a", "chat")
    vi.setSystemTime(Date.now() + AI_LEASE_MS + 1)
    const replacement = await acquireAiLease("a", "visual")
    const owner = state.rows.get("a:0").owner
    await old()
    await old()
    expect(state.rows.get("a:0").owner).toBe(owner)
    await replacement()
    expect(state.rows.has("a:0")).toBe(false)
  })
  it("fails closed on storage failure", async () => {
    state.fail = true
    await expect(acquireAiLease("a", "chat")).rejects.toThrow("storage unavailable")
    expect(state.rows.size).toBe(0)
  })
})
