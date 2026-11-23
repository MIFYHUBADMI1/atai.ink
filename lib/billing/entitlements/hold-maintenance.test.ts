import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  holds: [] as Array<Record<string, unknown>>,
  locks: [] as Array<Record<string, unknown>>,
  projects: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
}))

function matchesExpiry(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  const expiry = filter.expiresAt as { $lte?: number; $gt?: number } | undefined
  if (!expiry) return true
  const value = row.expiresAt as number
  if (expiry.$lte !== undefined && !(value <= expiry.$lte)) return false
  if (expiry.$gt !== undefined && !(value > expiry.$gt)) return false
  return true
}

vi.mock("@/lib/db/collections", () => ({
  billingResourceHoldsCol: async () => ({
    find: () => {
      const rows = [...h.holds].sort((a, b) => (a.expiresAt as number) - (b.expiresAt as number))
      return { sort: () => ({ toArray: async () => rows }) }
    },
    deleteOne: async ({ _id }: { _id: string }) => {
      h.deleted.push(_id)
      h.holds = h.holds.filter((row) => row._id !== _id)
      return { deletedCount: 1 }
    },
    countDocuments: async (filter: Record<string, unknown>) =>
      h.holds.filter((row) => matchesExpiry(row, filter)).length,
  }),
  billingResourceLocksCol: async () => ({
    deleteMany: async (filter: Record<string, unknown>) => {
      const before = h.locks.length
      h.locks = h.locks.filter((row) => !matchesExpiry(row, filter))
      return { deletedCount: before - h.locks.length }
    },
    countDocuments: async (filter: Record<string, unknown>) =>
      h.locks.filter((row) => matchesExpiry(row, filter)).length,
  }),
  projectsCol: async () => ({
    find: () => ({ toArray: async () => [...h.projects] }),
  }),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sweepResourceHolds } from "./hold-maintenance"

function hold(overrides: Record<string, unknown>) {
  return {
    _id: "h",
    scopeKey: "u:u1",
    kind: "customDomain",
    resourceId: "p1",
    userId: "u1",
    createdAt: 1,
    expiresAt: 10_000,
    ...overrides,
  }
}

beforeEach(() => {
  h.deleted = []
  h.locks = [
    { _id: "lock-expired", expiresAt: 900 },
    { _id: "lock-live", expiresAt: 20_000 },
  ]
  h.projects = [
    { id: "p-domain", deployment: { customDomain: "shop.example.com" } },
    { id: "p-sub", state: "deployed", deployment: { status: "success" } },
    { id: "p-live", state: "building" },
    { id: "p-history", state: "ready", deploymentHistory: [{ id: "d1", status: "success" }] },
  ]
  h.holds = [
    hold({ _id: "h-expired", resourceId: "p-live", expiresAt: 900 }),
    hold({ _id: "h-orphan", resourceId: "p-missing" }),
    hold({ _id: "h-domain", resourceId: "p-domain" }),
    hold({ _id: "h-sub", kind: "subdomain", resourceId: "p-sub" }),
    hold({ _id: "h-storage", kind: "storage", resourceId: "p-live", bytes: 50 }),
    hold({ _id: "h-history", kind: "subdomain", resourceId: "p-history" }),
  ]
})

describe("resource hold reconciliation", () => {
  it("deletes expired locks, expired holds, orphaned holds and realized slot holds", async () => {
    const report = await sweepResourceHolds({ now: 1_000 })

    expect(report).toMatchObject({
      dryRun: false,
      scanned: 6,
      expiredLocks: 1,
      expiredHolds: 1,
      orphanedHolds: 1,
      realizedHolds: 3,
      remainingActiveHolds: 1,
    })
    expect(h.deleted.sort()).toEqual(["h-domain", "h-expired", "h-history", "h-orphan", "h-sub"])
    expect(h.holds.map((row) => row._id)).toEqual(["h-storage"])
  })

  it("reports the same actions without deleting in dry-run mode", async () => {
    const report = await sweepResourceHolds({ now: 1_000, apply: false })

    expect(report).toMatchObject({
      dryRun: true,
      expiredLocks: 1,
      expiredHolds: 1,
      orphanedHolds: 1,
      realizedHolds: 3,
      remainingActiveHolds: 1,
    })
    expect(report.actions.every((action) => action.applied === false)).toBe(true)
    expect(h.deleted).toEqual([])
    expect(h.holds).toHaveLength(6)
  })
})
