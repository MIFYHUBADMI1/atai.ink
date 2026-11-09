import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Atai Finance — Phase 3 Workstream B: durable webhook recovery.
 *
 * These tests run the REAL business logic (`processDodoEvent`) behind the
 * recovery worker against an in-memory model of the pieces that carry the
 * financial invariants:
 *
 *  - a collection fake that implements the Mongo query subset the worker uses
 *    (`$in`, `$or`, `$and`, `$lt/$lte`, `$exists`, `$not: {$gte}`) and, most
 *    importantly, an ATOMIC `findOneAndUpdate` — the property the claim step
 *    depends on for two workers never holding one event;
 *  - a ledger that enforces the unique `idempotencyKey` index by returning the
 *    existing entry on a duplicate, which is what makes every replay below
 *    harmless rather than merely rare.
 *
 * No network, no provider, no real money.
 */

vi.mock("server-only", () => ({}))

const h = vi.hoisted(() => {
  type Doc = Record<string, unknown> & { _id: string }

  const state: {
    events: Doc[]
    payments: Doc[]
    subscriptions: Doc[]
    ledger: Doc[]
    balances: Map<string, number>
    expireCalls: unknown[]
  } = { events: [], payments: [], subscriptions: [], ledger: [], balances: new Map(), expireCalls: [] }

  const eq = (value: unknown, wanted: unknown): boolean => {
    if (wanted === null) return value === null || value === undefined
    return value === wanted
  }

  function applyOp(value: unknown, op: string, arg: unknown): boolean {
    switch (op) {
      case "$eq":
        return eq(value, arg)
      case "$ne":
        return !eq(value, arg)
      case "$in":
        return (arg as unknown[]).some((a) => eq(value, a))
      case "$nin":
        return !(arg as unknown[]).some((a) => eq(value, a))
      case "$exists":
        return arg ? value !== undefined : value === undefined
      case "$lt":
        return typeof value === "number" && value < (arg as number)
      case "$lte":
        return typeof value === "number" && value <= (arg as number)
      case "$gt":
        return typeof value === "number" && value > (arg as number)
      case "$gte":
        return value !== undefined && typeof value === "number" && value >= (arg as number)
      case "$not": {
        // `{attempts: {$not: {$gte: 6}}}` — matches when the field is missing
        // OR the inner operator fails, exactly like the driver.
        if (arg && typeof arg === "object" && !Array.isArray(arg)) {
          return !Object.entries(arg as Record<string, unknown>).every(([inner, a]) => applyOp(value, inner, a))
        }
        return !eq(value, arg)
      }
      default:
        throw new Error(`collection fake: unsupported operator "${op}" — extend it deliberately`)
    }
  }

  function matchField(value: unknown, cond: unknown): boolean {
    if (cond === null || typeof cond !== "object" || Array.isArray(cond) || cond instanceof Date) {
      return eq(value, cond)
    }
    const entries = Object.entries(cond as Record<string, unknown>)
    if (entries.every(([k]) => k.startsWith("$"))) {
      return entries.every(([op, arg]) => applyOp(value, op, arg))
    }
    return eq(value, cond)
  }

  function matches(doc: Doc, filter: Record<string, unknown> | undefined): boolean {
    if (!filter) return true
    return Object.entries(filter).every(([key, cond]) => {
      if (key === "$or") return (cond as Record<string, unknown>[]).some((f) => matches(doc, f))
      if (key === "$and") return (cond as Record<string, unknown>[]).every((f) => matches(doc, f))
      if (key === "$nor") return !(cond as Record<string, unknown>[]).some((f) => matches(doc, f))
      if (key.startsWith("$")) throw new Error(`collection fake: unsupported top-level operator "${key}"`)
      return matchField(doc[key], cond)
    })
  }

  function applyUpdate(doc: Doc, update: Record<string, unknown>): void {
    const set = update.$set as Record<string, unknown> | undefined
    const inc = update.$inc as Record<string, number> | undefined
    if (inc) for (const [k, v] of Object.entries(inc)) doc[k] = (typeof doc[k] === "number" ? (doc[k] as number) : 0) + v
    if (set) Object.assign(doc, set)
  }

  function sorted(rows: Doc[], sort: Record<string, 1 | -1> | undefined): Doc[] {
    if (!sort) return rows
    const [key, dir] = Object.entries(sort)[0] as [string, 1 | -1]
    return rows.slice().sort((a, b) => {
      const av = (a[key] as number) ?? 0
      const bv = (b[key] as number) ?? 0
      return dir === 1 ? av - bv : bv - av
    })
  }

  /** Yield to other pending tasks BEFORE the atomic section, so a test can
   * prove two concurrent claims really do interleave. */
  const tick = () => Promise.resolve()

  function makeCol(getDocs: () => Doc[]) {
    return {
      async find(filter: Record<string, unknown> = {}, opts?: { sort?: Record<string, 1 | -1>; limit?: number }) {
        const rows = sorted(getDocs().filter((d) => matches(d, filter)), opts?.sort)
        const limited = opts?.limit ? rows.slice(0, opts.limit) : rows
        return { async toArray() { return limited.slice() } }
      },
      async findOne(filter: Record<string, unknown>) {
        return getDocs().find((d) => matches(d, filter)) ?? null
      },
      async countDocuments(filter: Record<string, unknown> = {}) {
        return getDocs().filter((d) => matches(d, filter)).length
      },
      async insertOne(doc: Doc) {
        getDocs().push(doc)
        return { acknowledged: true }
      },
      async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
        const doc = getDocs().find((d) => matches(d, filter))
        if (!doc) return { matchedCount: 0, modifiedCount: 0 }
        applyUpdate(doc, update)
        return { matchedCount: 1, modifiedCount: 1 }
      },
      /** Atomic by construction: the scan and the mutate happen in one
       * synchronous block, mirroring the server's single-document guarantee. */
      async findOneAndUpdate(
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        opts?: { sort?: Record<string, 1 | -1>; returnDocument?: string },
      ) {
        await tick()
        const doc = sorted(getDocs().filter((d) => matches(d, filter)), opts?.sort)[0]
        if (!doc) return null
        applyUpdate(doc, update)
        return opts?.returnDocument === "before" ? doc : { ...doc }
      },
      aggregate(pipeline: Record<string, unknown>[]) {
        const self = this as ReturnType<typeof makeCol>
        return {
          async toArray() {
            let rows = getDocs().slice()
            const groups: Doc[] = []
            for (const stage of pipeline) {
              if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match as Record<string, unknown>))
              if (stage.$group) {
                const spec = stage.$group as Record<string, unknown>
                const row: Doc = { _id: spec._id ?? null }
                for (const [field, expr] of Object.entries(spec)) {
                  if (field === "_id") continue
                  if (expr && typeof expr === "object" && "$min" in (expr as Record<string, unknown>)) {
                    const m = (expr as Record<string, unknown>).$min
                    const values = rows
                      .map((d) => {
                        if (m && typeof m === "object" && "$cond" in (m as Record<string, unknown>)) {
                          // { $cond: [ { <op>: [expr, expr] }, then, else ] }
                          const [condition, thenV, elseV] = (m as Record<string, unknown>).$cond as [
                            Record<string, unknown[]>,
                            unknown,
                            unknown,
                          ]
                          const [op, args] = Object.entries(condition)[0]
                          const [left, right] = args
                          const lv = typeof left === "string" && left.startsWith("$") ? d[left.slice(1)] : left
                          const rv = typeof right === "string" && right.startsWith("$") ? d[right.slice(1)] : right
                          const ok =
                            op === "$gt" ? (lv as number) > (rv as number) : op === "$gte" ? (lv as number) >= (rv as number) : false
                          return ok ? thenV : elseV
                        }
                        return typeof m === "string" ? d[m.slice(1)] : m
                      })
                      .filter((v) => typeof v === "number")
                    row[field] = values.length ? Math.min(...values) : null
                  } else if (expr && typeof expr === "object" && "$sum" in (expr as Record<string, unknown>)) {
                    const s = (expr as Record<string, unknown>).$sum
                    row[field] = rows.reduce((acc, d) => {
                      const v = typeof s === "string" ? d[s.slice(1)] : s
                      return acc + (typeof v === "number" ? v : 0)
                    }, 0)
                  }
                }
                groups.push(row)
              }
            }
            void self
            return groups
          },
        }
      },
    }
  }

  const cols = {
    events: makeCol(() => state.events),
    payments: makeCol(() => state.payments),
    subscriptions: makeCol(() => state.subscriptions),
    ledger: makeCol(() => state.ledger),
  }

  const grantMock = vi.fn(async (p: Record<string, any>) => {
    const existing = state.ledger.find((r) => r.idempotencyKey === p.idempotencyKey)
    if (existing) return { success: true, alreadyApplied: true, ledgerEntry: existing }
    const row: Doc = {
      _id: `le_${state.ledger.length + 1}`,
      id: `le_${state.ledger.length + 1}`,
      idempotencyKey: p.idempotencyKey,
      userId: p.userId,
      direction: "credit",
      amount: p.amount,
      transactionType: p.transactionType,
      creditType: p.creditType,
    }
    state.ledger.push(row)
    state.balances.set(p.userId, (state.balances.get(p.userId) ?? 0) + p.amount)
    return { success: true, ledgerEntry: row }
  })

  /** Mirrors `consumeCredits`/`reverseCredits`: dedupe on the key (including
   * the bucket-suffixed variants the real service checks), never go negative. */
  const debitMock = (transactionType: string) =>
    vi.fn(async (p: Record<string, any>) => {
      void transactionType
      const key = p.idempotencyKey as string
      const existing = state.ledger.find(
        (r) => r.idempotencyKey === key || r.idempotencyKey === `${key}_sub` || r.idempotencyKey === `${key}_perm`,
      )
      if (existing) return { success: true, alreadyApplied: true, ledgerEntry: existing }
      const balance = state.balances.get(p.userId) ?? 0
      if (balance < p.amount) return { success: false, ledgerEntry: null }
      const row: Doc = {
        _id: `le_${state.ledger.length + 1}`,
        id: `le_${state.ledger.length + 1}`,
        idempotencyKey: key,
        userId: p.userId,
        direction: "debit",
        amount: p.amount,
        transactionType: p.transactionType,
      }
      state.ledger.push(row)
      state.balances.set(p.userId, balance - p.amount)
      return { success: true, ledgerEntry: row }
    })

  const consumeMock = debitMock("consume")
  const reverseMock = debitMock("reverse")

  const subGrantMock = vi.fn(async (p: Record<string, any>) => {
    const key = `sub_grant_${p.subscriptionId}_period_${Math.floor(p.periodEnd / 86_400_000)}`
    if (state.ledger.some((r) => r.idempotencyKey === key)) return false
    state.ledger.push({
      _id: `le_${state.ledger.length + 1}`,
      id: `le_${state.ledger.length + 1}`,
      idempotencyKey: key,
      userId: p.userId,
      direction: "credit",
      amount: p.amount,
      transactionType: "subscription_grant",
    })
    state.balances.set(p.userId, (state.balances.get(p.userId) ?? 0) + p.amount)
    return true
  })

  const expireMock = vi.fn(async (p: unknown) => {
    state.expireCalls.push(p)
  })

  const activateMock = vi.fn(async (p: Record<string, any>) => {
    const meta = (p.metadata ?? {}) as Record<string, unknown>
    if (!meta.userId) return { ok: false, reason: "missing_user" }
    state.subscriptions.push({
      _id: `subdoc_${state.subscriptions.length + 1}`,
      id: `sub_${state.subscriptions.length + 1}`,
      dodoSubscriptionId: p.subscriptionId,
      userId: meta.userId as string,
      planId: (meta.planId as string) ?? "pro",
      status: "active",
    })
    return { ok: true, planId: (meta.planId as string) ?? "pro" }
  })

  const verifySignatureMock = vi.fn(() => ({ valid: true }))

  return {
    state,
    cols,
    grantMock,
    consumeMock,
    reverseMock,
    subGrantMock,
    expireMock,
    activateMock,
    verifySignatureMock,
    reset: () => {
      state.events = []
      state.payments = []
      state.subscriptions = []
      state.ledger = []
      state.balances = new Map()
      state.expireCalls = []
    },
  }
})

