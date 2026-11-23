import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  scope: vi.fn(),
  set: vi.fn(),
  operations: vi.fn(),
  deploying: vi.fn(),
  usage: vi.fn(),
  locks: null as unknown,
  holds: null as unknown,
}))

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

vi.mock("server-only", () => ({}))
vi.mock("./service", () => ({
  resolveScope: h.scope,
  resolveEntitlements: h.set,
  authorize: vi.fn(),
  authorizeOperations: h.operations,
  countDeployingProjectsForScope: h.deploying,
  scopeKey: ({ userId }: { userId: string }) => `u:${userId}`,
}))
vi.mock("@/lib/infrastructure/service", () => ({ getProjectStorageUsage: h.usage }))
vi.mock("@/lib/db/collections", () => ({
  billingResourceLocksCol: async () => h.locks,
  billingResourceHoldsCol: async () => h.holds,
}))

import { buildEntitlementSet } from "./catalog"
import { buildProjectAccessView } from "./presentation"
import {
  authorizeProductionWork,
  reserveCustomDomainSlot,
  reserveSubdomainSlot,
} from "./require"
import { reserveProjectStorage } from "@/lib/infrastructure/storage-reservations"
import type { MirrorProject } from "@/lib/types/project"

const zero = { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 }
const allow = { allowed: true }

function project(overrides: Partial<MirrorProject> = {}): MirrorProject {
  return {
    id: "p1",
    userId: "u1",
    name: "Shop",
    idea: "A shop",
    mode: "scratch",
    state: "ready",
    createdAt: 1,
    updatedAt: 1,
    deployment: { id: "d1", status: "idle", updatedAt: 1 },
    deploymentHistory: [],
    ...overrides,
  } as MirrorProject
}

beforeEach(() => {
  vi.clearAllMocks()
  h.locks = new FakeCollection()
  h.holds = new FakeCollection()
  h.operations.mockResolvedValue([allow])
  h.deploying.mockResolvedValue(0)
  h.scope.mockResolvedValue(buildEntitlementSet("growth", zero))
  h.set.mockResolvedValue(buildEntitlementSet("growth", zero))
  h.usage.mockResolvedValue({ usedBytes: 10, limitBytes: 100, withinLimit: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("A6 acceptance matrix — flag OFF", () => {
  it("fails plan capabilities open, including the project access view", async () => {
    vi.stubEnv("ENTITLEMENT_ENFORCEMENT_ENABLED", "false")
    h.set.mockResolvedValue(buildEntitlementSet("explorer", zero))

    const view = await buildProjectAccessView("u1", project())

    expect(view.customDomain.allowed).toBe(true)
    expect(view.subdomain.allowed).toBe(true)
    expect(view.database.allowed).toBe(true)
    expect(view.specialistTeam.allowed).toBe(true)
    expect(view.competition.allowed).toBe(true)
    expect(view.agent.allowed).toBe(true)
    expect(view.storage.allowed).toBe(true)
    await expect(authorizeProductionWork("u1", "buildProduction")).resolves.toBeNull()
    await expect(reserveCustomDomainSlot("u1", "p1", "shop.example.com")).resolves.toEqual({})
    await expect(reserveSubdomainSlot("u1", "p1")).resolves.toEqual({})
  })

  it("still enforces the pre-existing 50MB storage quota", async () => {
    vi.stubEnv("ENTITLEMENT_ENFORCEMENT_ENABLED", "false")
    h.usage.mockResolvedValue({
      usedBytes: 50 * 1024 * 1024 - 1,
      limitBytes: 50 * 1024 * 1024,
      withinLimit: true,
    })

    const result = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 2 })

    expect(result.denial?.code).toBe("STORAGE_LIMIT_REACHED")
    expect(h.scope).not.toHaveBeenCalled()
  })
})

describe("A6 acceptance matrix — flag ON", () => {
  it("denies a Starter custom domain and an exhausted subdomain", async () => {
    h.scope.mockResolvedValue(buildEntitlementSet("starter", zero))
    const domain = await reserveCustomDomainSlot("u1", "p1", "shop.example.com")
    expect(domain.denial?.code).toBe("CUSTOM_DOMAIN_NOT_INCLUDED")

    h.scope.mockResolvedValue(buildEntitlementSet("starter", { ...zero, subdomains: 1 }))
    const subdomain = await reserveSubdomainSlot("u1", "p2")
    expect(subdomain.denial?.code).toBe("SUBDOMAIN_LIMIT")
  })

  it("denies storage over the project quota under the lock", async () => {
    h.usage.mockResolvedValue({ usedBytes: 101, limitBytes: 100, withinLimit: false })
    const result = await reserveProjectStorage({ userId: "u1", projectId: "p1", bytes: 10 })
    expect(result.denial?.code).toBe("STORAGE_LIMIT_REACHED")
  })

  it("allows only one of two concurrent first-deploy subdomain claims", async () => {
    h.scope.mockResolvedValue(buildEntitlementSet("starter", zero))

    const results = await Promise.all([
      reserveSubdomainSlot("u1", "p1"),
      reserveSubdomainSlot("u1", "p2"),
    ])

    expect(results.filter((result) => result.holdId)).toHaveLength(1)
    expect(results.find((result) => result.denial)?.denial.code).toBe("SUBDOMAIN_LIMIT")
  })

  it("shows the same denials in the access view", async () => {
    h.set.mockResolvedValue(buildEntitlementSet("starter", { ...zero, subdomains: 1 }))
    const view = await buildProjectAccessView("u1", project())
    expect(view.customDomain.allowed).toBe(false)
    expect(view.customDomain.code).toBe("CUSTOM_DOMAIN_NOT_INCLUDED")
    expect(view.subdomain.allowed).toBe(false)
    expect(view.subdomain.code).toBe("SUBDOMAIN_LIMIT")
  })
})
