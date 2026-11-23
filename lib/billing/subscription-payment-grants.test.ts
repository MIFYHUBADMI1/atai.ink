import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Phase A2 / M-14 — payment → grant linkage and bucket-safe subscription
 * refund reversal.
 *
 * These tests run the real linkage and reversal code against an in-memory
 * model of the Mongo subset it uses. The credit ledger is the only balance
 * authority; the assertions check the flat fields and the bucket amounts move
 * together, and that permanent credits are never touched.
 */

vi.mock("server-only", () => ({}))

// In-memory Mongo documents are dynamic by nature; this harness is the fake.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>

function eq(value: unknown, wanted: unknown): boolean {
  if (wanted === null) return value === null || value === undefined
  return value === wanted
}

function matches(doc: Doc, filter: Doc = {}): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((f) => matches(doc, f))
    if (key.includes(".")) {
      const [head, ...rest] = key.split(".")
      const value = doc[head]
      const nested = { [rest.join(".")]: cond }
      if (Array.isArray(value)) return value.some((item) => matches(item, nested))
      return value !== undefined && matches(value, nested)
    }
    if (key === "$and") return (cond as Doc[]).every((f) => matches(doc, f))
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      return Object.entries(cond as Doc).every(([op, arg]) => {
        if (op === "$elemMatch") return Array.isArray(doc[key]) && (doc[key] as Doc[]).some((item) => matches(item, arg as Doc))
        if (op === "$in") return (arg as unknown[]).some((a) => eq(doc[key], a))
        if (op === "$ne") {
          const value = doc[key]
          if (Array.isArray(value)) return !value.some((item) => eq(item, arg))
          return !eq(value, arg)
        }
        if (op === "$exists") return arg ? doc[key] !== undefined : doc[key] === undefined
        if (op === "$gte") return doc[key] >= arg
        if (op === "$lt") return doc[key] < arg
        if (op === "$lte") return doc[key] <= arg
        throw new Error(`unsupported operator ${op}`)
      })
    }
    return eq(doc[key], cond)
  })
}

function applyUpdate(doc: Doc, update: Doc): void {
  if (update.$set) Object.assign(doc, update.$set)
  if (update.$unset) for (const key of Object.keys(update.$unset)) delete doc[key]
  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc as Record<string, number>)) {
      if (key === "creditBuckets.$.amount") continue
      doc[key] = (doc[key] ?? 0) + value
    }
  }
  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet as Record<string, unknown>)) {
      if (!Array.isArray(doc[key])) doc[key] = []
      if (!doc[key].includes(value)) doc[key].push(value)
    }
  }
  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push as Record<string, unknown>)) {
      if (!Array.isArray(doc[key])) doc[key] = []
      doc[key].push(value)
    }
  }
  if (update.$pull) {
    for (const [key, cond] of Object.entries(update.$pull as Record<string, Doc>)) {
      if (!Array.isArray(doc[key])) continue
      doc[key] = doc[key].filter((item: Doc) => !matches(item, cond))
    }
  }
}