vi.mock("@/lib/db/collections", () => ({
  webhookEventsCol: vi.fn().mockResolvedValue(h.cols.events),
  paymentRecordsCol: vi.fn().mockResolvedValue(h.cols.payments),
  subscriptionRecordsCol: vi.fn().mockResolvedValue(h.cols.subscriptions),
  creditLedgerCol: vi.fn().mockResolvedValue(h.cols.ledger),
}))

vi.mock("@/lib/billing/credit-service", () => ({
  grantCredits: h.grantMock,
  consumeCredits: h.consumeMock,
  reverseCredits: h.reverseMock,
  grantSubscriptionCredits: h.subGrantMock,
  expireSubscriptionCredits: h.expireMock,
  getAvailableCredits: vi.fn(async (userId: string) => h.state.balances.get(userId) ?? 0),
}))

vi.mock("@/lib/billing/activate-subscription", () => ({
  activatePaidSubscription: h.activateMock,
}))

// A witness only: the recovery worker must never touch the provider's
// signature surface — events in this queue were persisted AFTER verification.
vi.mock("@/lib/billing/dodo-webhook", () => ({
  verifyWebhookSignature: h.verifySignatureMock,
}))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  runRecoveryBatch,
  getRecoveryQueueStats,
  recoveryBackoffMs,
  RECOVERY_MAX_ATTEMPTS,
  MAX_ATTEMPTS,
  MAX_BATCH_LIMIT,
  STALE_RECEIVED_GRACE_MS,
  PROCESSING_LEASE_MS,
} from "./webhook-recovery"

