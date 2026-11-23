import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  usage: vi.fn(),
  resolveScope: vi.fn(),
  locks: null as unknown,
  holds: null as unknown,
}))

vi.mock("@/lib/billing/entitlements/service", () => ({
  scopeKey: ({ userId }: { userId: string }) => `u:${userId}`,
  resolveScope: h.resolveScope,
}))
vi.mock("./service", () => ({ getProjectStorageUsage: h.usage }))
vi.mock("@/lib/db/collections", () => ({
  billingResourceLocksCol: async () => h.locks,
  billingResourceHoldsCol: async () => h.holds,
}))

import { releaseProjectStorage, reserveProjectStorage } from "./storage-reservations"
import { createResourceHold, sumActiveStorageHolds } from "@/lib/billing/entitlements/reservations"
import { buildEntitlementSet } from "@/lib/billing/entitlements/catalog"

let used = 0
let limit: number | null = 100

beforeEach(() => {
  used = 0
  limit = 100
  h.locks = new FakeCollection()
  h.holds = new FakeCollection()
  h.usage.mockImplementation(async () => ({ usedBytes: used, limitBytes: limit, withinLimit: limit === null || used <= limit }))
  h.resolveScope.mockResolvedValue(
    buildEntitlementSet("growth", { businesses: 1, productionApps: 1, subdomains: 0, customDomainsConsumed: 0 }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("atomic storage reservations", () => {
  it("lets only one of two concurrent uploads consume the remaining quota", async () => {
    const results = await Promise.all([
      reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 60, operationId: "a" }),
      reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 60, operationId: "b" }),
    ])

    expect(results.filter((result) => result.holdId)).toHaveLength(1)
    expect(results.find((result) => result.denial)?.denial.code).toBe("STORAGE_LIMIT_REACHED")
  })

  it("releases capacity after a failed write so the next upload can use it", async () => {
    const first = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 60, operationId: "a" })
    expect(first.holdId).toBeTruthy()

    await releaseProjectStorage(first.holdId)
    const second = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 60, operationId: "b" })

    expect(second.holdId).toBeTruthy()
    expect(second.denial).toBeUndefined()
  })

  it("ignores expired holds when calculating remaining capacity", async () => {
    await createResourceHold({
      scopeKey: "u:u1",
      kind: "storage",
      resourceId: "p1",
      userId: "u1",
      bytes: 90,
      operationId: "stale",
      ttlMs: -1,
    })
    expect(await sumActiveStorageHolds("p1")).toBe(0)

    const result = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 60, operationId: "fresh" })
    expect(result.holdId).toBeTruthy()
  })

  it("does not create a hold when the project has no storage limit", async () => {
    limit = null
    const result = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 60, operationId: "a" })
    expect(result.holdId).toBeUndefined()
    expect(await sumActiveStorageHolds("p1")).toBe(0)
  })

  it("keeps the infrastructure byte quota when enforcement is OFF", async () => {
    vi.stubEnv("ENTITLEMENT_ENFORCEMENT_ENABLED", "false")
    limit = 100
    used = 90
    h.resolveScope.mockClear()

    const result = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 20, operationId: "a" })

    expect(result.denial?.code).toBe("STORAGE_LIMIT_REACHED")
    expect(h.resolveScope).not.toHaveBeenCalled()
    expect(await sumActiveStorageHolds("p1")).toBe(0)
  })

  it("re-checks the storage capability inside the lock", async () => {
    h.resolveScope.mockResolvedValueOnce(
      buildEntitlementSet("explorer", { businesses: 1, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 }),
    )

    const result = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 60, operationId: "a" })

    expect(result.denial?.code).toBe("EXPLORER_PLANNING_ONLY")
    expect(await sumActiveStorageHolds("p1")).toBe(0)
  })
})
