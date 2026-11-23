import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") return (value as Doc)[key]
    return undefined
  }, doc)
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".")
  let target: Doc = doc
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== "object") target[part] = {}
    target = target[part] as Doc
  }
  target[parts[parts.length - 1]] = value
}

function unsetPath(doc: Doc, path: string): void {
  const parts = path.split(".")
  let target: Doc = doc
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== "object") return
    target = target[part] as Doc
  }
  delete target[parts[parts.length - 1]]
}

function matches(doc: Doc, filter: Doc = {}): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((f) => matches(doc, f))
    if (key === "$and") return (cond as Doc[]).every((f) => matches(doc, f))
    const value = getPath(doc, key)
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      return Object.entries(cond as Doc).every(([op, arg]) => {
        if (op === "$exists") return arg ? value !== undefined : value === undefined
        if (op === "$in") return (arg as unknown[]).includes(value)
        if (op === "$nin") return !(arg as unknown[]).includes(value)
        if (op === "$ne") return value !== arg
        if (op === "$lt") return typeof value === "number" && value < (arg as number)
        if (op === "$lte") return typeof value === "number" && value <= (arg as number)
        throw new Error(`unsupported operator ${op}`)
      })
    }
    return value === cond
  })
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [key, value] of Object.entries((update.$set ?? {}) as Doc)) setPath(doc, key, value)
  for (const key of Object.keys((update.$unset ?? {}) as Doc)) unsetPath(doc, key)
}

const h = vi.hoisted(() => {
  const state = {
    projects: [] as Doc[],
    consumed: new Set<string>(),
    consumeCalls: [] as Doc[],
    capCalls: [] as Array<{ totalumProjectId: string; cap: number }>,
    balance: 1_000_000,
    failCap: false,
    failConsume: false,
    seq: 0,
  }

  function cursor(initial: Doc[]) {
    let rows = initial
    const c = {
      sort(spec: Doc) {
        const [key, dir] = Object.entries(spec)[0] as [string, number]
        rows = rows.slice().sort((a, b) => {
          const av = getPath(a, key) ?? 0
          const bv = getPath(b, key) ?? 0
          return av === bv ? 0 : av < bv ? -dir : dir
        })
        return c
      },
      limit(n: number) {
        rows = rows.slice(0, n)
        return c
      },
      async toArray() {
        return rows.slice()
      },
    }
    return c
  }

  const collection = {
    async findOne(filter: Doc) {
      return state.projects.find((p) => matches(p, filter)) ?? null
    },
    find(filter: Doc = {}) {
      return cursor(state.projects.filter((p) => matches(p, filter)))
    },
    async updateOne(filter: Doc, update: Doc) {
      const doc = state.projects.find((p) => matches(p, filter))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      applyUpdate(doc, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }

  return { state, collection }
})

vi.mock("@/lib/db/collections", () => ({
  projectsCol: async () => h.collection,
  ensureIndexes: vi.fn(async () => undefined),
}))

vi.mock("@/lib/infrastructure/plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/infrastructure/plans")>()
  return {
    ...actual,
    getInfrastructurePlanWithRuntimePrice: async (id: string) => actual.getInfrastructurePlan(id),
  }
})

vi.mock("@/lib/integrations/totalum/service", () => ({
  setProjectCreditLimits: vi.fn(async (totalumProjectId: string, limits: { maxInfrastructureCreditsPerMonth?: number | null }) => {
    if (h.state.failCap) throw new Error("cap provider unavailable")
    h.state.capCalls.push({ totalumProjectId, cap: limits.maxInfrastructureCreditsPerMonth ?? 0 })
    return { creditLimits: { maxInfrastructureCreditsPerMonth: limits.maxInfrastructureCreditsPerMonth ?? null, maxDevelopmentCreditsPerMonth: null } }
  }),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  consumeCredits: vi.fn(async (input: { amount: number; idempotencyKey: string }) => {
    h.state.consumeCalls.push(input)
    if (h.state.failConsume) return { success: false }
    if (h.state.consumed.has(input.idempotencyKey)) return { success: true }
    if (h.state.balance < input.amount) return { success: false }
    h.state.balance -= input.amount
    h.state.consumed.add(input.idempotencyKey)
    return { success: true }
  }),
}))