const h = vi.hoisted(() => {
  const state: {
    payments: Doc[]
    ledger: Doc[]
    subs: Doc[]
    users: Doc[]
    failLedgerKeys: Set<string>
    failBucketUpdate: boolean
    failBucketPush: boolean
    failNextTransaction: boolean
  } = {
    payments: [],
    ledger: [],
    subs: [],
    users: [],
    failLedgerKeys: new Set(),
    failBucketUpdate: false,
    failBucketPush: false,
    failNextTransaction: false,
  }

  function cursor(initial: Doc[]) {
    let rows = initial
    const c = {
      sort(spec: Doc) {
        const [key, dir] = Object.entries(spec)[0] as [string, number]
        rows = rows.slice().sort((a, b) => {
          const av = a[key] ?? 0
          const bv = b[key] ?? 0
          return av === bv ? 0 : av < bv ? -1 * dir : 1 * dir
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

  const paymentsCol = {
    async findOne(filter: Doc) {
      return state.payments.find((p) => matches(p, filter)) ?? null
    },
    find(filter: Doc = {}) {
      return cursor(state.payments.filter((p) => matches(p, filter)))
    },
    async updateOne(filter: Doc, update: Doc) {
      const doc = state.payments.find((p) => matches(p, filter))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      applyUpdate(doc, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async insertOne(doc: Doc) {
      state.payments.push(doc)
      return { acknowledged: true }
    },
  }

  const ledgerCol = {
    async findOne(filter: Doc) {
      return state.ledger.find((l) => matches(l, filter)) ?? null
    },
    find(filter: Doc = {}) {
      return cursor(state.ledger.filter((l) => matches(l, filter)))
    },
    async updateOne(filter: Doc, update: Doc) {
      const doc = state.ledger.find((l) => matches(l, filter))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      applyUpdate(doc, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    async insertOne(doc: Doc) {
      if (state.failLedgerKeys.has(doc.idempotencyKey)) {
        throw new Error("simulated ledger failure")
      }
      state.ledger.push(doc)
      return { acknowledged: true }
    },
  }

  const subsCol = {
    async findOne(filter: Doc) {
      return state.subs.find((s) => matches(s, filter)) ?? null
    },
  }

  const usersCol = {
    async findOne(filter: Doc) {
      return state.users.find((u) => matches(u, filter)) ?? null
    },
    async updateOne(filter: Doc, update: Doc) {
      const user = state.users.find((u) => u.id === filter.id)
      if (!user) return { matchedCount: 0, modifiedCount: 0 }
      const bucketFilter =
        filter.creditBuckets?.$elemMatch ??
        (filter["creditBuckets.bucketId"]
          ? { bucketId: filter["creditBuckets.bucketId"] }
          : {
              subscriptionId: filter["creditBuckets.subscriptionId"],
              expiresAt: filter["creditBuckets.expiresAt"],
            })
      if (update.$inc?.["creditBuckets.$.amount"] !== undefined) {
        if (state.failBucketUpdate) throw new Error("simulated bucket update failure")
        const delta = update.$inc["creditBuckets.$.amount"] as number
        const bucket = (user.creditBuckets ?? []).find((b: Doc) => matches(b, bucketFilter))
        if (!bucket) return { matchedCount: 0, modifiedCount: 0 }
        bucket.amount += delta
      }
      if (state.failBucketUpdate && update.$pull?.creditBuckets) {
        throw new Error("simulated bucket removal failure")
      }
      if (state.failBucketPush && update.$push?.creditBuckets) {
        throw new Error("simulated bucket creation failure")
      }
      applyUpdate(user, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }

  const recordLedgerEntry = vi.fn(async (p: Doc) => {
    if (state.failLedgerKeys.has(p.idempotencyKey)) {
      throw new Error("simulated ledger failure")
    }
    const entry = {
      _id: `le_${state.ledger.length + 1}`,
      id: `ledger_${state.ledger.length + 1}`,
      createdAt: Date.now(),
      ...p,
    }
    state.ledger.push(entry)
    return entry
  })

  let transactionChain: Promise<void> = Promise.resolve()

  function restore(snapshot: typeof state) {
    state.payments = snapshot.payments
    state.ledger = snapshot.ledger
    state.subs = snapshot.subs
    state.users = snapshot.users
    state.failLedgerKeys = snapshot.failLedgerKeys
    state.failBucketUpdate = snapshot.failBucketUpdate
    state.failBucketPush = snapshot.failBucketPush
  }

  async function runTransaction(fn: () => Promise<void>) {
    const previous = transactionChain
    let release!: () => void
    transactionChain = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const snapshot = structuredClone(state)
    try {
      await fn()
      if (state.failNextTransaction) {
        state.failNextTransaction = false
        restore(snapshot)
        state.failNextTransaction = false
        await fn()
      }
    } catch (error) {
      restore(snapshot)
      throw error
    } finally {
      release()
    }
  }

  return {
    state,
    paymentsCol,
    ledgerCol,
    subsCol,
    usersCol,
    recordLedgerEntry,
    runTransaction,
    reset() {
      state.payments = []
      state.ledger = []
      state.subs = []
      state.users = []
      state.failLedgerKeys.clear()
      state.failBucketUpdate = false
      state.failBucketPush = false
      state.failNextTransaction = false
      recordLedgerEntry.mockClear()
    },
  }
})

vi.mock("@/lib/db/collections", () => ({
  paymentRecordsCol: vi.fn(async () => h.paymentsCol),
  creditLedgerCol: vi.fn(async () => h.ledgerCol),
  subscriptionRecordsCol: vi.fn(async () => h.subsCol),
  usersCol: vi.fn(async () => h.usersCol),
}))

vi.mock("@/lib/db/mongodb", () => ({
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: h.runTransaction,
      endSession: vi.fn(async () => {}),
    }),
  })),
}))

vi.mock("@/lib/billing/credit-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/credit-service")>()
  return { ...actual, recordLedgerEntry: h.recordLedgerEntry }
})

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  linkPaymentToExistingGrants,
  linkSubscriptionGrantToPayment,
  reverseSubscriptionCredits,
  subscriptionGrantIdempotencyKey,
} from "./subscription-payment-grants"
import {
  reverseCredits,
  consumeCredits,
  expireOverdueBuckets,
  expireSubscriptionCredits,
  grantSubscriptionCredits,
} from "./credit-service"
import { reconcileSubscriptionPayments } from "./payment-reconciliation"

const NOW = new Date("2026-06-01T00:00:00.000Z").getTime()
const MONTH = 30 * 86_400_000
const YEAR = 365 * 86_400_000

function payment(overrides: Doc = {}): Doc {
  return {
    id: "pay_row_1",
    userId: "u1",
    dodoPaymentId: "pay_1",
    subscriptionId: "sub_1",
    paymentType: "subscription",
    status: "succeeded",
    amount: 12000,
    currency: "USD",
    providerCreatedAt: NOW,
    grantStatus: "pending",
    createdAt: NOW,
    ...overrides,
  }
}

function grant(overrides: Doc = {}): Doc {
  return {
    id: "ledger_grant_1",
    idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + MONTH),
    userId: "u1",
    amount: 500,
    direction: "credit",
    transactionType: "subscription_grant",
    referenceType: "subscription",
    referenceId: "sub_1",
    createdAt: NOW,
    metadata: { periodStart: NOW, periodEnd: NOW + MONTH, bucketId: "bucket_1", planId: "growth" },
    ...overrides,
  }
}

describe("subscription payment → grant linkage", () => {
  beforeEach(() => h.reset())

  it("records the exact credits granted and links the ledger entry", async () => {
    h.state.payments.push(payment({ creditsAllocated: 500 }))
    h.state.ledger.push(grant())

    const result = await linkSubscriptionGrantToPayment({
      userId: "u1",
      subscriptionId: "sub_1",
      planId: "growth",
      periodStart: NOW,
      periodEnd: NOW + MONTH,
      amount: 500,
      creditsAllocated: 500,
      ledgerEntryId: "ledger_grant_1",
      ledgerIdempotencyKey: grant().idempotencyKey,
      bucketId: "bucket_1",
      now: NOW,
    })

    expect(result.linked).toBe(true)
    const row = h.state.payments[0]
    expect(row.creditsGranted).toBe(500)
    expect(row.grantStatus).toBe("granted")
    expect(row.grantLedgerEntryIds).toEqual(["ledger_grant_1"])
    expect(row.grantBucketIds).toEqual(["bucket_1"])
    expect(row.creditType).toBe("subscription")
    expect(h.state.ledger[0].paymentId).toBe("pay_1")
  })

  it("is idempotent: linking the same grant twice cannot double-count credits", async () => {
    h.state.payments.push(payment({ creditsAllocated: 500 }))
    h.state.ledger.push(grant())

    for (let i = 0; i < 3; i++) {
      await linkSubscriptionGrantToPayment({
        userId: "u1",
        subscriptionId: "sub_1",
        planId: "growth",
        periodStart: NOW,
        periodEnd: NOW + MONTH,
        amount: 500,
        creditsAllocated: 500,
        ledgerEntryId: "ledger_grant_1",
        ledgerIdempotencyKey: grant().idempotencyKey,
        bucketId: "bucket_1",
        now: NOW,
      })
    }

    expect(h.state.payments[0].creditsGranted).toBe(500)
  })

  it("annual issuance tracks issued credits, not the full annual allocation", async () => {
    h.state.payments.push(payment({ creditsAllocated: 6000, paidPeriodStart: NOW, paidPeriodEnd: NOW + YEAR }))

    for (let month = 0; month < 12; month++) {
      const periodStart = NOW + month * MONTH
      await linkSubscriptionGrantToPayment({
        userId: "u1",
        subscriptionId: "sub_1",
        planId: "growth",
        periodStart,
        periodEnd: periodStart + MONTH,
        amount: 500,
        creditsAllocated: 6000,
        ledgerEntryId: `ledger_grant_${month}`,
        ledgerIdempotencyKey: subscriptionGrantIdempotencyKey("sub_1", periodStart + MONTH),
        bucketId: `bucket_${month}`,
        now: periodStart,
      })
      if (month === 0) {
        expect(h.state.payments[0].creditsGranted).toBe(500)
        expect(h.state.payments[0].grantStatus).toBe("partially_granted")
      }
    }

    expect(h.state.payments[0].creditsGranted).toBe(6000)
    expect(h.state.payments[0].grantStatus).toBe("granted")
  })

  it("links a late payment to the grant that already exists", async () => {
    h.state.payments.push(payment({ grantStatus: "pending" }))
    h.state.ledger.push(grant())

    const result = await linkPaymentToExistingGrants(h.state.payments[0])
    expect(result.linked).toBe(true)
    expect(h.state.payments[0].creditsGranted).toBe(500)
    expect(h.state.payments[0].grantLinkMethod).toBe("ledger_reference")
  })

  it("does not link a payment when the only grant is outside its window", async () => {
    h.state.payments.push(payment({ providerCreatedAt: NOW - 30 * 86_400_000 }))
    h.state.ledger.push(grant())

    const result = await linkPaymentToExistingGrants(h.state.payments[0])
    expect(result.linked).toBe(false)
    expect(h.state.payments[0].creditsGranted).toBeUndefined()
  })

  it("two consecutive monthly payments with identical allocations never absorb each other's grant", async () => {
    h.state.subs.push({
      dodoSubscriptionId: "sub_1",
      userId: "u1",
      status: "active",
      billingCycle: "monthly",
      currentPeriodStart: NOW,
      currentPeriodEnd: NOW + 2 * MONTH,
      purchasedTerms: { monthlyCredits: 500, planId: "growth" },
    })
    h.state.payments.push(
      payment({ dodoPaymentId: "pay_1", providerCreatedAt: NOW, creditsAllocated: 500 }),
      payment({
        id: "pay_row_2",
        dodoPaymentId: "pay_2",
        providerCreatedAt: NOW + MONTH,
        creditsAllocated: 500,
      }),
    )
    h.state.ledger.push(
      grant({
        id: "ledger_grant_1",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + MONTH),
        createdAt: NOW,
        metadata: { periodStart: NOW, periodEnd: NOW + MONTH, bucketId: "bucket_1" },
      }),
      grant({
        id: "ledger_grant_2",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + 2 * MONTH),
        createdAt: NOW + MONTH,
        metadata: {
          periodStart: NOW + MONTH,
          periodEnd: NOW + 2 * MONTH,
          bucketId: "bucket_2",
        },
      }),
    )

    await linkPaymentToExistingGrants(h.state.payments[0])
    await linkPaymentToExistingGrants(h.state.payments[1])

    expect(h.state.payments[0].creditsGranted).toBe(500)
    expect(h.state.payments[0].grantLedgerEntryIds).toEqual(["ledger_grant_1"])
    expect(h.state.payments[1].creditsGranted).toBe(500)
    expect(h.state.payments[1].grantLedgerEntryIds).toEqual(["ledger_grant_2"])
  })

  it("a delayed payment arriving after the next renewal links only its own period", async () => {
    h.state.subs.push({
      dodoSubscriptionId: "sub_1",
      userId: "u1",
      status: "active",
      billingCycle: "monthly",
      currentPeriodStart: NOW + MONTH,
      currentPeriodEnd: NOW + 2 * MONTH,
      purchasedTerms: { monthlyCredits: 500, planId: "growth" },
    })
    h.state.payments.push(
      payment({
        dodoPaymentId: "pay_old",
        providerCreatedAt: NOW,
        createdAt: NOW + 2 * MONTH,
        creditsAllocated: 500,
      }),
      payment({
        id: "pay_row_new",
        dodoPaymentId: "pay_new",
        providerCreatedAt: NOW + MONTH,
        createdAt: NOW + 2 * MONTH,
        creditsAllocated: 500,
      }),
    )
    h.state.ledger.push(
      grant({
        id: "ledger_old",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + MONTH),
        createdAt: NOW,
        metadata: { periodStart: NOW, periodEnd: NOW + MONTH, bucketId: "bucket_old" },
      }),
      grant({
        id: "ledger_new",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + 2 * MONTH),
        createdAt: NOW + MONTH,
        metadata: {
          periodStart: NOW + MONTH,
          periodEnd: NOW + 2 * MONTH,
          bucketId: "bucket_new",
        },
      }),
    )

    await linkPaymentToExistingGrants(h.state.payments[0])
    await linkPaymentToExistingGrants(h.state.payments[1])

    expect(h.state.payments[0].grantLedgerEntryIds).toEqual(["ledger_old"])
    expect(h.state.payments[1].grantLedgerEntryIds).toEqual(["ledger_new"])
  })

  it("links annual months 1..N to the same annual payment", async () => {
    h.state.subs.push({
      dodoSubscriptionId: "sub_1",
      userId: "u1",
      status: "active",
      billingCycle: "annual",
      currentPeriodStart: NOW,
      currentPeriodEnd: NOW + YEAR,
      purchasedTerms: {
        planId: "growth",
        monthlyCredits: 500,
        annual: { months: 12, totalCredits: 6000 },
      },
    })
    h.state.payments.push(
      payment({ creditsAllocated: 6000, paidPeriodStart: undefined, paidPeriodEnd: undefined }),
    )
    h.state.ledger.push(
      grant({
        id: "ledger_m0",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + MONTH),
        createdAt: NOW,
        metadata: { periodStart: NOW, periodEnd: NOW + MONTH, bucketId: "bucket_m0" },
      }),
      grant({
        id: "ledger_m1",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + 2 * MONTH),
        createdAt: NOW + MONTH,
        metadata: {
          periodStart: NOW + MONTH,
          periodEnd: NOW + 2 * MONTH,
          bucketId: "bucket_m1",
        },
      }),
    )

    await linkPaymentToExistingGrants(h.state.payments[0])
    expect(h.state.payments[0].creditsGranted).toBe(1000)
    expect(h.state.payments[0].grantStatus).toBe("partially_granted")
    expect(h.state.payments[0].paidPeriodStart).toBe(NOW)
    expect(h.state.payments[0].paidPeriodEnd).toBe(NOW + YEAR)
    expect(h.state.payments[0].grantLedgerEntryIds).toEqual(["ledger_m0", "ledger_m1"])

    // Month 2 arrives later and must still find the annual payment by period.
    h.state.ledger.push(
      grant({
        id: "ledger_m2",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + 3 * MONTH),
        createdAt: NOW + 2 * MONTH,
        metadata: {
          periodStart: NOW + 2 * MONTH,
          periodEnd: NOW + 3 * MONTH,
          bucketId: "bucket_m2",
        },
      }),
    )
    const month2 = await linkSubscriptionGrantToPayment({
      userId: "u1",
      subscriptionId: "sub_1",
      planId: "growth",
      periodStart: NOW + 2 * MONTH,
      periodEnd: NOW + 3 * MONTH,
      amount: 500,
      creditsAllocated: 6000,
      ledgerEntryId: "ledger_m2",
      ledgerIdempotencyKey: subscriptionGrantIdempotencyKey("sub_1", NOW + 3 * MONTH),
      bucketId: "bucket_m2",
      now: NOW + 2 * MONTH,
    })
    expect(month2.linked).toBe(true)
    expect(h.state.payments[0].creditsGranted).toBe(1500)
    expect(h.state.payments[0].grantLedgerEntryIds).toContain("ledger_m2")
  })

  it("concurrent duplicate links cannot double-count the same grant", async () => {
    h.state.payments.push(payment({ creditsAllocated: 500 }))
    h.state.ledger.push(grant())

    await Promise.all([
      linkSubscriptionGrantToPayment({
        userId: "u1",
        subscriptionId: "sub_1",
        planId: "growth",
        periodStart: NOW,
        periodEnd: NOW + MONTH,
        amount: 500,
        creditsAllocated: 500,
        ledgerEntryId: "ledger_grant_1",
        ledgerIdempotencyKey: grant().idempotencyKey,
        bucketId: "bucket_1",
        now: NOW,
      }),
      linkSubscriptionGrantToPayment({
        userId: "u1",
        subscriptionId: "sub_1",
        planId: "growth",
        periodStart: NOW,
        periodEnd: NOW + MONTH,
        amount: 500,
        creditsAllocated: 500,
        ledgerEntryId: "ledger_grant_1",
        ledgerIdempotencyKey: grant().idempotencyKey,
        bucketId: "bucket_1",
        now: NOW,
      }),
    ])

    expect(h.state.payments[0].creditsGranted).toBe(500)
    expect(h.state.payments[0].grantLedgerEntryIds).toEqual(["ledger_grant_1"])
  })

  it("same user, different subscription: neither direction links across subscriptions", async () => {
    h.state.payments.push(
      payment({ dodoPaymentId: "pay_1", subscriptionId: "sub_1", creditsAllocated: 500 }),
      payment({
        id: "pay_row_2",
        dodoPaymentId: "pay_2",
        subscriptionId: "sub_2",
        creditsAllocated: 500,
      }),
    )
    h.state.ledger.push(
      grant({
        id: "ledger_sub_1",
        referenceId: "sub_1",
        metadata: { periodStart: NOW, periodEnd: NOW + MONTH, bucketId: "bucket_1" },
      }),
      grant({
        id: "ledger_sub_2",
        referenceId: "sub_2",
        idempotencyKey: subscriptionGrantIdempotencyKey("sub_2", NOW + MONTH),
        metadata: { periodStart: NOW, periodEnd: NOW + MONTH, bucketId: "bucket_2" },
      }),
    )

    await linkPaymentToExistingGrants(h.state.payments[0])
    expect(h.state.payments[0].grantLedgerEntryIds).toEqual(["ledger_sub_1"])

    const wrongPayment = await linkSubscriptionGrantToPayment({
      userId: "u1",
      subscriptionId: "sub_2",
      planId: "growth",
      periodStart: NOW,
      periodEnd: NOW + MONTH,
      amount: 500,
      creditsAllocated: 500,
      ledgerEntryId: "ledger_sub_2",
      ledgerIdempotencyKey: subscriptionGrantIdempotencyKey("sub_2", NOW + MONTH),
      paymentId: "pay_1",
      now: NOW,
    })
    expect(wrongPayment.linked).toBe(false)
    expect(wrongPayment.reason).toBe("payment_subscription_mismatch")

    const wrongGrant = await linkSubscriptionGrantToPayment({
      userId: "u1",
      subscriptionId: "sub_1",
      planId: "growth",
      periodStart: NOW,
      periodEnd: NOW + MONTH,
      amount: 500,
      creditsAllocated: 500,
      ledgerEntryId: "ledger_sub_2",
      ledgerIdempotencyKey: subscriptionGrantIdempotencyKey("sub_2", NOW + MONTH),
      paymentId: "pay_1",
      now: NOW,
    })
    expect(wrongGrant.linked).toBe(false)
    expect(wrongGrant.reason).toBe("grant_subscription_mismatch")
  })

  it("two payments covering the same paid period are ambiguous, not guessed", async () => {
    h.state.payments.push(
      payment({
        dodoPaymentId: "pay_1",
        creditsAllocated: 500,
        paidPeriodStart: NOW,
        paidPeriodEnd: NOW + MONTH,
      }),
      payment({
        id: "pay_row_2",
        dodoPaymentId: "pay_2",
        creditsAllocated: 500,
        paidPeriodStart: NOW,
        paidPeriodEnd: NOW + MONTH,
      }),
    )
    h.state.ledger.push(grant())

    const result = await linkSubscriptionGrantToPayment({
      userId: "u1",
      subscriptionId: "sub_1",
      planId: "growth",
      periodStart: NOW,
      periodEnd: NOW + MONTH,
      amount: 500,
      creditsAllocated: 500,
      ledgerEntryId: "ledger_grant_1",
      ledgerIdempotencyKey: grant().idempotencyKey,
      bucketId: "bucket_1",
      now: NOW,
    })

    expect(result.linked).toBe(false)
    expect(result.reason).toBe("ambiguous_payment")
  })
})

