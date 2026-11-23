import { beforeEach, describe, expect, it, vi } from "vitest"

class FakeCollection<T extends { _id: string; expiresAt?: number; holder?: string }> {
  docs = new Map<string, T>()

  async findOneAndUpdate(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
    const id = filter._id as string
    const existing = this.docs.get(id)
    const now = Date.now()
    const expired = Boolean(existing && typeof existing.expiresAt === "number" && existing.expiresAt < now)
    const holder = (filter.$or as Array<Record<string, unknown>> | undefined)
      ?.find((clause) => typeof clause.holder === "string")?.holder
    const sameHolder = Boolean(existing && holder && existing.holder === holder)
    if (existing && !expired && !sameHolder) {
      const error = new Error("duplicate key") as Error & { code: number }
      error.code = 11000
      throw error
    }
    const doc = { ...(existing ?? {}), ...update.$set, _id: id } as T
    this.docs.set(id, doc)
    return doc
  }

  async insertOne(doc: T) {
    if (this.docs.has(doc._id)) {
      const error = new Error("duplicate key") as Error & { code: number }
      error.code = 11000
      throw error
    }
    this.docs.set(doc._id, { ...doc })
    return { insertedId: doc._id }
  }

  async findOne(filter: Record<string, unknown>) {
    return this.docs.get(filter._id as string) ?? null
  }

  async deleteOne(filter: Record<string, unknown>) {
    const id = filter._id as string
    const existing = this.docs.get(id)
    if (!existing) return { deletedCount: 0 }
    if (typeof filter.holder === "string" && existing.holder !== filter.holder) return { deletedCount: 0 }
    const expiry = filter.expiresAt as { $lt?: number } | undefined
    if (expiry?.$lt !== undefined && !(typeof existing.expiresAt === "number" && existing.expiresAt < expiry.$lt)) {
      return { deletedCount: 0 }
    }
    this.docs.delete(id)
    return { deletedCount: 1 }
  }

  async countDocuments(filter: Record<string, unknown>) {
    return [...this.docs.values()].filter((doc) => this.matches(doc, filter)).length
  }

  find(filter: Record<string, unknown>) {
    const rows = [...this.docs.values()].filter((doc) => this.matches(doc, filter))
    return { toArray: async () => rows }
  }

  private matches(doc: T, filter: Record<string, unknown>): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      if (key === "expiresAt") {
        const expiry = expected as { $gt?: number; $lt?: number }
        if (expiry.$gt !== undefined && !(typeof doc.expiresAt === "number" && doc.expiresAt > expiry.$gt)) return false
        if (expiry.$lt !== undefined && !(typeof doc.expiresAt === "number" && doc.expiresAt < expiry.$lt)) return false
        continue
      }
      if ((doc as Record<string, unknown>)[key] !== expected) return false
    }
    return true
  }
}

const h = vi.hoisted(() => ({
  locks: null as unknown,
  holds: null as unknown,
}))

vi.mock("@/lib/db/collections", () => ({
  billingResourceLocksCol: async () => h.locks,
  billingResourceHoldsCol: async () => h.holds,
}))

import {
  createResourceHold,
  countActiveSlotHolds,
  releaseResourceHold,
  sumActiveStorageHolds,
  withResourceLock,
} from "./reservations"

beforeEach(() => {
  h.locks = new FakeCollection()
  h.holds = new FakeCollection()
})

describe("database-backed resource locks", () => {
  it("serializes two concurrent critical sections", async () => {
    let active = 0
    let maxActive = 0
    const run = () =>
      withResourceLock("u1:customDomain", async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
      }, { waitMs: 500, retryMs: 1 })

    await Promise.all([run(), run()])
    expect(maxActive).toBe(1)
  })
})

describe("resource holds", () => {
  it("is idempotent for the same slot and counts it once", async () => {
    const first = await createResourceHold({
      scopeKey: "u1",
      kind: "customDomain",
      resourceId: "p1",
      userId: "u1",
      ttlMs: 60_000,
    })
    const second = await createResourceHold({
      scopeKey: "u1",
      kind: "customDomain",
      resourceId: "p1",
      userId: "u1",
      ttlMs: 60_000,
    })

    expect(first.existing).toBe(false)
    expect(second.existing).toBe(true)
    expect(await countActiveSlotHolds("u1", "customDomain")).toBe(1)
  })

  it("replaces an expired hold instead of counting it forever", async () => {
    await createResourceHold({
      scopeKey: "u1",
      kind: "subdomain",
      resourceId: "p1",
      userId: "u1",
      ttlMs: -1,
    })
    expect(await countActiveSlotHolds("u1", "subdomain")).toBe(0)

    const fresh = await createResourceHold({
      scopeKey: "u1",
      kind: "subdomain",
      resourceId: "p1",
      userId: "u1",
      ttlMs: 60_000,
    })
    expect(fresh.existing).toBe(false)
    expect(await countActiveSlotHolds("u1", "subdomain")).toBe(1)
  })

  it("releases a slot hold", async () => {
    const hold = await createResourceHold({
      scopeKey: "u1",
      kind: "customDomain",
      resourceId: "p1",
      userId: "u1",
      ttlMs: 60_000,
    })
    await releaseResourceHold(hold.holdId)
    expect(await countActiveSlotHolds("u1", "customDomain")).toBe(0)
  })

  it("sums only active storage holds", async () => {
    await createResourceHold({
      scopeKey: "u1",
      kind: "storage",
      resourceId: "p1",
      userId: "u1",
      bytes: 40,
      operationId: "a",
      ttlMs: 60_000,
    })
    await createResourceHold({
      scopeKey: "u1",
      kind: "storage",
      resourceId: "p1",
      userId: "u1",
      bytes: 60,
      operationId: "b",
      ttlMs: -1,
    })
    expect(await sumActiveStorageHolds("p1")).toBe(40)
  })
})
