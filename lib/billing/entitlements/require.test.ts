import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  authorize: vi.fn(),
  operations: vi.fn(),
  resolveScope: vi.fn(),
  deploying: vi.fn(),
  locks: null as unknown,
  holds: null as unknown,
}))

vi.mock("./service", () => ({
  authorize: h.authorize,
  authorizeOperations: h.operations,
  resolveScope: h.resolveScope,
  countDeployingProjectsForScope: h.deploying,
  scopeKey: ({ kind, userId }: { kind: string; userId: string }) => `${kind[0]}:${userId}`,
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

vi.mock("@/lib/db/collections", () => ({
  billingResourceLocksCol: async () => h.locks,
  billingResourceHoldsCol: async () => h.holds,
}))

import {
  authorizeCustomDomain,
  authorizeProductionWork,
  authorizeStorage,
  authorizeSubdomain,
  entitlementDenial,
  releaseCustomDomainSlot,
  releaseSubdomainSlot,
  reserveCustomDomainSlot,
  reserveSubdomainSlot,
} from "./require"
import { buildEntitlementSet } from "./catalog"

const allow = { allowed: true }
const deny = (code: string) => ({ allowed: false, code, reason: `${code} reason` })

beforeEach(() => {
  vi.clearAllMocks()
  h.operations.mockResolvedValue([allow])
  h.locks = new FakeCollection()
  h.holds = new FakeCollection()
  h.resolveScope.mockResolvedValue(
    buildEntitlementSet("growth", { businesses: 1, productionApps: 1, subdomains: 0, customDomainsConsumed: 0 }),
  )
  h.deploying.mockResolvedValue(0)
})

describe("authorizeProductionWork — compound operations", () => {
  it("checks build, database provisioning and specialist teams against one snapshot", async () => {
    h.operations.mockResolvedValueOnce([allow, allow, allow])
    await expect(authorizeProductionWork("u1", "buildProduction")).resolves.toBeNull()
    expect(h.operations).toHaveBeenCalledTimes(1)
    expect(h.operations).toHaveBeenCalledWith(
      "u1",
      [{ op: "buildProduction" }, { op: "provisionDatabase" }, { op: "useSpecialistTeam" }],
      { fresh: true },
    )
  })

  it("returns the first compound denial without deploying the build", async () => {
    h.operations.mockResolvedValueOnce([allow, deny("DATABASE_NOT_INCLUDED"), allow])
    await expect(authorizeProductionWork("u1", "buildProduction")).resolves.toMatchObject({
      code: "DATABASE_NOT_INCLUDED",
    })
  })

  it("skips the subdomain check when the project already owns a production URL", async () => {
    await expect(
      authorizeProductionWork("u1", "deploy", { hasExistingSubdomain: true }),
    ).resolves.toBeNull()
    expect(h.operations).toHaveBeenCalledTimes(1)
    expect(h.operations).toHaveBeenCalledWith("u1", [{ op: "deploy" }], { fresh: true })
  })

  it("refuses when the plan cannot be resolved instead of allowing the work", async () => {
    h.operations.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(authorizeProductionWork("u1", "buildProduction")).resolves.toMatchObject({
      allowed: false,
      code: "ENTITLEMENT_UNAVAILABLE",
    })
  })

  it("checks the subdomain cap for a project that has never deployed", async () => {
    h.operations
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([deny("SUBDOMAIN_LIMIT")])
    await expect(authorizeProductionWork("u1", "deploy")).resolves.toMatchObject({
      code: "SUBDOMAIN_LIMIT",
    })
    expect(h.operations).toHaveBeenLastCalledWith(
      "u1",
      [{ op: "connectSubdomain", ctx: undefined }],
      { fresh: true },
    )
  })
})

describe("atomic slot reservations", () => {
  it("lets only one of two concurrent requests consume the last custom-domain slot", async () => {
    const results = await Promise.all([
      reserveCustomDomainSlot("u1", "p1", "one.example.com"),
      reserveCustomDomainSlot("u1", "p2", "two.example.com"),
    ])

    expect(results.filter((result) => result.holdId)).toHaveLength(1)
    expect(results.find((result) => result.denial)?.denial?.code).toBe("CUSTOM_DOMAIN_LIMIT")
  })

  it("lets only one of two concurrent first deployments consume the last subdomain slot", async () => {
    const results = await Promise.all([
      reserveSubdomainSlot("u1", "p1"),
      reserveSubdomainSlot("u1", "p2"),
    ])

    expect(results.filter((result) => result.holdId)).toHaveLength(1)
    expect(results.find((result) => result.denial)?.denial?.code).toBe("SUBDOMAIN_LIMIT")
  })

  it("releases a slot after a failed provider operation so the next project can use it", async () => {
    const first = await reserveCustomDomainSlot("u1", "p1", "one.example.com")
    expect(first.holdId).toBeTruthy()

    await releaseCustomDomainSlot("u1", "p1")
    const second = await reserveCustomDomainSlot("u1", "p2", "two.example.com")

    expect(second.holdId).toBeTruthy()
    expect(second.denial).toBeUndefined()
  })

  it("keeps a retry idempotent for the same project and hostname", async () => {
    const first = await reserveCustomDomainSlot("u1", "p1", "one.example.com")
    const retry = await reserveCustomDomainSlot("u1", "p1", "one.example.com")

    expect(retry.holdId).toBe(first.holdId)
    expect(retry.existing).toBe(true)
  })

  it("refuses a different hostname while a custom-domain change is in flight", async () => {
    await reserveCustomDomainSlot("u1", "p1", "one.example.com")
    const conflict = await reserveCustomDomainSlot("u1", "p1", "two.example.com")

    expect(conflict.busy?.code).toBe("DOMAIN_CHANGE_IN_PROGRESS")
  })

  it("releases a subdomain hold without consuming the slot", async () => {
    const first = await reserveSubdomainSlot("u1", "p1")
    expect(first.holdId).toBeTruthy()
    await releaseSubdomainSlot("u1", "p1")
    const second = await reserveSubdomainSlot("u1", "p2")
    expect(second.holdId).toBeTruthy()
  })
})

describe("single-operation guards", () => {
  it("does not spend a second registration on an existing custom domain", async () => {
    await expect(authorizeCustomDomain("u1", true)).resolves.toBeNull()
    expect(h.operations).not.toHaveBeenCalled()
  })

  it("checks a new custom domain against the purchased cap", async () => {
    h.operations.mockResolvedValueOnce([deny("CUSTOM_DOMAIN_LIMIT")])
    await expect(authorizeCustomDomain("u1", false)).resolves.toMatchObject({
      code: "CUSTOM_DOMAIN_LIMIT",
    })
  })

  it("lets an existing subdomain be republished", async () => {
    await expect(authorizeSubdomain("u1", true)).resolves.toBeNull()
    expect(h.operations).not.toHaveBeenCalled()
  })

  it("checks storage as its own operation", async () => {
    await authorizeStorage("u1")
    expect(h.operations).toHaveBeenCalledWith(
      "u1",
      [{ op: "useStorage", ctx: undefined }],
      { fresh: true },
    )
  })

  it("turns a denial into the shared route shape", () => {
    expect(entitlementDenial(null)).toBeNull()
    expect(entitlementDenial(allow)).toBeNull()
    expect(entitlementDenial(deny("PLAN_LIMIT"))).toEqual({
      code: "PLAN_LIMIT",
      message: "PLAN_LIMIT reason",
    })
  })
})