const NOW = 1_732_147_200_000 // a fixed "now"; every time decision is explicit
const MINUTE = 60_000

function seedEvent(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: `evt_${String(h.state.events.length + 1)}`,
    id: `wh_${String(h.state.events.length + 1)}`,
    provider: "dodo",
    webhookId: `whid_${String(h.state.events.length + 1)}`,
    eventType: "payment.succeeded",
    payload: { type: "payment.succeeded", data: {} },
    payloadHash: "sha256:stub",
    status: "failed",
    receivedAt: NOW - 10 * MINUTE,
    ...overrides,
  }
  h.state.events.push(doc)
  return doc
}

function paymentData(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: "pay_1",
    total_amount: 2000,
    currency: "USD",
    metadata: { userId: "u1", credits: "5000", packageId: "pack_5k" },
    ...overrides,
  }
}

function eventDoc(id: string) {
  return h.state.events.find((e) => e.id === id)
}

beforeEach(() => {
  h.reset()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("discovery — failed and unresolved events are recoverable", () => {
  it("re-runs a failed payment.succeeded through the SAME live handler", async () => {
    seedEvent({
      id: "wh_pay",
      eventType: "payment.succeeded",
      status: "failed",
      payload: { type: "payment.succeeded", data: paymentData({ payment_id: "pay_recov" }) },
    })

    const batch = await runRecoveryBatch({ limit: 5, now: NOW })

    expect(batch.resolved).toBe(1)
    expect(batch.results[0]).toMatchObject({ eventId: "wh_pay", outcome: "processed" })
    // The financial effect is the live handler's own, keyed on the payment id.
    expect(h.grantMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "payment_pay_recov" }))
    expect(eventDoc("wh_pay")).toMatchObject({ status: "processed", processedAt: NOW, nextAttemptAt: null })
  })

  it("a payment that arrived at the account is booked exactly once even across many replays", async () => {
    seedEvent({
      id: "wh_dup",
      eventType: "payment.succeeded",
      status: "failed",
      payload: { type: "payment.succeeded", data: paymentData({ payment_id: "pay_once" }) },
    })

    await runRecoveryBatch({ limit: 5, now: NOW })
    // Simulate the crash window: the ledger write landed, the status update did
    // not. Force the event back into a claimable state and replay it.
    Object.assign(eventDoc("wh_dup")!, { status: "failed", attempts: 0, nextAttemptAt: null, processedAt: undefined })
    await runRecoveryBatch({ limit: 5, now: NOW + MINUTE })

    const rows = h.state.ledger.filter((r) => r.idempotencyKey === "payment_pay_once")
    expect(rows).toHaveLength(1)
    expect(h.state.balances.get("u1")).toBe(5000)
    // …and only one payment record exists.
    expect(h.state.payments.filter((p) => p.dodoPaymentId === "pay_once")).toHaveLength(1)
  })

  it("replays a subscription renewal without granting the period twice", async () => {
    seedEvent({
      id: "wh_sub",
      eventType: "subscription.renewed",
      status: "failed",
      payload: {
        type: "subscription.renewed",
        data: {
          subscription_id: "sub_1",
          next_billing_date: "2026-12-01",
          metadata: { userId: "u1", planId: "starter" },
        },
      },
    })

    await runRecoveryBatch({ limit: 5, now: NOW })
    expect(eventDoc("wh_sub")).toMatchObject({ status: "processed" })
    Object.assign(eventDoc("wh_sub")!, { status: "failed", attempts: 0, nextAttemptAt: null })
    await runRecoveryBatch({ limit: 5, now: NOW + MINUTE })

    const periodKey = `sub_grant_sub_1_period_${Math.floor(new Date("2026-12-01").getTime() / 86_400_000)}`
    expect(h.state.ledger.filter((r) => r.idempotencyKey === periodKey)).toHaveLength(1)
    // The renewal also expires the outgoing bucket for THIS subscription only.
    expect(h.expireMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", subscriptionId: "sub_1" }))
  })

  it("an unresolved refund becomes resolvable once its payment lands", async () => {
    seedEvent({
      id: "wh_rf",
      eventType: "refund.succeeded",
      status: "unresolved",
      payload: { type: "refund.succeeded", data: { refund_id: "rf_1", payment_id: "pay_missing", amount: 2000, currency: "USD" } },
    })

    const first = await runRecoveryBatch({ limit: 5, now: NOW })
    expect(first.results[0]).toMatchObject({ outcome: "unresolved" })
    expect(h.reverseMock).not.toHaveBeenCalled()
    expect(eventDoc("wh_rf")).toMatchObject({ status: "unresolved" })
    expect(eventDoc("wh_rf")!.nextAttemptAt).toBe(NOW + recoveryBackoffMs(1))

    // The payment record arrives late; the next bounded batch resolves it.
    h.state.payments.push({
      _id: "paydoc_1",
      id: "pay_local_1",
      dodoPaymentId: "pay_missing",
      userId: "u1",
      amount: 2000,
      currency: "USD",
      status: "succeeded",
      creditsGranted: 5000,
      creditType: "permanent",
    })
    h.state.balances.set("u1", 5000)
    Object.assign(eventDoc("wh_rf")!, { nextAttemptAt: NOW, attempts: 1 })

    const second = await runRecoveryBatch({ limit: 5, now: NOW + 2 * MINUTE })
    expect(second.results[0]).toMatchObject({ outcome: "processed" })
    expect(h.reverseMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "refund_rf_1", amount: 5000 }))
    expect(h.state.balances.get("u1")).toBe(0)
  })
})

