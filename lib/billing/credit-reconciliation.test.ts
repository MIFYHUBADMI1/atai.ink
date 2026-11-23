import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Doc = Record<string, any>
  const state: { users: Doc[]; ledger: Doc[] } = { users: [], ledger: [] }

  const usersCol = {
    async findOne(filter: Doc) {
      return state.users.find((user) => user.id === filter.id) ?? null
    },
    find() {
      return {
        limit() {
          return this
        },
        async toArray() {
          return state.users.slice()
        },
      }
    },
    async updateOne(filter: Doc, update: Doc) {
      const user = state.users.find((row) => row.id === filter.id)
      if (!user) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(user, update.$set ?? {})
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }

  return {
    state,
    usersCol,
    reset() {
      state.users = []
      state.ledger = []
    },
  }
})

vi.mock("@/lib/db/collections", () => ({
  usersCol: vi.fn(async () => h.usersCol),
}))

vi.mock("@/lib/db/mongodb", () => ({
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      inTransaction: () => true,
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: vi.fn(async () => {}),
    }),
  })),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  recordLedgerEntry: vi.fn(async (params: Record<string, unknown>) => {
    const entry = { id: `ledger_${h.state.ledger.length + 1}`, ...params }
    h.state.ledger.push(entry)
    return entry
  }),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  auditCreditIntegrity,
  inspectUserCreditIntegrity,
  repairCreditBalance,
} from "./credit-reconciliation"

const NOW = 1_800_000_000_000

function bucket(amount: number, expiresAt = NOW + 86_400_000) {
  return {
    bucketId: "bucket_1",
    subscriptionId: "sub_1",
    planId: "growth",
    amount,
    originalAmount: 700,
    expiresAt,
    createdAt: NOW - 1000,
  }
}

describe("credit integrity", () => {
  beforeEach(() => h.reset())

  it("finds bucket, aggregate and expiry drift", () => {
    const findings = inspectUserCreditIntegrity(
      {
        id: "u1",
        credits: 900,
        subscriptionCredits: 800,
        permanentCredits: 100,
        creditBuckets: [bucket(700, NOW - 1)],
      },
      NOW,
    )

    expect(findings.map((finding) => finding.type)).toEqual(
      expect.arrayContaining(["bucket_sum_mismatch", "total_mismatch", "overdue_buckets"]),
    )
    expect(findings[0]).toMatchObject({
      bucketSum: 700,
      expectedSubscription: 700,
      expectedTotal: 800,
    })
  })

  it("repairs the aggregates from the buckets and writes a ledger entry", async () => {
    h.state.users.push({
      id: "u1",
      credits: 900,
      subscriptionCredits: 800,
      permanentCredits: 100,
      creditBuckets: [bucket(700)],
    })

    const result = await repairCreditBalance({
      userId: "u1",
      actor: "ops@atai.ink",
      reason: "legacy drift",
      now: NOW,
    })

    expect(result.repaired).toBe(true)
    expect(result.before.subscriptionCredits).toBe(800)
    expect(result.after.subscriptionCredits).toBe(700)
    expect(h.state.users[0]).toMatchObject({ subscriptionCredits: 700, credits: 800 })
    expect(h.state.ledger).toHaveLength(1)
    expect(h.state.ledger[0]).toMatchObject({
      creditType: "subscription",
      amount: 100,
      direction: "debit",
      transactionType: "credit_reconciliation",
      balanceBefore: 800,
      balanceAfter: 700,
    })
  })

  it("does not invent permanent credits when the field is absent", async () => {
    h.state.users.push({
      id: "u1",
      credits: 1000,
      subscriptionCredits: 800,
      creditBuckets: [bucket(700)],
    })

    const findings = inspectUserCreditIntegrity(h.state.users[0], NOW)
    expect(findings.map((finding) => finding.type)).not.toContain("total_mismatch")

    const result = await repairCreditBalance({
      userId: "u1",
      actor: "ops@atai.ink",
      reason: "legacy drift",
      now: NOW,
    })

    expect(result.repaired).toBe(true)
    expect(h.state.users[0]).toMatchObject({ subscriptionCredits: 700, credits: 900 })
    expect(h.state.users[0].permanentCredits).toBeUndefined()
    expect(h.state.ledger[0]).toMatchObject({ creditType: "subscription", amount: 100, direction: "debit" })
  })

  it("corrects a legacy total mirror without inventing a bucket or a ledger movement", async () => {
    h.state.users.push({
      id: "u1",
      credits: 950,
      subscriptionCredits: 800,
      permanentCredits: 100,
      creditBuckets: [],
    })

    const result = await repairCreditBalance({
      userId: "u1",
      actor: "ops@atai.ink",
      reason: "mirror drift",
      now: NOW,
    })

    expect(result.repaired).toBe(false)
    expect(result.mirrorOnly).toBe(true)
    expect(h.state.users[0]).toMatchObject({ subscriptionCredits: 800, credits: 900 })
    expect(h.state.ledger).toHaveLength(0)
  })

  it("leaves a consistent account untouched", async () => {
    h.state.users.push({
      id: "u1",
      credits: 800,
      subscriptionCredits: 700,
      permanentCredits: 100,
      creditBuckets: [bucket(700)],
    })

    const result = await repairCreditBalance({
      userId: "u1",
      actor: "ops@atai.ink",
      reason: "check",
      now: NOW,
    })

    expect(result.repaired).toBe(false)
    expect(result.ledgerEntryIds).toHaveLength(0)
    expect(h.state.ledger).toHaveLength(0)
  })

  it("audits users and reports the scan window", async () => {
    h.state.users.push(
      { id: "u1", credits: 800, subscriptionCredits: 800, permanentCredits: 0, creditBuckets: [bucket(700)] },
      { id: "u2", credits: 0, subscriptionCredits: 0, permanentCredits: 0, creditBuckets: [] },
    )

    const report = await auditCreditIntegrity({ now: NOW, limit: 10 })
    expect(report.scanned).toBe(2)
    expect(report.truncated).toBe(false)
    expect(report.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: "u1", type: "bucket_sum_mismatch" })]),
    )
  })

  it("requires an actor and a reason before repairing", async () => {
    h.state.users.push({ id: "u1", credits: 800, subscriptionCredits: 800, permanentCredits: 0 })
    await expect(
      repairCreditBalance({ userId: "u1", actor: "", reason: "x" }),
    ).rejects.toThrow("actor and a reason")
  })
})
