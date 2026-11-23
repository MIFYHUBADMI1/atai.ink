import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Phase A2 / M-14 — refunds reverse the credits the ORIGINAL PAYMENT granted,
 * from that grant's own buckets, and never touch permanent credits.
 *
 * The handler runs for real; the credit ledger is the in-memory authority.
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
    failPaymentUpdateOnce: boolean
    failLedgerKeys: Set<string>
  } = {
    payments: [],
    ledger: [],
    subs: [],
    users: [],
    failPaymentUpdateOnce: false,
    failLedgerKeys: new Set(),
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

  function col(rows: () => Doc[]) {
    return {
      async findOne(filter: Doc) {
        return rows().find((r) => matches(r, filter)) ?? null
      },
      find(filter: Doc = {}) {
        return cursor(rows().filter((r) => matches(r, filter)))
      },
      async updateOne(filter: Doc, update: Doc) {
        if (state.failPaymentUpdateOnce && filter.dodoPaymentId === "pay_1") {
          state.failPaymentUpdateOnce = false
          throw new Error("simulated payment-record persistence failure")
        }
        const doc = rows().find((r) => matches(r, filter))
        if (!doc) return { matchedCount: 0, modifiedCount: 0 }
        applyUpdate(doc, update)
        return { matchedCount: 1, modifiedCount: 1 }
      },
      async insertOne(doc: Doc) {
        if (doc.idempotencyKey && state.failLedgerKeys.has(doc.idempotencyKey)) {
          state.failLedgerKeys.delete(doc.idempotencyKey)
          throw new Error("simulated ledger failure")
        }
        if (
          doc.dodoPaymentId &&
          rows().some((row) => row.dodoPaymentId === doc.dodoPaymentId)
        ) {
          const err = new Error("E11000 duplicate key error") as Error & { code?: number }
          err.code = 11000
          throw err
        }
        rows().push(doc)
        return { acknowledged: true }
      },
    }
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
        const delta = update.$inc["creditBuckets.$.amount"] as number
        const bucket = (user.creditBuckets ?? []).find((b: Doc) => matches(b, bucketFilter))
        if (!bucket) return { matchedCount: 0, modifiedCount: 0 }
        bucket.amount += delta
      }
      applyUpdate(user, update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }

  const recordLedgerEntry = vi.fn(async (p: Doc) => {
    if (state.failLedgerKeys.has(p.idempotencyKey)) {
      state.failLedgerKeys.delete(p.idempotencyKey)
      throw new Error("simulated ledger failure")
    }
    if (state.ledger.some((entry) => entry.idempotencyKey === p.idempotencyKey)) {
      const err = new Error("E11000 duplicate key error") as Error & { code?: number }
      err.code = 11000
      throw err
    }
    const { session: _session, ...fields } = p
    const entry = { id: `ledger_${state.ledger.length + 1}`, createdAt: Date.now(), ...fields }
    state.ledger.push(entry)
    return entry
  })

  return {
    state,
    paymentsCol: col(() => state.payments),
    ledgerCol: col(() => state.ledger),
    subsCol: col(() => state.subs),
    usersCol,
    recordLedgerEntry,
    reset() {
      state.payments = []
      state.ledger = []
      state.subs = []
      state.users = []
      state.failPaymentUpdateOnce = false
      state.failLedgerKeys.clear()
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

vi.mock("@/lib/db/mongodb", () => {
  let transactionQueue: Promise<unknown> = Promise.resolve()
  return {
    getMongoClient: vi.fn(async () => ({
      startSession: () => ({
        inTransaction: () => true,
        withTransaction(fn: () => Promise<void>) {
          const run = transactionQueue.then(async () => {
            const snapshot = {
              payments: structuredClone(h.state.payments),
              ledger: structuredClone(h.state.ledger),
              users: structuredClone(h.state.users),
            }
            try {
              return await fn()
            } catch (err) {
              h.state.payments = snapshot.payments
              h.state.ledger = snapshot.ledger
              h.state.users = snapshot.users
              throw err
            }
          })
          transactionQueue = run.then(
            () => undefined,
            () => undefined,
          )
          return run
        },
        endSession: vi.fn(async () => {}),
      }),
    })),
  }
})

vi.mock("@/lib/billing/credit-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/credit-service")>()
  return {
    ...actual,
    grantCredits: vi.fn(async () => ({ success: true })),
    grantSubscriptionCredits: vi.fn(async () => true),
    expireSubscriptionCredits: vi.fn(async () => undefined),
    recordLedgerEntry: h.recordLedgerEntry,
  }
})

vi.mock("@/lib/billing/activate-subscription", () => ({
  activatePaidSubscription: vi.fn(async () => undefined),
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { processDodoEvent } from "./dodo-event-processing"
import { annualPaymentSucceeded } from "./entitlements/annual-scheduler"
import type { SubscriptionRecord } from "./billing-types"

const NOW = Date.now()
const MONTH = 30 * 86_400_000

function seedPayment(overrides: Doc = {}): Doc {
  const row = {
    id: "pay_row_1",
    userId: "u1",
    dodoPaymentId: "pay_1",
    subscriptionId: "sub_1",
    paymentType: "subscription",
    creditType: "subscription",
    status: "succeeded",
    amount: 12000,
    currency: "USD",
    creditsGranted: 500,
    creditsAllocated: 500,
    grantStatus: "granted",
    grantLedgerEntryIds: ["ledger_grant_1"],
    grantBucketIds: ["bucket_1"],
    paidPeriodStart: NOW,
    paidPeriodEnd: NOW + MONTH,
    providerCreatedAt: NOW,
    createdAt: NOW,
    ...overrides,
  }
  h.state.payments.push(row)
  return row
}

function seedUser(amount = 500): Doc {
  const user = {
    id: "u1",
    credits: amount,
    subscriptionCredits: amount,
    permanentCredits: 0,
    creditBuckets: [
      {
        bucketId: "bucket_1",
        subscriptionId: "sub_1",
        planId: "growth",
        amount,
        originalAmount: 500,
        expiresAt: NOW + MONTH,
        createdAt: NOW,
      },
    ],
  }
  h.state.users.push(user)
  return user
}

describe("refund.succeeded — subscription attribution", () => {
  beforeEach(() => h.reset())

  it("reverses the exact grant and leaves permanent credits alone", async () => {
    seedPayment()
    const user = seedUser(500)
    user.permanentCredits = 77
    user.credits = 577

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_1", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_1",
    )

    expect(outcome.status).toBe("processed")
    expect(user.subscriptionCredits).toBe(0)
    expect(user.permanentCredits).toBe(77)
    expect(user.credits).toBe(77)
    expect(user.creditBuckets).toEqual([])
    expect(h.state.ledger).toHaveLength(1)
    expect(h.state.ledger[0]).toMatchObject({
      amount: 500,
      direction: "debit",
      transactionType: "refund_reversal",
      idempotencyKey: "refund_rf_1",
    })

    const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(original).toMatchObject({
      status: "refunded",
      creditsReversed: 500,
      reversalStatus: "reversed",
      refundedAmountMinor: 12000,
    })
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_1")!
    expect(refund).toMatchObject({
      paymentType: "refund",
      originalPaymentId: "pay_1",
      creditsGranted: -500,
      creditsReversed: 500,
      reversalStatus: "reversed",
    })
  })

  it("a partial refund reverses only the proportional share", async () => {
    seedPayment()
    const user = seedUser(500)

    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_partial", payment_id: "pay_1", amount: 3000, currency: "USD" },
      "evt_refund_partial",
    )

    expect(user.subscriptionCredits).toBe(375)
    expect(user.creditBuckets[0].amount).toBe(375)
    const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(original).toMatchObject({
      status: "partially_refunded",
      creditsReversed: 125,
      reversalStatus: "partially_reversed",
      refundedAmountMinor: 3000,
    })
  })

  it("replays a refund idempotently", async () => {
    seedPayment()
    seedUser(500)

    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_1", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_1",
    )
    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_1", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_1",
    )

    expect(h.state.users[0].subscriptionCredits).toBe(0)
    expect(h.state.ledger).toHaveLength(1)
    expect(h.state.payments.filter((p) => p.dodoPaymentId === "rf_1")).toHaveLength(1)
  })

  it("two simultaneous identical refund events reverse the grant once", async () => {
    seedPayment()
    seedUser(500)

    const payload = { refund_id: "rf_race", payment_id: "pay_1", amount: 12000, currency: "USD" }
    const results = await Promise.allSettled([
      processDodoEvent("refund.succeeded", payload, "evt_race_a"),
      processDodoEvent("refund.succeeded", payload, "evt_race_b"),
    ])

    expect(results.every((r) => r.status === "fulfilled")).toBe(true)

    // A later retry must stay a no-op.
    const retry = await processDodoEvent("refund.succeeded", payload, "evt_race_b")
    expect(retry.status).toBe("processed")

    expect(h.state.users[0].subscriptionCredits).toBe(0)
    expect(h.state.users[0].credits).toBe(0)
    expect(h.state.ledger).toHaveLength(1)
    expect(h.state.payments.filter((p) => p.dodoPaymentId === "rf_race")).toHaveLength(1)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!.creditsReversed).toBe(500)
  })

  it("two simultaneous partial refunds together never exceed the grant", async () => {
    seedPayment()
    seedUser(500)

    const results = await Promise.allSettled([
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_race_a", payment_id: "pay_1", amount: 3000, currency: "USD" },
        "evt_race_a",
      ),
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_race_b", payment_id: "pay_1", amount: 3000, currency: "USD" },
        "evt_race_b",
      ),
    ])

    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    expect(h.state.users[0].subscriptionCredits).toBe(250)
    expect(h.state.ledger).toHaveLength(2)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!.creditsReversed).toBe(250)
  })

  it("two simultaneous halves complete the refund exactly once", async () => {
    seedPayment()
    seedUser(500)

    const results = await Promise.allSettled([
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_half_a", payment_id: "pay_1", amount: 6000, currency: "USD" },
        "evt_half_a",
      ),
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_half_b", payment_id: "pay_1", amount: 6000, currency: "USD" },
        "evt_half_b",
      ),
    ])

    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    expect(h.state.users[0].subscriptionCredits).toBe(0)
    expect(h.state.ledger).toHaveLength(2)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")).toMatchObject({
      status: "refunded",
      creditsReversed: 500,
      refundedAmountMinor: 12000,
    })
  })

  it("rolls back the balance when the ledger write fails, then retries cleanly", async () => {
    seedPayment()
    seedUser(500)
    h.state.failLedgerKeys.add("refund_rf_retry")

    await expect(
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_retry", payment_id: "pay_1", amount: 12000, currency: "USD" },
        "evt_refund_retry",
      ),
    ).rejects.toThrow("simulated ledger failure")

    expect(h.state.users[0].subscriptionCredits).toBe(500)
    expect(h.state.ledger).toHaveLength(0)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "rf_retry")).toBeUndefined()

    const retry = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_retry", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_retry",
    )

    expect(retry.status).toBe("processed")
    expect(h.state.users[0].subscriptionCredits).toBe(0)
    expect(h.state.ledger).toHaveLength(1)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "rf_retry")).toMatchObject({
      reversalStatus: "reversed",
      creditsReversed: 500,
    })
  })

  it("rolls back the reversal when the payment record write fails, then retries cleanly", async () => {
    seedPayment()
    seedUser(500)
    h.state.failPaymentUpdateOnce = true

    await expect(
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_retry_pay", payment_id: "pay_1", amount: 12000, currency: "USD" },
        "evt_refund_retry_pay",
      ),
    ).rejects.toThrow("simulated payment-record persistence failure")

    // The reversal and refund row are in the same transaction as the payment
    // progress update, so the failed write rolls all of them back.
    expect(h.state.users[0].subscriptionCredits).toBe(500)
    expect(h.state.ledger).toHaveLength(0)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "rf_retry_pay")).toBeUndefined()
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")).toMatchObject({
      status: "succeeded",
    })
    expect(
      h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!.creditsReversed,
    ).toBeUndefined()

    const retry = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_retry_pay", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_retry_pay",
    )

    expect(retry.status).toBe("processed")
    expect(h.state.users[0].subscriptionCredits).toBe(0)
    expect(h.state.ledger).toHaveLength(1)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "rf_retry_pay")).toMatchObject({
      reversalStatus: "reversed",
      creditsReversed: 500,
    })
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")).toMatchObject({
      status: "refunded",
      creditsReversed: 500,
      refundedAmountMinor: 12000,
    })
  })

  it("does not invent a grant when the historical payment has none", async () => {
    seedPayment({ creditsGranted: undefined, grantStatus: "needs_review", grantBucketIds: undefined, grantLedgerEntryIds: undefined })
    const user = seedUser(500)

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_unknown", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_unknown",
    )

    expect(outcome.status).toBe("unresolved")
    expect(user.subscriptionCredits).toBe(500)
    expect(h.state.ledger).toHaveLength(0)
    const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(original).toMatchObject({ status: "refunded", reversalStatus: "unresolved" })
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_unknown")!
    expect(refund).toMatchObject({
      reversalStatus: "unresolved",
      refundReviewReason: "historical_grant_unknown",
    })
  })

  it("does not guess a bucket when the grant has only a ledger reference", async () => {
    seedPayment({ grantBucketIds: undefined, grantLedgerEntryIds: ["ledger_grant_1"] })
    const user = seedUser(500)

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_no_bucket", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_no_bucket",
    )

    expect(outcome.status).toBe("unresolved")
    expect(user.subscriptionCredits).toBe(500)
    expect(h.state.ledger).toHaveLength(0)
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_no_bucket")!
    expect(refund).toMatchObject({
      reversalStatus: "unresolved",
      refundReviewReason: "grant_bucket_unresolved",
    })
  })

  it("rejects a refund larger than the original payment instead of reversing more", async () => {
    seedPayment({ amount: 1000 })
    const user = seedUser(500)

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_over", payment_id: "pay_1", amount: 5000, currency: "USD" },
      "evt_refund_over",
    )

    expect(outcome.status).toBe("unresolved")
    expect(outcome.reason).toContain("exceeds the original payment")
    expect(user.subscriptionCredits).toBe(500)
    expect(h.state.ledger).toHaveLength(0)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "rf_over")).toBeUndefined()
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")).toMatchObject({
      status: "succeeded",
    })
  })

  it("two partial refunds cannot exceed the original grant", async () => {
    seedPayment()
    seedUser(500)

    for (const [i, amount] of [3000, 3000].entries()) {
      await processDodoEvent(
        "refund.succeeded",
        { refund_id: `rf_${i}`, payment_id: "pay_1", amount, currency: "USD" },
        `evt_refund_${i}`,
      )
    }

    const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(original.creditsReversed).toBe(250)
    expect(h.state.users[0].subscriptionCredits).toBe(250)
  })

  it("20/30/50 partial refunds reverse exactly the original grant regardless of order", async () => {
    async function runSequence(amounts: number[]) {
      h.reset()
      seedPayment({ amount: 12000, creditsGranted: 100_000, creditsAllocated: 100_000 })
      const user = seedUser(100_000)
      user.creditBuckets[0].originalAmount = 100_000

      for (const [i, amount] of amounts.entries()) {
        await processDodoEvent(
          "refund.succeeded",
          { refund_id: `rf_${i}`, payment_id: "pay_1", amount, currency: "USD" },
          `evt_refund_${i}`,
        )
      }

      const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
      return {
        credits: user.credits,
        subscriptionCredits: user.subscriptionCredits,
        buckets: user.creditBuckets,
        original,
        refunds: h.state.payments.filter((p) => p.paymentType === "refund"),
      }
    }

    const forward = await runSequence([2400, 3600, 6000])
    const reverse = await runSequence([6000, 3600, 2400])

    for (const result of [forward, reverse]) {
      expect(result.credits).toBe(0)
      expect(result.subscriptionCredits).toBe(0)
      expect(result.buckets).toEqual([])
      expect(result.original.creditsReversed).toBe(100_000)
      expect(result.original.refundedAmountMinor).toBe(12000)
      expect(result.original.status).toBe("refunded")
      expect(result.refunds).toHaveLength(3)
      expect(result.refunds.reduce((sum: number, r: Doc) => sum + (r.creditsReversed ?? 0), 0)).toBe(
        100_000,
      )
    }
  })

  it("consumed credits: a 50% refund reverses only the remaining 20k and records the 30k shortfall", async () => {
    seedPayment({ amount: 12000, creditsGranted: 100_000, creditsAllocated: 100_000 })
    const user = seedUser(20_000)
    user.creditBuckets[0].originalAmount = 100_000
    user.permanentCredits = 10_000
    user.credits = 80_000
    user.subscriptionCredits = 70_000
    user.creditBuckets.push({
      bucketId: "bucket_other",
      subscriptionId: "sub_other",
      planId: "starter",
      amount: 50_000,
      originalAmount: 50_000,
      expiresAt: NOW + MONTH,
      createdAt: NOW,
    })

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_consumed", payment_id: "pay_1", amount: 6000, currency: "USD" },
      "evt_refund_consumed",
    )

    expect(outcome.status).toBe("processed")
    expect(user.permanentCredits).toBe(10_000)
    expect(user.subscriptionCredits).toBe(50_000)
    expect(user.credits).toBe(60_000)
    expect(user.creditBuckets).toHaveLength(1)
    expect(user.creditBuckets[0].bucketId).toBe("bucket_other")
    expect(user.creditBuckets[0].amount).toBe(50_000)

    const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(original).toMatchObject({
      status: "partially_refunded",
      creditsReversed: 20_000,
      creditsReversalShortfall: 30_000,
      reversalStatus: "partially_reversed",
      refundReviewReason: "grant_partially_consumed",
      refundedAmountMinor: 6000,
    })
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_consumed")!
    expect(refund).toMatchObject({
      creditsReversed: 20_000,
      creditsReversalShortfall: 30_000,
      reversalStatus: "partially_reversed",
      refundReviewReason: "grant_partially_consumed",
    })
  })

  it("cumulative monetary refunds cannot exceed the original payment", async () => {
    seedPayment({ amount: 12000, creditsGranted: 100_000, creditsAllocated: 100_000 })
    const user = seedUser(100_000)
    user.creditBuckets[0].originalAmount = 100_000

    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_half_1", payment_id: "pay_1", amount: 6000, currency: "USD" },
      "evt_half_1",
    )
    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_half_2", payment_id: "pay_1", amount: 6000, currency: "USD" },
      "evt_half_2",
    )

    const afterFull = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(afterFull.status).toBe("refunded")
    expect(afterFull.refundedAmountMinor).toBe(12000)
    expect(afterFull.creditsReversed).toBe(100_000)
    expect(user.credits).toBe(0)

    const over = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_half_3", payment_id: "pay_1", amount: 1, currency: "USD" },
      "evt_half_3",
    )

    expect(over.status).toBe("unresolved")
    expect(over.reason).toContain("exceeds the original payment")
    expect(h.state.payments.find((p) => p.dodoPaymentId === "rf_half_3")).toBeUndefined()
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!.refundedAmountMinor).toBe(12000)
    expect(user.credits).toBe(0)
  })

  it("concurrent partial refunds cannot exceed the original payment", async () => {
    seedPayment({ amount: 12000, creditsGranted: 100_000, creditsAllocated: 100_000 })
    const user = seedUser(100_000)
    user.creditBuckets[0].originalAmount = 100_000

    const results = await Promise.all([
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_over_a", payment_id: "pay_1", amount: 8000, currency: "USD" },
        "evt_over_a",
      ),
      processDodoEvent(
        "refund.succeeded",
        { refund_id: "rf_over_b", payment_id: "pay_1", amount: 8000, currency: "USD" },
        "evt_over_b",
      ),
    ])

    expect(results.map((r) => r.status).sort()).toEqual(["processed", "unresolved"])
    const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(original.refundedAmountMinor).toBe(8000)
    expect(original.status).toBe("partially_refunded")
    expect(original.creditsReversed).toBe(66_666)
    expect(user.credits).toBe(33_334)
    expect(h.state.ledger).toHaveLength(1)
  })

  it("keeps a refund unresolved until its payment arrives", async () => {
    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_early", payment_id: "pay_missing", amount: 12000, currency: "USD" },
      "evt_refund_early",
    )

    expect(outcome.status).toBe("unresolved")
    expect(h.state.payments).toHaveLength(0)
    expect(h.state.ledger).toHaveLength(0)
  })

  it("records a refund with no amount without inventing monetary progress", async () => {
    seedPayment()
    const user = seedUser(500)

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_no_amount", payment_id: "pay_1", currency: "USD" },
      "evt_refund_no_amount",
    )

    expect(outcome.status).toBe("processed")
    expect(user.subscriptionCredits).toBe(0)
    expect(h.state.ledger).toHaveLength(1)
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_no_amount")
    expect(refund).toBeTruthy()
    expect(refund!.amount).toBeUndefined()
    const original = h.state.payments.find((p) => p.dodoPaymentId === "pay_1")!
    expect(original).toMatchObject({ status: "refunded" })
    expect(original.refundedAmountMinor).toBeUndefined()
  })

  it("records a refund with nothing left to claw back instead of failing forever", async () => {
    seedPayment()
    const user = seedUser(0)
    user.creditBuckets = []
    user.subscriptionCredits = 0
    user.credits = 0
    user.permanentCredits = 0

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_consumed", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_consumed",
    )

    expect(outcome.status).toBe("processed")
    expect(h.state.ledger).toHaveLength(0)
    expect(user.permanentCredits).toBe(0)
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_consumed")!
    expect(refund).toMatchObject({
      reversalStatus: "nothing_to_reverse",
      refundReviewReason: "grant_already_consumed_or_expired",
      creditsReversalShortfall: 500,
    })
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_1")).toMatchObject({
      creditsReversalShortfall: 500,
    })
  })

  it("links a payment that arrives after its period grant", async () => {
    h.state.subs.push({
      dodoSubscriptionId: "sub_1",
      userId: "u1",
      status: "active",
      currentPeriodStart: NOW,
      currentPeriodEnd: NOW + MONTH,
      purchasedTerms: { monthlyCredits: 500, planId: "growth" },
    })
    h.state.ledger.push({
      id: "ledger_grant_late",
      idempotencyKey: "sub_grant_sub_1_period_late",
      userId: "u1",
      amount: 500,
      direction: "credit",
      transactionType: "subscription_grant",
      referenceType: "subscription",
      referenceId: "sub_1",
      createdAt: NOW,
      metadata: { periodStart: NOW, periodEnd: NOW + MONTH, bucketId: "bucket_late" },
    })

    await processDodoEvent(
      "payment.succeeded",
      {
        payment_id: "pay_late",
        subscription_id: "sub_1",
        total_amount: 12000,
        currency: "USD",
        created_at: new Date(NOW).toISOString(),
      },
      "evt_pay_late",
    )

    const payment = h.state.payments.find((p) => p.dodoPaymentId === "pay_late")!
    expect(payment).toMatchObject({
      paymentType: "subscription",
      creditType: "subscription",
      creditsGranted: 500,
      creditsAllocated: 500,
      grantStatus: "granted",
      grantLinkMethod: "ledger_reference",
      grantLedgerEntryIds: ["ledger_grant_late"],
      grantBucketIds: ["bucket_late"],
    })
    expect(h.state.ledger[0].paymentId).toBe("pay_late")

    await processDodoEvent(
      "payment.succeeded",
      {
        payment_id: "pay_late",
        subscription_id: "sub_1",
        total_amount: 12000,
        currency: "USD",
        created_at: new Date(NOW).toISOString(),
      },
      "evt_pay_late",
    )

    expect(h.state.payments.filter((p) => p.dodoPaymentId === "pay_late")).toHaveLength(1)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_late")!.creditsGranted).toBe(500)
  })

  it("records a permanent-pack shortfall instead of failing the webhook", async () => {
    seedPayment({
      paymentType: "credit_purchase",
      creditType: "permanent",
      subscriptionId: undefined,
      creditsGranted: 500,
      creditsAllocated: 500,
      grantBucketIds: undefined,
      grantLedgerEntryIds: ["ledger_grant_perm"],
    })
    const user = seedUser(0)
    user.credits = 300
    user.subscriptionCredits = 0
    user.permanentCredits = 300
    user.creditBuckets = []

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_perm", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_perm",
    )

    expect(outcome.status).toBe("processed")
    expect(user.permanentCredits).toBe(0)
    expect(h.state.ledger).toHaveLength(1)
    expect(h.state.ledger[0]).toMatchObject({ amount: 300, direction: "debit", paymentId: "pay_1" })
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_perm")!
    expect(refund).toMatchObject({
      reversalStatus: "partially_reversed",
      creditsReversed: 300,
      creditsReversalShortfall: 200,
      refundReviewReason: "grant_partially_consumed",
    })
  })

  it("records a fully consumed permanent pack as nothing to reverse", async () => {
    seedPayment({
      paymentType: "credit_purchase",
      creditType: "permanent",
      subscriptionId: undefined,
      creditsGranted: 500,
      creditsAllocated: 500,
      grantBucketIds: undefined,
      grantLedgerEntryIds: ["ledger_grant_perm"],
    })
    const user = seedUser(0)
    user.credits = 0
    user.subscriptionCredits = 0
    user.permanentCredits = 0
    user.creditBuckets = []

    const outcome = await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_perm_empty", payment_id: "pay_1", amount: 12000, currency: "USD" },
      "evt_refund_perm_empty",
    )

    expect(outcome.status).toBe("processed")
    expect(h.state.ledger).toHaveLength(0)
    const refund = h.state.payments.find((p) => p.dodoPaymentId === "rf_perm_empty")!
    expect(refund).toMatchObject({
      reversalStatus: "nothing_to_reverse",
      creditsReversalShortfall: 500,
      refundReviewReason: "grant_already_consumed_or_expired",
    })
  })

  it("cancellation changes status only and never reverses credits", async () => {
    h.state.subs.push({
      dodoSubscriptionId: "sub_1",
      userId: "u1",
      status: "active",
      currentPeriodStart: NOW,
      currentPeriodEnd: NOW + MONTH,
      purchasedTerms: { monthlyCredits: 500, planId: "growth" },
    })
    const user = seedUser(500)

    await processDodoEvent(
      "subscription.cancelled",
      { subscription_id: "sub_1", cancelled_at: new Date(NOW).toISOString() },
      "evt_cancel",
    )

    expect(h.state.subs[0].status).toBe("cancelled")
    expect(user.subscriptionCredits).toBe(500)
    expect(user.creditBuckets).toHaveLength(1)
    expect(user.creditBuckets[0].amount).toBe(500)
    expect(h.state.ledger).toHaveLength(0)
  })

  it("a plan change re-pins terms without touching existing credit buckets", async () => {
    h.state.subs.push({
      id: "sub_row_1",
      dodoSubscriptionId: "sub_1",
      userId: "u1",
      status: "active",
      currentPeriodStart: NOW,
      currentPeriodEnd: NOW + MONTH,
      purchasedTerms: { planId: "starter", monthlyCredits: 100 },
    })
    const user = seedUser(500)

    await processDodoEvent(
      "subscription.plan_changed",
      { subscription_id: "sub_1", product_id: "pdt_growth_m" },
      "evt_plan_change",
    )

    expect(user.subscriptionCredits).toBe(500)
    expect(user.creditBuckets).toHaveLength(1)
    expect(user.creditBuckets[0].amount).toBe(500)
    expect(h.state.ledger).toHaveLength(0)
  })

  it("a full annual refund stops the sweep from issuing more months", async () => {
    seedPayment({
      dodoPaymentId: "pay_annual",
      amount: 12000,
      creditsGranted: 500,
      creditsAllocated: 6000,
      grantStatus: "partially_granted",
    })
    seedUser(500)
    const sub = {
      id: "sub_row_1",
      userId: "u1",
      dodoSubscriptionId: "sub_1",
      planId: "growth",
      planName: "Growth",
      priceUSD: 12000,
      mirrorCredits: 500,
      status: "active",
      currentPeriodStart: NOW,
      currentPeriodEnd: NOW + 365 * 86_400_000,
      cancelAtPeriodEnd: false,
      billingCycle: "annual",
      purchasedTerms: {
        planId: "growth",
        monthlyCredits: 500,
        annual: { months: 12, totalCredits: 6000 },
      },
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as SubscriptionRecord

    expect(await annualPaymentSucceeded(sub)).toBe(true)

    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_annual", payment_id: "pay_annual", amount: 12000, currency: "USD" },
      "evt_refund_annual",
    )

    expect(await annualPaymentSucceeded(sub)).toBe(false)
  })

  it("partial annual refunds keep the remaining months, then a full refund stops them", async () => {
    seedPayment({
      dodoPaymentId: "pay_annual",
      amount: 12000,
      creditsGranted: 5000,
      creditsAllocated: 6000,
      grantStatus: "partially_granted",
    })
    seedUser(5000)
    const sub = {
      id: "sub_row_1",
      userId: "u1",
      dodoSubscriptionId: "sub_1",
      planId: "growth",
      planName: "Growth",
      priceUSD: 12000,
      mirrorCredits: 500,
      status: "active",
      currentPeriodStart: NOW,
      currentPeriodEnd: NOW + 365 * 86_400_000,
      cancelAtPeriodEnd: false,
      billingCycle: "annual",
      purchasedTerms: {
        planId: "growth",
        monthlyCredits: 500,
        annual: { months: 12, totalCredits: 6000 },
      },
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as SubscriptionRecord

    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_annual_half", payment_id: "pay_annual", amount: 6000, currency: "USD" },
      "evt_refund_annual_half",
    )
    expect(await annualPaymentSucceeded(sub)).toBe(true)
    expect(h.state.users[0].subscriptionCredits).toBe(2500)

    await processDodoEvent(
      "refund.succeeded",
      { refund_id: "rf_annual_rest", payment_id: "pay_annual", amount: 6000, currency: "USD" },
      "evt_refund_annual_rest",
    )
    expect(await annualPaymentSucceeded(sub)).toBe(false)
    expect(h.state.users[0].subscriptionCredits).toBe(0)
    expect(h.state.payments.find((p) => p.dodoPaymentId === "pay_annual")).toMatchObject({
      status: "refunded",
      refundedAmountMinor: 12000,
      creditsReversed: 5000,
    })
  })
})