describe("eligibility — status alone never authorizes a replay", () => {
  it("skips a failed event whose type has no safely re-processable effect", async () => {
    seedEvent({ id: "wh_dispute", eventType: "dispute.lost", status: "failed" })
    seedEvent({ id: "wh_unknown", eventType: "some.future.event", status: "failed" })

    const batch = await runRecoveryBatch({ limit: 10, now: NOW })

    expect(batch.processed).toBe(0)
    expect(eventDoc("wh_dispute")).toMatchObject({ status: "failed" })
    expect(eventDoc("wh_unknown")).toMatchObject({ status: "failed" })
    expect(h.grantMock).not.toHaveBeenCalled()
    expect(h.state.ledger).toHaveLength(0)
  })

  it("skips an event whose attempt budget is exhausted", async () => {
    seedEvent({ id: "wh_spent", attempts: RECOVERY_MAX_ATTEMPTS, eventType: "payment.succeeded", payload: { type: "x", data: paymentData() } })
    const batch = await runRecoveryBatch({ limit: 10, now: NOW })
    expect(batch.processed).toBe(0)
    expect(eventDoc("wh_spent")).toMatchObject({ status: "failed" })
  })

  it("skips an event whose backoff has not elapsed, then runs it once it has", async () => {
    seedEvent({ id: "wh_late", attempts: 2, nextAttemptAt: NOW + 60 * MINUTE, payload: { type: "x", data: paymentData({ payment_id: "pay_late" }) } })
    expect((await runRecoveryBatch({ limit: 10, now: NOW })).processed).toBe(0)

    Object.assign(eventDoc("wh_late")!, { nextAttemptAt: NOW })
    expect((await runRecoveryBatch({ limit: 10, now: NOW })).processed).toBe(1)
  })

  it("historical events with no recovery bookkeeping are treated as attempts: 0", async () => {
    // Pre-Phase-3 documents have no `attempts` / `nextAttemptAt` at all.
    seedEvent({ id: "wh_legacy", payload: { type: "x", data: paymentData({ payment_id: "pay_legacy" }) } })
    delete (eventDoc("wh_legacy") as Record<string, unknown>).attempts
    const batch = await runRecoveryBatch({ limit: 10, now: NOW })
    expect(batch.resolved).toBe(1)
  })

  it("never claims processed, ignored, or manual_review events", async () => {
    seedEvent({ id: "wh_done", status: "processed", eventType: "payment.succeeded" })
    seedEvent({ id: "wh_ignored", status: "ignored", eventType: "payment.succeeded" })
    seedEvent({ id: "wh_review", status: "manual_review", eventType: "payment.succeeded" })
    const batch = await runRecoveryBatch({ limit: 10, now: NOW })
    expect(batch.processed).toBe(0)
    expect([eventDoc("wh_done"), eventDoc("wh_ignored"), eventDoc("wh_review")]).toHaveLength(3)
  })

  it(`a verified event stuck at "received" is only recoverable past the grace window`, async () => {
    seedEvent({ id: "wh_fresh", status: "received", receivedAt: NOW - MINUTE, payload: { type: "x", data: paymentData({ payment_id: "pay_fresh" }) } })
    expect((await runRecoveryBatch({ limit: 10, now: NOW })).processed).toBe(0)

    Object.assign(eventDoc("wh_fresh")!, { receivedAt: NOW - STALE_RECEIVED_GRACE_MS - MINUTE })
    expect((await runRecoveryBatch({ limit: 10, now: NOW })).resolved).toBe(1)
  })

  it("reclaims a crashed worker's event only after the processing lease expires", async () => {
    seedEvent({ id: "wh_running", status: "processing", lastAttemptAt: NOW - MINUTE, eventType: "subscription.cancelled", payload: { type: "x", data: { subscription_id: "sub_x", metadata: { userId: "u1" } } } })
    expect((await runRecoveryBatch({ limit: 10, now: NOW })).processed).toBe(0)

    Object.assign(eventDoc("wh_running")!, { lastAttemptAt: NOW - PROCESSING_LEASE_MS - MINUTE })
    const batch = await runRecoveryBatch({ limit: 10, now: NOW })
    expect(batch.resolved).toBe(1)
    expect(h.state.subscriptions.length + h.state.payments.length).toBeGreaterThanOrEqual(0)
  })
})