vi.mock("@/lib/store/store", () => ({
  store: { getBalance: vi.fn(async () => h.state.balance) },
  cryptoId: vi.fn(() => `id_${++h.state.seq}`),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  activatePlan,
  cancelInfrastructurePlan,
  handleExpiration,
  runInfrastructureLifecycleSweep,
} from "./service"
import { evaluateInfrastructureAccess, infrastructureDenial } from "./access"
import type { InfrastructureSubscription } from "@/lib/types/project"

const NOW = Date.UTC(2026, 0, 15)
const DAY = 24 * 60 * 60 * 1000

function subscription(overrides: Partial<InfrastructureSubscription> = {}): InfrastructureSubscription {
  return {
    planId: "basic",
    planName: "Basic",
    storageLimitBytes: 100 * 1024 * 1024,
    totalumInfrastructureCreditLimit: 10,
    status: "active",
    startedAt: NOW - DAY,
    expiresAt: NOW + 20 * DAY,
    autoRenew: false,
    purchasedTerms: {
      planId: "basic",
      planName: "Basic",
      storageLimitBytes: 100 * 1024 * 1024,
      totalumInfrastructureCreditLimit: 10,
      priceCredits: 5_000,
      purchasedAt: NOW - DAY,
      durationMs: 30 * DAY,
    },
    totalumCreditsUsed: 0,
    storageUsedBytes: 0,
    overQuota: false,
    syncStatus: "synced",
    ...overrides,
  }
}

function project(id = "p1", infrastructure: InfrastructureSubscription | undefined = subscription()): Doc {
  return {
    id,
    userId: "u1",
    name: `Project ${id}`,
    totalumProjectId: `t_${id}`,
    state: "ready",
    infrastructure,
    updatedAt: NOW,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  h.state.projects = []
  h.state.consumed.clear()
  h.state.consumeCalls = []
  h.state.capCalls = []
  h.state.balance = 1_000_000
  h.state.failCap = false
  h.state.failConsume = false
  h.state.seq = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe("infrastructure lifecycle — purchase and renewal", () => {
  it("purchases a paid plan with stored terms, UTC expiry and the real Totalum cap", async () => {
    h.state.projects = [project("p1", subscription({ planId: "testing", planName: "Testing", expiresAt: NOW + DAY }))]

    const result = await activatePlan("p1", "u1", "basic", "purchase-1")

    expect(result.success).toBe(true)
    expect(h.state.consumeCalls).toHaveLength(1)
    expect(h.state.consumeCalls[0].amount).toBe(5_000)
    expect(h.state.capCalls).toEqual([{ totalumProjectId: "t_p1", cap: 10 }])
    const infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.planId).toBe("basic")
    expect(infra.expiresAt).toBe(NOW + 30 * DAY)
    expect(infra.purchasedTerms?.priceCredits).toBe(5_000)
    expect(infra.purchasedTerms?.durationMs).toBe(30 * DAY)
    expect(infra.lastPurchaseKey).toBe("infra_purchase-1")
  })

  it("completes a retry after the charge succeeded even when the current balance is low", async () => {
    h.state.projects = [project("p1", subscription({ planId: "testing", planName: "Testing", expiresAt: NOW + DAY }))]
    h.state.balance = 0
    h.state.consumed.add("infra_charged-before-crash")

    const result = await activatePlan("p1", "u1", "basic", "charged-before-crash")

    expect(result.success).toBe(true)
    const infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.planId).toBe("basic")
    expect(infra.lastPurchaseKey).toBe("infra_charged-before-crash")
  })

  it("does not duplicate a purchase retry or extend twice", async () => {
    h.state.projects = [project("p1", subscription({ planId: "testing", planName: "Testing", expiresAt: NOW + DAY }))]

    const first = await activatePlan("p1", "u1", "basic", "same-intent")
    const expiry = (h.state.projects[0].infrastructure as InfrastructureSubscription).expiresAt
    const second = await activatePlan("p1", "u1", "basic", "same-intent")

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(h.state.consumeCalls).toHaveLength(1)
    expect(h.state.capCalls).toHaveLength(1)
    expect((h.state.projects[0].infrastructure as InfrastructureSubscription).expiresAt).toBe(expiry)
  })

  it("never re-applies an old purchase key after a newer purchase or expiry", async () => {
    h.state.projects = [project("p1", subscription({ planId: "testing", planName: "Testing", expiresAt: NOW + DAY }))]

    await activatePlan("p1", "u1", "basic", "first-key")
    await activatePlan("p1", "u1", "pro", "second-key")
    expect(h.state.consumeCalls).toHaveLength(2)

    const replay = await activatePlan("p1", "u1", "basic", "first-key")
    expect(replay.success).toBe(true)
    expect(replay.message).toContain("already been applied")
    expect((h.state.projects[0].infrastructure as InfrastructureSubscription).planId).toBe("pro")
    expect(h.state.consumeCalls).toHaveLength(2)

    const expiration = await handleExpiration("p1", NOW + 31 * DAY)
    expect(expiration.outcome).toBe("expired")
    const afterExpiryReplay = await activatePlan("p1", "u1", "basic", "first-key")
    expect(afterExpiryReplay.success).toBe(true)
    expect((h.state.projects[0].infrastructure as InfrastructureSubscription).planId).toBe("testing")
    expect(h.state.consumeCalls).toHaveLength(2)
  })

  it("renews from the paid-through date, not from today", async () => {
    h.state.projects = [project()]
    const oldExpiry = (h.state.projects[0].infrastructure as InfrastructureSubscription).expiresAt

    const result = await activatePlan("p1", "u1", "basic", "renew-1", { renewal: true })

    expect(result.success).toBe(true)
    const infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.expiresAt).toBe(oldExpiry + 30 * DAY)
    expect(infra.startedAt).toBe(NOW - DAY)
    expect(infra.renewalCount).toBe(1)
    expect(infra.renewedAt).toBe(NOW)
    expect(h.state.capCalls).toHaveLength(1)
  })

  it("lets a renewal win over expiration when it commits first", async () => {
    h.state.projects = [project("p1", subscription({ expiresAt: NOW }))]

    const renewed = await activatePlan("p1", "u1", "basic", "renew-race", { renewal: true })
    const expiration = await handleExpiration("p1", NOW)

    expect(renewed.success).toBe(true)
    expect(expiration.outcome).toBe("not_due")
    expect(h.state.capCalls).toHaveLength(1)
    expect(h.state.capCalls[0].cap).toBe(10)
  })

  it("does not derive infrastructure access from the credit balance", async () => {
    // A refunded/reduced credit balance must not revoke a paid-through plan,
    // and a large balance must not restore an expired plan.
    h.state.balance = 0
    const active = subscription({ expiresAt: NOW + DAY })
    expect(evaluateInfrastructureAccess(active, NOW).allowed).toBe(true)

    h.state.balance = 10_000_000
    const expired = subscription({ expiresAt: NOW - DAY })
    expect(evaluateInfrastructureAccess(expired, NOW).allowed).toBe(false)
  })

  it("does not extend a plan when the renewal payment fails", async () => {
    h.state.projects = [project()]
    const before = h.state.projects[0].infrastructure as InfrastructureSubscription
    h.state.balance = 0

    const result = await activatePlan("p1", "u1", "basic", "renew-unpaid", { renewal: true })

    expect(result.success).toBe(false)
    const after = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(after.expiresAt).toBe(before.expiresAt)
    expect(after.renewalCount ?? 0).toBe(0)
  })
})

describe("infrastructure lifecycle — expiration", () => {
  it("does not expire before the paid-through timestamp", async () => {
    h.state.projects = [project("p1", subscription({ expiresAt: NOW + 1 }))]

    const result = await handleExpiration("p1", NOW)

    expect(result.outcome).toBe("not_due")
    expect(h.state.capCalls).toHaveLength(0)
    expect((h.state.projects[0].infrastructure as InfrastructureSubscription).planId).toBe("basic")
  })

  it("expires after the paid-through timestamp", async () => {
    h.state.projects = [project("p1", subscription({ expiresAt: NOW - DAY }))]

    const result = await handleExpiration("p1", NOW)

    expect(result.outcome).toBe("expired")
    expect((h.state.projects[0].infrastructure as InfrastructureSubscription).planId).toBe("testing")
  })

  it("expires at the paid-through timestamp and applies the Testing cap", async () => {
    h.state.projects = [project("p1", subscription({ expiresAt: NOW }))]

    const result = await handleExpiration("p1", NOW)

    expect(result.outcome).toBe("expired")
    expect(h.state.capCalls).toEqual([{ totalumProjectId: "t_p1", cap: 5 }])
    const infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.planId).toBe("testing")
    expect(infra.status).toBe("active")
    expect(infra.expiredAt).toBe(NOW)
    expect(infra.totalumInfrastructureCreditLimit).toBe(5)
  })

  it("is idempotent when the expiration worker runs twice", async () => {
    h.state.projects = [project("p1", subscription({ expiresAt: NOW }))]

    const first = await handleExpiration("p1", NOW)
    const second = await handleExpiration("p1", NOW)

    expect(first.outcome).toBe("expired")
    expect(second.outcome).toBe("testing")
    expect(h.state.capCalls).toHaveLength(1)
  })

  it("keeps the entitlement expired when the provider cap update fails, then replays safely", async () => {
    h.state.projects = [project("p1", subscription({ expiresAt: NOW }))]
    h.state.failCap = true

    const failed = await handleExpiration("p1", NOW)

    expect(failed.outcome).toBe("cap_failed")
    let infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.status).toBe("expired")
    expect(infra.syncStatus).toBe("failed")
    expect(evaluateInfrastructureAccess(infra, NOW).allowed).toBe(false)

    h.state.failCap = false
    const replayed = await handleExpiration("p1", NOW)

    expect(replayed.outcome).toBe("expired")
    infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.planId).toBe("testing")
    expect(infra.syncStatus).toBe("synced")
    expect(h.state.capCalls).toHaveLength(1)
  })

  it("marks a missing historical paid-through date for review and preserves access", async () => {
    const legacy = subscription({ expiresAt: undefined as unknown as number, needsReview: undefined })
    h.state.projects = [project("legacy", legacy)]

    const result = await handleExpiration("legacy", NOW)

    expect(result.outcome).toBe("needs_review")
    expect(h.state.capCalls).toHaveLength(0)
    const infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.needsReview).toBe(true)
    expect(infra.reviewReason).toContain("paid-through")
    expect(evaluateInfrastructureAccess(infra, NOW).allowed).toBe(true)
  })

  it("blocks paid access before the worker runs and after expiration", async () => {
    const expired = subscription({ expiresAt: NOW - 1 })
    expect(evaluateInfrastructureAccess(expired, NOW).allowed).toBe(false)
    expect(infrastructureDenial(expired, NOW)?.code).toBe("INFRASTRUCTURE_EXPIRED")

    const active = subscription({ expiresAt: NOW + 1 })
    expect(evaluateInfrastructureAccess(active, NOW).allowed).toBe(true)
    expect(infrastructureDenial(active, NOW)).toBeNull()
  })
})