describe("bucket-safe subscription reversal", () => {
  beforeEach(() => {
    h.reset()
    h.state.users.push({
      id: "u1",
      credits: 600,
      subscriptionCredits: 500,
      permanentCredits: 100,
      creditBuckets: [
        {
          bucketId: "bucket_1",
          subscriptionId: "sub_1",
          planId: "growth",
          amount: 500,
          originalAmount: 500,
          expiresAt: NOW + MONTH,
          createdAt: NOW,
        },
      ],
    })
  })

  it("reverses from the exact bucket and keeps permanent credits untouched", async () => {
    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 200,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_rf_1",
      now: NOW,
    })

    expect(result.success).toBe(true)
    expect(result.actualReversed).toBe(200)
    const user = h.state.users[0]
    expect(user.subscriptionCredits).toBe(300)
    expect(user.credits).toBe(400)
    expect(user.permanentCredits).toBe(100)
    expect(user.creditBuckets[0].amount).toBe(300)
    expect(h.state.ledger[0]).toMatchObject({
      amount: 200,
      direction: "debit",
      transactionType: "refund_reversal",
      idempotencyKey: "refund_rf_1",
    })
  })

  it("removes the bucket when fully reversed and never goes below zero", async () => {
    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 9999,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_rf_full",
      now: NOW,
    })

    expect(result.actualReversed).toBe(500)
    const user = h.state.users[0]
    expect(user.subscriptionCredits).toBe(0)
    expect(user.credits).toBe(100)
    expect(user.permanentCredits).toBe(100)
    expect(user.creditBuckets).toEqual([])
  })

  it("replays a reversal idempotently", async () => {
    await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 200,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_rf_1",
      now: NOW,
    })
    const second = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 200,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_rf_1",
      now: NOW,
    })

    expect(second.actualReversed).toBe(200)
    expect(h.state.users[0].subscriptionCredits).toBe(300)
    expect(h.state.users[0].creditBuckets[0].amount).toBe(300)
    expect(h.state.ledger).toHaveLength(1)
  })

  it("does not touch a different subscription's bucket", async () => {
    h.state.users[0].creditBuckets.push({
      bucketId: "bucket_other",
      subscriptionId: "sub_other",
      planId: "starter",
      amount: 400,
      originalAmount: 400,
      expiresAt: NOW + MONTH,
      createdAt: NOW,
    })
    h.state.users[0].subscriptionCredits = 900
    h.state.users[0].credits = 1000

    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 500,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_rf_scoped",
      now: NOW,
    })

    expect(result.actualReversed).toBe(500)
    const other = h.state.users[0].creditBuckets.find((b: Doc) => b.bucketId === "bucket_other")
    expect(other.amount).toBe(400)
    expect(h.state.users[0].subscriptionCredits).toBe(400)
  })

  it("reports nothing available when the grant's bucket is already gone", async () => {
    h.state.users[0].creditBuckets = []
    h.state.users[0].subscriptionCredits = 0
    h.state.users[0].credits = 100

    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 500,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_rf_gone",
      now: NOW,
    })

    expect(result.success).toBe(false)
    expect(result.reason).toBe("nothing_available")
    expect(h.state.users[0].permanentCredits).toBe(100)
  })
  it("reverses only the grant's buckets, newest first, and keeps aggregates aligned", async () => {
    const user = h.state.users[0]
    user.creditBuckets = [
      {
        bucketId: "bucket_old",
        subscriptionId: "sub_1",
        planId: "growth",
        amount: 500,
        originalAmount: 500,
        expiresAt: NOW + MONTH,
        createdAt: NOW - 1000,
      },
      {
        bucketId: "bucket_new",
        subscriptionId: "sub_1",
        planId: "growth",
        amount: 300,
        originalAmount: 300,
        expiresAt: NOW + 2 * MONTH,
        createdAt: NOW,
      },
    ]
    user.subscriptionCredits = 800
    user.credits = 900

    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 600,
      bucketIds: ["bucket_old", "bucket_new"],
      idempotencyKey: "refund_multi",
      now: NOW,
    })

    expect(result.actualReversed).toBe(600)
    expect(result.bucketDeductions).toEqual([
      { bucketId: "bucket_new", subscriptionId: "sub_1", amount: 300 },
      { bucketId: "bucket_old", subscriptionId: "sub_1", amount: 300 },
    ])
    expect(user.creditBuckets).toHaveLength(1)
    expect(user.creditBuckets[0]).toMatchObject({ bucketId: "bucket_old", amount: 200 })
    expect(user.subscriptionCredits).toBe(200)
    expect(user.credits).toBe(300)
    expect(user.credits).toBe(user.subscriptionCredits + user.permanentCredits)
  })

  it("reports consumed credits as a shortfall instead of reversing unrelated balance", async () => {
    const user = h.state.users[0]
    user.creditBuckets[0].amount = 300
    user.creditBuckets[0].originalAmount = 500
    user.subscriptionCredits = 300
    user.credits = 400

    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 500,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_consumed",
      now: NOW,
    })

    expect(result.success).toBe(true)
    expect(result.actualReversed).toBe(300)
    expect(result.shortfall).toBe(200)
    expect(result.consumedAmount).toBe(200)
    expect(result.shortfallReason).toBe("consumed")
    expect(user.subscriptionCredits).toBe(0)
    expect(user.credits).toBe(100)
    expect(user.creditBuckets).toHaveLength(0)
    expect(h.state.ledger[0].amount).toBe(300)
  })

  it("reports a fully consumed grant as missing without inventing credits", async () => {
    const user = h.state.users[0]
    user.creditBuckets = []
    user.subscriptionCredits = 0
    user.credits = 100

    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 500,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_gone",
      now: NOW,
    })

    expect(result.success).toBe(false)
    expect(result.shortfall).toBe(500)
    expect(result.missingBucketIds).toEqual(["bucket_1"])
    expect(result.shortfallReason).toBe("missing_bucket")
    expect(user.permanentCredits).toBe(100)
    expect(h.state.ledger).toHaveLength(0)
  })

  it("does not reverse expired credits and reports the expired amount", async () => {
    const user = h.state.users[0]
    user.creditBuckets[0].expiresAt = NOW - 1

    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 500,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_expired",
      now: NOW,
    })

    expect(result.success).toBe(false)
    expect(result.availableAmount).toBe(0)
    expect(result.expiredAmount).toBe(500)
    expect(result.shortfallReason).toBe("expired")
    expect(user.subscriptionCredits).toBe(500)
    expect(user.credits).toBe(600)
    expect(h.state.ledger).toHaveLength(0)
  })

  it("distinguishes a previous reversal from consumed credits", async () => {
    const user = h.state.users[0]
    await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 300,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_first",
      now: NOW,
    })

    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 500,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_second",
      now: NOW,
    })

    expect(result.actualReversed).toBe(200)
    expect(result.previouslyReversedAmount).toBe(300)
    expect(result.previouslyReversedBucketIds).toEqual(["bucket_1"])
    expect(result.consumedAmount).toBe(0)
    expect(result.shortfall).toBe(300)
    expect(result.shortfallReason).toBe("already_reversed")
    expect(user.subscriptionCredits).toBe(0)
    expect(user.credits).toBe(100)
    expect(user.creditBuckets).toHaveLength(0)
    expect(h.state.ledger).toHaveLength(2)
  })

  it("protects permanent credits from a subscription reversal", async () => {
    const result = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 100,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_sub_only",
      now: NOW,
    })

    expect(result.actualReversed).toBe(100)
    expect(h.state.users[0].permanentCredits).toBe(100)
    expect(h.state.users[0].subscriptionCredits).toBe(400)
    expect(h.state.users[0].creditBuckets[0].amount).toBe(400)
  })

  it("protects subscription credits from a permanent reversal", async () => {
    const result = await reverseCredits({
      userId: "u1",
      creditType: "permanent",
      amount: 50,
      transactionType: "admin_adjustment",
      idempotencyKey: "admin_perm_50",
      now: NOW,
    })

    expect(result.success).toBe(true)
    expect(result.actualReversed).toBe(50)
    expect(h.state.users[0].permanentCredits).toBe(50)
    expect(h.state.users[0].subscriptionCredits).toBe(500)
    expect(h.state.users[0].creditBuckets[0].amount).toBe(500)
  })

  it("never overdraws when two reversals run concurrently", async () => {
    const user = h.state.users[0]
    const results = await Promise.all([
      reverseSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_1",
        amount: 250,
        bucketIds: ["bucket_1"],
        idempotencyKey: "refund_a",
        now: NOW,
      }),
      reverseSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_1",
        amount: 250,
        bucketIds: ["bucket_1"],
        idempotencyKey: "refund_b",
        now: NOW,
      }),
    ])

    const reversed = results.reduce((sum, result) => sum + result.actualReversed, 0)
    expect(reversed).toBe(500)
    expect(user.subscriptionCredits).toBe(0)
    expect(user.credits).toBe(100)
    expect(user.creditBuckets).toHaveLength(0)
    expect(h.state.ledger).toHaveLength(2)
  })

  it("stays consistent when reversal and consumption race", async () => {
    const user = h.state.users[0]
    await Promise.all([
      consumeCredits({
        userId: "u1",
        amount: 300,
        transactionType: "build_reservation",
        idempotencyKey: "consume_race",
      }),
      reverseSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_1",
        amount: 500,
        bucketIds: ["bucket_1"],
        idempotencyKey: "refund_race",
        now: NOW,
      }),
    ])

    expect(user.subscriptionCredits).toBeGreaterThanOrEqual(0)
    expect(user.permanentCredits).toBe(100)
    expect(user.credits).toBe(user.subscriptionCredits + user.permanentCredits)
    const bucketSum = user.creditBuckets.reduce((sum, bucket) => sum + bucket.amount, 0)
    expect(bucketSum).toBe(user.subscriptionCredits)
    const debits = h.state.ledger
      .filter((entry) => entry.direction === "debit")
      .reduce((sum, entry) => sum + entry.amount, 0)
    expect(debits).toBe(500)
  })

  it("stays consistent when reversal and expiry race", async () => {
    const user = h.state.users[0]
    user.creditBuckets[0].expiresAt = NOW - 1
    await Promise.all([
      expireOverdueBuckets({ userId: "u1", now: NOW }),
      reverseSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_1",
        amount: 500,
        bucketIds: ["bucket_1"],
        idempotencyKey: "refund_expiry_race",
        now: NOW,
      }),
    ])

    expect(user.subscriptionCredits).toBeGreaterThanOrEqual(0)
    expect(user.credits).toBe(user.subscriptionCredits + user.permanentCredits)
    const bucketSum = user.creditBuckets.reduce((sum, bucket) => sum + bucket.amount, 0)
    expect(bucketSum).toBe(user.subscriptionCredits)
    const debits = h.state.ledger
      .filter((entry) => entry.direction === "debit")
      .reduce((sum, entry) => sum + entry.amount, 0)
    expect(debits).toBe(500)
  })

  it("rolls back when the ledger write fails and succeeds on a clean retry", async () => {
    h.state.failLedgerKeys.add("refund_retry")
    await expect(
      reverseSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_1",
        amount: 200,
        bucketIds: ["bucket_1"],
        idempotencyKey: "refund_retry",
        now: NOW,
      }),
    ).rejects.toThrow("simulated ledger failure")

    expect(h.state.users[0].subscriptionCredits).toBe(500)
    expect(h.state.users[0].creditBuckets[0].amount).toBe(500)
    expect(h.state.ledger).toHaveLength(0)

    h.state.failLedgerKeys.clear()
    const retry = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 200,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_retry",
      now: NOW,
    })
    expect(retry.success).toBe(true)
    expect(h.state.users[0].subscriptionCredits).toBe(300)
    expect(h.state.ledger).toHaveLength(1)
  })

  it("rolls back when a bucket write fails and succeeds on a clean retry", async () => {
    h.state.failBucketUpdate = true
    await expect(
      reverseSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_1",
        amount: 200,
        bucketIds: ["bucket_1"],
        idempotencyKey: "refund_bucket_retry",
        now: NOW,
      }),
    ).rejects.toThrow("simulated bucket update failure")

    expect(h.state.users[0].subscriptionCredits).toBe(500)
    expect(h.state.users[0].creditBuckets[0].amount).toBe(500)
    expect(h.state.ledger).toHaveLength(0)

    h.state.failBucketUpdate = false
    const retry = await reverseSubscriptionCredits({
      userId: "u1",
      subscriptionId: "sub_1",
      amount: 200,
      bucketIds: ["bucket_1"],
      idempotencyKey: "refund_bucket_retry",
      now: NOW,
    })
    expect(retry.success).toBe(true)
    expect(h.state.users[0].creditBuckets[0].amount).toBe(300)
  })
})