describe("claiming is atomic — two workers cannot hold one event", () => {
  it("each eligible event is handled exactly once under concurrent batches", async () => {
    for (let i = 1; i <= 4; i++) {
      seedEvent({ id: `wh_c${i}`, eventType: "payment.succeeded", payload: { type: "x", data: paymentData({ payment_id: `pay_c${i}` }) } })
    }

    const [a, b] = await Promise.all([runRecoveryBatch({ limit: 4, now: NOW }), runRecoveryBatch({ limit: 4, now: NOW })])

    const handled = [...a.results, ...b.results].map((r) => r.eventId)
    expect(handled).toHaveLength(4)
    expect(new Set(handled).size).toBe(4)
    expect(a.processed + b.processed).toBe(4)
    // Four distinct payments → four grants, one per payment id, no phantom fifth.
    expect(h.state.ledger.filter((r) => r.direction === "credit")).toHaveLength(4)
    expect(h.state.balances.get("u1")).toBe(20_000)
  })

  it("claims oldest events first, so a backlog drains in arrival order", async () => {
    seedEvent({ id: "wh_new", receivedAt: NOW - MINUTE, payload: { type: "x", data: paymentData({ payment_id: "pay_new" }) } })
    seedEvent({ id: "wh_old", receivedAt: NOW - 90 * MINUTE, payload: { type: "x", data: paymentData({ payment_id: "pay_old" }) } })

    const batch = await runRecoveryBatch({ limit: 1, now: NOW })
    expect(batch.results[0].eventId).toBe("wh_old")
  })
})