describe("infrastructure lifecycle — cancellation, locks and sweep", () => {
  it("cancels future renewal but keeps access through the paid-through date", async () => {
    h.state.projects = [project()]

    const result = await cancelInfrastructurePlan("p1", "u1")

    expect(result.success).toBe(true)
    const infra = h.state.projects[0].infrastructure as InfrastructureSubscription
    expect(infra.status).toBe("cancelled")
    expect(infra.cancelledAt).toBe(NOW)
    expect(evaluateInfrastructureAccess(infra, NOW).allowed).toBe(true)
    expect(evaluateInfrastructureAccess(infra, NOW + 21 * DAY).allowed).toBe(false)

    const expired = await handleExpiration("p1", NOW + 21 * DAY)
    expect(expired.outcome).toBe("expired")
    expect(h.state.capCalls).toHaveLength(1)
  })

  it("serializes activation and expiration with the lifecycle lock", async () => {
    h.state.projects = [project("p1", subscription({
      expiresAt: NOW,
      lifecycleLock: { token: "other-worker", acquiredAt: NOW },
    }))]

    const expiration = await handleExpiration("p1", NOW)
    const activation = await activatePlan("p1", "u1", "basic", "blocked", { renewal: true })

    expect(expiration.outcome).toBe("locked")
    expect(activation.success).toBe(false)
    expect(activation.message).toContain("in progress")
  })

  it("reclaims a stale lock after an interrupted worker", async () => {
    h.state.projects = [project("p1", subscription({
      expiresAt: NOW,
      lifecycleLock: { token: "dead-worker", acquiredAt: NOW - 6 * 60 * 1000 },
    }))]

    const result = await handleExpiration("p1", NOW)

    expect(result.outcome).toBe("expired")
    expect((h.state.projects[0].infrastructure as InfrastructureSubscription).planId).toBe("testing")
  })

  it("retries an expired paid record even if a manual sync marked it synced", async () => {
    h.state.projects = [project("p1", subscription({
      status: "expired",
      syncStatus: "synced",
      expiresAt: NOW - DAY,
    }))]

    const result = await handleExpiration("p1", NOW)

    expect(result.outcome).toBe("expired")
    expect((h.state.projects[0].infrastructure as InfrastructureSubscription).planId).toBe("testing")
  })

  it("sweeps due paid plans and reports historical review separately", async () => {
    h.state.projects = [
      project("due", subscription({ expiresAt: NOW })),
      project("future", subscription({ expiresAt: NOW + DAY })),
      project("legacy", subscription({ expiresAt: undefined as unknown as number })),
      project("free", subscription({ planId: "testing", planName: "Testing", expiresAt: NOW - DAY })),
    ]

    const report = await runInfrastructureLifecycleSweep(NOW)

    expect(report.scanned).toBe(2)
    expect(report.expired).toBe(1)
    expect(report.needsReview).toBe(1)
    expect(h.state.capCalls).toEqual([{ totalumProjectId: "t_due", cap: 5 }])
  })
})