describe("historical subscription payment reconciliation", () => {
  beforeEach(() => h.reset())

  function historicalPayment(overrides: Doc = {}): Doc {
    return payment({
      dodoPaymentId: "pay_hist",
      grantStatus: undefined,
      creditsGranted: undefined,
      creditsAllocated: undefined,
      paidPeriodStart: undefined,
      paidPeriodEnd: undefined,
      ...overrides,
    })
  }

  it("dry-run reports a link without writing", async () => {
    h.state.payments.push(historicalPayment())
    h.state.ledger.push(grant({ idempotencyKey: "hist_grant_1" }))

    const report = await reconcileSubscriptionPayments({ mode: "dry-run", now: NOW })

    expect(report.linked).toBe(1)
    expect(h.state.payments[0].grantStatus).toBeUndefined()
    expect(h.state.payments[0].creditsGranted).toBeUndefined()
    expect(h.state.ledger[0].paymentId).toBeUndefined()
  })

  it("apply links exactly one real grant and is idempotent", async () => {
    h.state.payments.push(historicalPayment())
    h.state.ledger.push(grant({ idempotencyKey: "hist_grant_1" }))
    h.state.subs.push({
      dodoSubscriptionId: "sub_1",
      userId: "u1",
      purchasedTerms: { monthlyCredits: 500, planId: "growth" },
    })

    const first = await reconcileSubscriptionPayments({ mode: "apply", now: NOW })
    expect(first.linked).toBe(1)
    expect(h.state.payments[0]).toMatchObject({
      creditsGranted: 500,
      creditsAllocated: 500,
      grantStatus: "granted",
      grantLinkMethod: "ledger_reference",
      grantLedgerEntryIds: ["ledger_grant_1"],
      grantBucketIds: ["bucket_1"],
    })
    expect(h.state.ledger[0].paymentId).toBe("pay_hist")

    const second = await reconcileSubscriptionPayments({ mode: "apply", now: NOW })
    expect(second.linked).toBe(0)
    expect(second.skipped).toBe(1)
    expect(h.state.payments[0].creditsGranted).toBe(500)
  })

  it("marks a payment with no matching grant for review", async () => {
    h.state.payments.push(historicalPayment())

    const report = await reconcileSubscriptionPayments({ mode: "apply", now: NOW })

    expect(report.needsReview).toBe(1)
    expect(h.state.payments[0]).toMatchObject({
      grantStatus: "needs_review",
      grantLinkMethod: "manual_review",
      refundReviewReason: "no_matching_grant",
    })
    expect(h.state.payments[0].creditsGranted).toBeUndefined()
  })

  it("marks ambiguous grants for review instead of picking one", async () => {
    h.state.payments.push(historicalPayment())
    h.state.ledger.push(grant({ id: "ledger_a", idempotencyKey: "hist_a" }))
    h.state.ledger.push(grant({ id: "ledger_b", idempotencyKey: "hist_b" }))

    const report = await reconcileSubscriptionPayments({ mode: "apply", now: NOW })

    expect(report.needsReview).toBe(1)
    expect(h.state.payments[0].refundReviewReason).toBe("ambiguous_matching_grant")
  })

  it("marks an amount without a ledger reference for review", async () => {
    h.state.payments.push(historicalPayment({ creditsGranted: 500 }))

    const report = await reconcileSubscriptionPayments({ mode: "apply", now: NOW })

    expect(report.needsReview).toBe(1)
    expect(h.state.payments[0]).toMatchObject({
      creditsGranted: 500,
      grantStatus: "needs_review",
      refundReviewReason: "grant_reference_missing",
    })
  })

  it("never links a grant whose period belongs to another billing period", async () => {
    h.state.payments.push(historicalPayment())
    h.state.ledger.push(
      grant({
        id: "ledger_next_period",
        idempotencyKey: "hist_next_period",
        metadata: {
          periodStart: NOW + MONTH,
          periodEnd: NOW + 2 * MONTH,
          bucketId: "bucket_next",
        },
      }),
    )

    const report = await reconcileSubscriptionPayments({ mode: "apply", now: NOW })

    expect(report.needsReview).toBe(1)
    expect(report.details[0]).toMatchObject({
      action: "review",
      reason: "no_matching_grant",
    })
    expect(h.state.payments[0].creditsGranted).toBeUndefined()
    expect(h.state.ledger[0].paymentId).toBeUndefined()
  })

  it("respects a known paid period when selecting a historical grant", async () => {
    h.state.payments.push(
      historicalPayment({
        paidPeriodStart: NOW,
        paidPeriodEnd: NOW + MONTH,
      }),
    )
    h.state.ledger.push(
      grant({
        id: "ledger_next_period",
        idempotencyKey: "hist_next_period",
        metadata: {
          periodStart: NOW + MONTH,
          periodEnd: NOW + 2 * MONTH,
          bucketId: "bucket_next",
        },
      }),
    )

    const report = await reconcileSubscriptionPayments({ mode: "apply", now: NOW })

    expect(report.needsReview).toBe(1)
    expect(h.state.payments[0].creditsGranted).toBeUndefined()
    expect(h.state.ledger[0].paymentId).toBeUndefined()
  })
})