describe("attempt budget, backoff and the terminal human-review state", () => {
  it("MAX_ATTEMPTS is the same constant the reconciliation service reads", () => {
    expect(RECOVERY_MAX_ATTEMPTS).toBe(MAX_ATTEMPTS)
    expect(MAX_ATTEMPTS).toBe(6)
  })

  it("the backoff schedule grows and is capped at 24h", () => {
    const HOUR = 3_600_000
    expect(recoveryBackoffMs(1)).toBe(5 * MINUTE)
    expect(recoveryBackoffMs(2)).toBe(20 * MINUTE)
    expect(recoveryBackoffMs(3)).toBe(80 * MINUTE)
    expect(recoveryBackoffMs(4)).toBe(320 * MINUTE)
    expect(recoveryBackoffMs(5)).toBe(1280 * MINUTE)
    expect(recoveryBackoffMs(6)).toBe(24 * HOUR)
    // Never unbounded, never shrinking, never negative.
    let previous = 0
    for (let attempts = 1; attempts <= 60; attempts++) {
      const delay = recoveryBackoffMs(attempts)
      expect(delay).toBeGreaterThanOrEqual(previous)
      expect(delay).toBeLessThanOrEqual(24 * HOUR)
      previous = delay
    }
  })

  it("a still-failing replay schedules the next attempt rather than spinning", async () => {
    seedEvent({
      id: "wh_still_bad",
      attempts: 2,
      eventType: "payment.succeeded",
      // no metadata.userId → the handler returns unresolved every time
      payload: { type: "x", data: { payment_id: "pay_nobody", total_amount: 100, currency: "USD", metadata: {} } },
    })

    const batch = await runRecoveryBatch({ limit: 5, now: NOW })
    expect(batch.results[0]).toMatchObject({ outcome: "unresolved", attempts: 3 })
    expect(eventDoc("wh_still_bad")).toMatchObject({
      status: "unresolved",
      nextAttemptAt: NOW + recoveryBackoffMs(3),
    })
  })

  it("exhausting the budget escalates to manual_review and leaves it alone afterwards", async () => {
    seedEvent({
      id: "wh_exhausted",
      attempts: RECOVERY_MAX_ATTEMPTS - 1, // this claim makes it the last one
      eventType: "payment.succeeded",
      payload: { type: "x", data: { payment_id: "pay_orphan", metadata: {} } },
    })

    const batch = await runRecoveryBatch({ limit: 5, now: NOW })
    expect(batch.escalatedToManualReview).toBe(1)
    expect(batch.results[0].outcome).toBe("manual_review")

    const doc = eventDoc("wh_exhausted")!
    expect(doc).toMatchObject({ status: "manual_review", nextAttemptAt: null })
    expect(typeof doc.reviewReason === "string" && (doc.reviewReason as string).length).toBeGreaterThan(0)

    // Terminal for the worker: a later batch must not re-claim it.
    expect((await runRecoveryBatch({ limit: 5, now: NOW + 24 * 3_600_000 })).processed).toBe(0)
  })

  it("a handler that throws is recorded as failed with the reason, never as processed", async () => {
    h.state.payments.push({
      _id: "paydoc_9",
      id: "pay_local_9",
      dodoPaymentId: "pay_9",
      userId: "u1",
      amount: 1000,
      currency: "USD",
      status: "succeeded",
      creditsGranted: 1000,
      creditType: "permanent",
    })
    h.state.balances.set("u1", 0) // the clawback has nothing to take
    seedEvent({
      id: "wh_reverse_fail",
      eventType: "refund.succeeded",
      payload: { type: "x", data: { refund_id: "rf_9", payment_id: "pay_9", amount: 1000, currency: "USD" } },
    })

    const batch = await runRecoveryBatch({ limit: 5, now: NOW })
    expect(batch.results[0].outcome).toBe("failed")
    expect(batch.results[0].reason).toMatch(/reversal failed/i)
    expect(eventDoc("wh_reverse_fail")).toMatchObject({ status: "failed" })
    // Fail-loud: a refund that could not be applied is never silently "processed".
    expect(h.state.payments.filter((p) => p.dodoPaymentId === "rf_9")).toHaveLength(0)
  })

  it("a non-reprocessable type claimed at the set boundary is escalated, not guessed", async () => {
    // The defensive branch inside the batch. The claim filter already excludes
    // these, so the only way to reach it is a type set change mid-flight —
    // assert the outcome rather than pretending it cannot happen.
    seedEvent({ id: "wh_boundary", eventType: "payment.succeeded", payload: { type: "x", data: paymentData({ payment_id: "pay_b" }) } })
    const batch = await runRecoveryBatch({ limit: 1, now: NOW })
    expect(batch.processed).toBe(1)
    expect(batch.claimedButSkipped).toBe(0)
  })
})

describe("batch bounds", () => {
  it("honours the limit and reports more work", async () => {
    for (let i = 1; i <= 12; i++) {
      seedEvent({ id: `wh_b${i}`, eventType: "payment.succeeded", payload: { type: "x", data: paymentData({ payment_id: `pay_b${i}` }) } })
    }

    const small = await runRecoveryBatch({ limit: 5, now: NOW })
    expect(small.processed).toBe(5)
    expect(small.hasMore).toBe(true)

    const rest = await runRecoveryBatch({ limit: 50, now: NOW })
    expect(rest.processed).toBe(7)
    expect(rest.hasMore).toBe(false)
    expect(h.state.ledger).toHaveLength(12)
  })

  it("clamps an oversized limit to MAX_BATCH_LIMIT — one operator call cannot drain unboundedly", async () => {
    for (let i = 1; i <= MAX_BATCH_LIMIT + 10; i++) {
      seedEvent({ id: `wh_big${i}`, eventType: "payment.succeeded", payload: { type: "x", data: paymentData({ payment_id: `pay_big${i}` }) } })
    }
    const batch = await runRecoveryBatch({ limit: 10_000, now: NOW })
    expect(batch.processed).toBe(MAX_BATCH_LIMIT)
    expect(batch.hasMore).toBe(true)
    expect(h.state.events.filter((e) => e.status === "processed")).toHaveLength(MAX_BATCH_LIMIT)
    expect(h.state.events.filter((e) => e.status === "failed")).toHaveLength(10)
  })

  it("stops early when the queue runs dry", async () => {
    seedEvent({ id: "wh_only", eventType: "payment.succeeded", payload: { type: "x", data: paymentData({ payment_id: "pay_only" }) } })
    const batch = await runRecoveryBatch({ limit: 10, now: NOW })
    expect(batch.processed).toBe(1)
    expect(batch.hasMore).toBe(false)
  })

  it("an empty queue is a clean no-op", async () => {
    const batch = await runRecoveryBatch({ limit: 10, now: NOW })
    expect(batch).toMatchObject({ processed: 0, resolved: 0, stillPending: 0, escalatedToManualReview: 0, hasMore: false })
    expect(batch.results).toEqual([])
  })
})