describe("Phase A4 — subscription grant transaction", () => {
  const GRANT_SUB = "sub_grant"
  const grantParams = (overrides: Doc = {}) => ({
    userId: "u1",
    amount: 100,
    subscriptionId: GRANT_SUB,
    planId: "growth",
    periodStart: Date.now(),
    periodEnd: Date.now() + MONTH,
    ...overrides,
  })

  function seedGrantUser(overrides: Doc = {}) {
    const user = {
      id: "u1",
      credits: 0,
      subscriptionCredits: 0,
      permanentCredits: 0,
      creditBuckets: [] as Doc[],
      ...overrides,
    }
    h.state.users.push(user)
    return user
  }

  function ledgerGrants() {
    return h.state.ledger.filter((entry) => entry.transactionType === "subscription_grant")
  }

  beforeEach(() => h.reset())

  it("grants onto an existing balance and records the applied before/after", async () => {
    const user = seedGrantUser({
      credits: 700,
      subscriptionCredits: 500,
      permanentCredits: 200,
      creditBuckets: [
        {
          bucketId: "bucket_existing",
          subscriptionId: "sub_existing",
          planId: "growth",
          amount: 500,
          originalAmount: 500,
          expiresAt: Date.now() + MONTH,
          createdAt: NOW,
        },
      ],
    })

    const ok = await grantSubscriptionCredits(grantParams())

    expect(ok).toBe(true)
    expect(user).toMatchObject({ credits: 800, subscriptionCredits: 600, permanentCredits: 200 })
    expect(user.creditBuckets).toHaveLength(2)
    const entries = ledgerGrants()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      amount: 100,
      balanceBefore: 500,
      balanceAfter: 600,
      metadata: { totalBalanceBefore: 700, totalBalanceAfter: 800 },
    })
    const newBucketId = entries[0].metadata.bucketId
    expect(user.creditBuckets.find((b: Doc) => b.bucketId === newBucketId)).toMatchObject({
      subscriptionId: GRANT_SUB,
      amount: 100,
      originalAmount: 100,
      expiresAt: entries[0].metadata.periodEnd,
    })
  })

  it("grants to an account with no previous balance", async () => {
    const user = seedGrantUser()

    const ok = await grantSubscriptionCredits(grantParams({ amount: 300 }))

    expect(ok).toBe(true)
    expect(user).toMatchObject({ credits: 300, subscriptionCredits: 300, permanentCredits: 0 })
    expect(user.creditBuckets).toHaveLength(1)
    expect(ledgerGrants()[0]).toMatchObject({ balanceBefore: 0, balanceAfter: 300 })
  })

  it("grants a duplicate period once when two calls race", async () => {
    const user = seedGrantUser()

    const [first, second] = await Promise.all([
      grantSubscriptionCredits(grantParams()),
      grantSubscriptionCredits(grantParams()),
    ])

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(user).toMatchObject({ credits: 100, subscriptionCredits: 100 })
    expect(user.creditBuckets).toHaveLength(1)
    expect(ledgerGrants()).toHaveLength(1)
  })

  it("applies two different concurrent grants with accurate snapshots", async () => {
    const user = seedGrantUser()

    await Promise.all([
      grantSubscriptionCredits(
        grantParams({ subscriptionId: "sub_a", periodEnd: Date.now() + MONTH }),
      ),
      grantSubscriptionCredits(
        grantParams({ subscriptionId: "sub_b", periodEnd: Date.now() + 2 * MONTH }),
      ),
    ])

    expect(user).toMatchObject({ credits: 200, subscriptionCredits: 200 })
    expect(user.creditBuckets).toHaveLength(2)
    const entries = ledgerGrants().sort((a, b) => a.balanceBefore - b.balanceBefore)
    expect(entries.map((entry) => [entry.balanceBefore, entry.balanceAfter])).toEqual([
      [0, 100],
      [100, 200],
    ])
  })

  it("keeps grant and consumption consistent when they race", async () => {
    const user = seedGrantUser({
      credits: 500,
      subscriptionCredits: 500,
      creditBuckets: [
        {
          bucketId: "bucket_old",
          subscriptionId: "sub_old",
          planId: "growth",
          amount: 500,
          originalAmount: 500,
          expiresAt: Date.now() + MONTH,
          createdAt: NOW,
        },
      ],
    })

    await Promise.all([
      grantSubscriptionCredits(grantParams({ subscriptionId: "sub_new", periodEnd: Date.now() + 2 * MONTH })),
      consumeCredits({
        userId: "u1",
        amount: 200,
        transactionType: "build_consumption",
        idempotencyKey: "consume_during_grant",
      }),
    ])

    const bucketSum = user.creditBuckets.reduce((sum: number, b: Doc) => sum + b.amount, 0)
    expect(user.subscriptionCredits).toBe(400)
    expect(user.credits).toBe(400)
    expect(bucketSum).toBe(400)
    expect(ledgerGrants()[0].balanceAfter - ledgerGrants()[0].balanceBefore).toBe(100)
  })

  it("keeps grant and reversal consistent when they race", async () => {
    const user = seedGrantUser({
      credits: 600,
      subscriptionCredits: 500,
      permanentCredits: 100,
      creditBuckets: [
        {
          bucketId: "bucket_old",
          subscriptionId: "sub_old",
          planId: "growth",
          amount: 500,
          originalAmount: 500,
          expiresAt: Date.now() + MONTH,
          createdAt: NOW,
        },
      ],
    })

    await Promise.all([
      grantSubscriptionCredits(grantParams({ subscriptionId: "sub_new", periodEnd: Date.now() + 2 * MONTH })),
      reverseSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_old",
        amount: 200,
        bucketIds: ["bucket_old"],
        idempotencyKey: "reverse_during_grant",
        now: Date.now(),
      }),
    ])

    const bucketSum = user.creditBuckets.reduce((sum: number, b: Doc) => sum + b.amount, 0)
    expect(user.subscriptionCredits).toBe(400)
    expect(user.credits).toBe(500)
    expect(user.permanentCredits).toBe(100)
    expect(bucketSum).toBe(400)
    expect(ledgerGrants()[0].balanceAfter - ledgerGrants()[0].balanceBefore).toBe(100)
  })

  it("keeps grant and expiration consistent when they race", async () => {
    const user = seedGrantUser({
      credits: 500,
      subscriptionCredits: 500,
      creditBuckets: [
        {
          bucketId: "bucket_expired",
          subscriptionId: "sub_old",
          planId: "growth",
          amount: 500,
          originalAmount: 500,
          expiresAt: Date.now() - 1,
          createdAt: NOW - MONTH,
        },
      ],
    })

    await Promise.all([
      grantSubscriptionCredits(grantParams({ subscriptionId: "sub_new", periodEnd: Date.now() + 2 * MONTH })),
      expireOverdueBuckets({ userId: "u1", now: Date.now() }),
    ])

    const bucketSum = user.creditBuckets.reduce((sum: number, b: Doc) => sum + b.amount, 0)
    expect(user.subscriptionCredits).toBe(100)
    expect(user.credits).toBe(100)
    expect(bucketSum).toBe(100)
    expect(user.creditBuckets).toHaveLength(1)
  })

  it("does not expire a new-period bucket when renewal expiry races a grant", async () => {
    const now = Date.now()
    const user = seedGrantUser({
      credits: 500,
      subscriptionCredits: 500,
      creditBuckets: [
        {
          bucketId: "bucket_old_period",
          subscriptionId: "sub_old",
          planId: "growth",
          amount: 500,
          originalAmount: 500,
          expiresAt: now - 1,
          createdAt: now - MONTH,
        },
      ],
    })

    await Promise.all([
      grantSubscriptionCredits(
        grantParams({
          subscriptionId: "sub_new",
          periodStart: now,
          periodEnd: now + MONTH,
        }),
      ),
      expireSubscriptionCredits({
        userId: "u1",
        subscriptionId: "sub_old",
        periodStart: now,
        expiresAtOrBefore: now,
      }),
    ])

    const bucketSum = user.creditBuckets.reduce((sum: number, b: Doc) => sum + b.amount, 0)
    expect(user.subscriptionCredits).toBe(100)
    expect(user.credits).toBe(100)
    expect(bucketSum).toBe(100)
    expect(user.creditBuckets).toHaveLength(1)
    expect(user.creditBuckets[0]).toMatchObject({ subscriptionId: "sub_new", amount: 100 })
  })

  it("replays a duplicate annual allocation without a second bucket", async () => {
    const user = seedGrantUser()

    expect(await grantSubscriptionCredits(grantParams({ amount: 250 }))).toBe(true)
    expect(await grantSubscriptionCredits(grantParams({ amount: 250 }))).toBe(true)

    expect(user).toMatchObject({ credits: 250, subscriptionCredits: 250 })
    expect(user.creditBuckets).toHaveLength(1)
    expect(ledgerGrants()).toHaveLength(1)
  })

  it("rolls back the aggregate when bucket creation fails", async () => {
    seedGrantUser({ credits: 50, subscriptionCredits: 50 })
    h.state.failBucketPush = true

    await expect(grantSubscriptionCredits(grantParams())).rejects.toThrow(/bucket creation/i)

    const restored = h.state.users[0]
    expect(restored).toMatchObject({ credits: 50, subscriptionCredits: 50 })
    expect(restored.creditBuckets).toHaveLength(0)
    expect(ledgerGrants()).toHaveLength(0)
  })

  it("rolls back the aggregate and bucket when ledger insertion fails", async () => {
    seedGrantUser({ credits: 50, subscriptionCredits: 50 })
    const attempt = grantParams()
    h.state.failLedgerKeys.add(
      `sub_grant_${GRANT_SUB}_period_${Math.floor(attempt.periodEnd / 86400000)}`,
    )

    await expect(grantSubscriptionCredits(attempt)).rejects.toThrow(/ledger failure/i)

    const restored = h.state.users[0]
    expect(restored).toMatchObject({ credits: 50, subscriptionCredits: 50 })
    expect(restored.creditBuckets).toHaveLength(0)
    expect(ledgerGrants()).toHaveLength(0)
  })

  it("retries a transient transaction failure without duplicating the grant", async () => {
    const user = seedGrantUser()
    h.state.failNextTransaction = true

    const ok = await grantSubscriptionCredits(grantParams())

    expect(ok).toBe(true)
    expect(user).toMatchObject({ credits: 100, subscriptionCredits: 100 })
    expect(user.creditBuckets).toHaveLength(1)
    expect(ledgerGrants()).toHaveLength(1)
  })
})