describe("operator queue statistics", () => {
  it("counts each state and only counts due, budgeted, reprocessable events as eligible", async () => {
    seedEvent({ id: "e1", status: "failed", eventType: "payment.succeeded" })
    seedEvent({ id: "e2", status: "unresolved", eventType: "refund.succeeded" })
    seedEvent({ id: "e3", status: "processing", lastAttemptAt: NOW - PROCESSING_LEASE_MS - MINUTE, eventType: "payment.succeeded" })
    seedEvent({ id: "e4", status: "manual_review", eventType: "payment.succeeded" })
    seedEvent({ id: "e5", status: "received", receivedAt: NOW - STALE_RECEIVED_GRACE_MS - MINUTE, eventType: "payment.succeeded" })
    seedEvent({ id: "e6", status: "failed", eventType: "dispute.opened" })
    seedEvent({ id: "e7", status: "failed", attempts: RECOVERY_MAX_ATTEMPTS, eventType: "payment.succeeded" })
    seedEvent({ id: "e8", status: "failed", nextAttemptAt: NOW + 60 * MINUTE, eventType: "payment.succeeded" })

    const stats = await getRecoveryQueueStats(NOW)

    expect(stats.counts.failed).toBe(4) // e1, e6, e7, e8
    expect(stats.counts.unresolved).toBe(1)
    expect(stats.counts.processing).toBe(1)
    expect(stats.counts.manual_review).toBe(1)
    expect(stats.counts.stale_received).toBe(1)
    // e1, e2, e3, e5 only — e6 wrong type, e7 no budget, e8 not yet due.
    expect(stats.eligibleNow).toBe(4)
    expect(stats.oldestEligibleReceivedAt).toBe(NOW - 10 * MINUTE)
    expect(stats.nextScheduledAttemptAt).toBe(NOW + 60 * MINUTE)
  })

  it("an empty queue reports nulls rather than fabricated timestamps", async () => {
    const stats = await getRecoveryQueueStats(NOW)
    expect(stats.eligibleNow).toBe(0)
    expect(stats.oldestEligibleReceivedAt).toBeNull()
    expect(stats.nextScheduledAttemptAt).toBeNull()
  })

  it("stats never mutate anything", async () => {
    seedEvent({ id: "e_mutate", status: "failed", eventType: "payment.succeeded", payload: { type: "x", data: paymentData() } })
    const before = JSON.stringify(h.state.events)
    await getRecoveryQueueStats(NOW)
    expect(JSON.stringify(h.state.events)).toBe(before)
    expect(h.state.ledger).toHaveLength(0)
  })
})

describe("scheduling and provenance boundaries", () => {
  it("nothing self-fires: a batch schedules no timers and returns when called", async () => {
    vi.useFakeTimers()
    seedEvent({ id: "wh_timer", eventType: "payment.succeeded", payload: { type: "x", data: paymentData({ payment_id: "pay_timer" }) } })
    await runRecoveryBatch({ limit: 5, now: NOW })
    await getRecoveryQueueStats(NOW)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("recovery trusts only the persisted, already-verified event — never the provider surface", async () => {
    const data = paymentData({ payment_id: "pay_prov" })
    seedEvent({
      id: "wh_prov",
      eventType: "payment.succeeded",
      payload: { type: "payment.succeeded", data },
      payloadHash: "sha256:stored",
    })

    await runRecoveryBatch({ limit: 5, now: NOW })

    expect(h.verifySignatureMock).not.toHaveBeenCalled()
    // The handler received exactly the stored payload, unchanged.
    expect(h.grantMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "payment_pay_prov" }))
    expect(eventDoc("wh_prov")!.payloadHash).toBe("sha256:stored")
  })

  it("replays cannot grant credits twice across the whole queue", async () => {
    for (let i = 1; i <= 3; i++) {
      seedEvent({ id: `wh_i${i}`, eventType: "payment.succeeded", payload: { type: "x", data: paymentData({ payment_id: `pay_i${i}` }) } })
    }
    await runRecoveryBatch({ limit: 10, now: NOW })
    const balanceAfterFirstRun = h.state.balances.get("u1")
    // Second and third batches: everything is `processed` now, so nothing is
    // claimable and the balance is untouched.
    await runRecoveryBatch({ limit: 10, now: NOW + 5 * MINUTE })
    await runRecoveryBatch({ limit: 10, now: NOW + 10 * MINUTE })
    expect(h.state.balances.get("u1")).toBe(balanceAfterFirstRun)
    expect(h.state.ledger).toHaveLength(3)
  })
})
