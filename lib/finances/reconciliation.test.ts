import { describe, it, expect, vi } from "vitest"
import { reconcileFinances, ATTRIBUTION_GRACE_MS, MAX_WINDOW_SIZE } from "@/lib/finances/reconciliation"

/**
 * Phase 3 — Workstream E reconciliation tests (§11 "Reconciliation").
 *
 * Deterministic in-memory collections, an injected clock, and NO writes: the
 * fakes deliberately have no `updateOne`/`insertOne`/`deleteMany` at all, so if
 * the service ever tried to repair a record the call would throw and the
 * "read-only" test would fail loudly.
 */

vi.mock("server-only", () => ({}))

type Doc = Record<string, unknown> & { id: string }

// ── Minimal query evaluator (only the operators this service uses) ───────────
function matches(doc: Doc, filter: Doc): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!(cond as Doc[]).some((b) => matches(doc, b))) return false
      continue
    }
    const actual = key.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Doc)[part] : undefined), doc)
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      const ops = cond as Doc
      if ("$in" in ops) {
        const list = ops.$in as unknown[]
        if (!list.includes(actual ?? null)) return false
        continue
      }
      if ("$lt" in ops) {
        if (typeof actual !== "number" || actual >= (ops.$lt as number)) return false
        continue
      }
      if ("$gte" in ops) {
        if (typeof actual !== "number" || actual < (ops.$gte as number)) return false
        continue
      }
      if ("$gt" in ops) {
        if (typeof actual !== "number" || actual <= (ops.$gt as number)) return false
        continue
      }
      if ("$ne" in ops && actual === ops.$ne) return false
      continue
    }
    if (Array.isArray(actual) && typeof cond !== "undefined" && actual.includes(cond)) continue
    if (actual !== cond) return false
  }
  return true
}

class FakeCursor<T extends Doc> {
  constructor(private rows: T[]) {}
  sort(spec: Record<string, 1 | -1>) {
    const keys = Object.entries(spec)
    this.rows = [...this.rows].sort((a, b) => {
      for (const [k, dir] of keys) {
        const av = (a[k] as number) ?? 0
        const bv = (b[k] as number) ?? 0
        if (av !== bv) return dir === 1 ? av - bv : bv - av
      }
      return 0
    })
    return this
  }
  limit(n: number) {
    this.rows = this.rows.slice(0, n)
    return this
  }
  skip(n: number) {
    this.rows = this.rows.slice(n)
    return this
  }
  async toArray() {
    return this.rows
  }
}

function fakeCol<T extends Doc>(rows: T[]) {
  return {
    find(filter: Doc = {}) {
      return new FakeCursor(rows.filter((r) => matches(r, filter)))
    },
    async findOne(filter: Doc = {}) {
      return rows.find((r) => matches(r, filter)) ?? null
    },
    aggregate(pipeline: Doc[]) {
      let current: Doc[] = [...rows]
      for (const stage of pipeline) {
        if (stage.$match) current = current.filter((d) => matches(d, stage.$match as Doc))
        else if (stage.$group) {
          const g = stage.$group as { _id: string; count?: unknown; ids?: unknown }
          const keyOf = (d: Doc) => String((d[g._id.replace("$", "")] as string | number | undefined) ?? "")
          const groups = new Map<string, Doc>()
          for (const d of current) {
            const k = keyOf(d)
            const acc = groups.get(k) ?? { _id: k, count: 0, ids: [] as string[] }
            acc.count += 1
            ;(acc.ids as string[]).push(d.id)
            groups.set(k, acc)
          }
          current = [...groups.values()]
        } else if (stage.$limit) current = current.slice(0, stage.$limit as number)
        else throw new Error(`reconciliation test fake: unsupported aggregate stage ${JSON.stringify(Object.keys(stage))}`)
      }
      return { async toArray() { return current } }
    },
    /** Any write is a test failure by construction — the service is read-only. */
    updateOne: () => {
      throw new Error("reconciliation must never write")
    },
    insertOne: () => {
      throw new Error("reconciliation must never write")
    },
    deleteMany: () => {
      throw new Error("reconciliation must never write")
    },
  }
}

const NOW = 1_800_000_000_000
const OLD = NOW - 3 * 24 * 3_600_000

function collections(
  docs: {
    payments?: Doc[]
    ledger?: Doc[]
    subscriptions?: Doc[]
    webhooks?: Doc[]
    users?: Doc[]
  },
) {
  return {
    payments: async () => fakeCol(docs.payments ?? []) as never,
    ledger: async () => fakeCol(docs.ledger ?? []) as never,
    subscriptions: async () => fakeCol(docs.subscriptions ?? []) as never,
    webhooks: async () => fakeCol(docs.webhooks ?? []) as never,
    users: async () => fakeCol(docs.users ?? []) as never,
  }
}

const packPayment = (over: Doc = {}): Doc => ({
  id: "pay_local_1",
  dodoPaymentId: "pay_1",
  userId: "u1",
  status: "succeeded",
  paymentType: "permanent_credit_pack",
  amount: 5000,
  currency: "USD",
  creditsGranted: 10_000,
  creditType: "permanent",
  createdAt: OLD,
  updatedAt: OLD,
  ...over,
})

const grantEntry = (over: Doc = {}): Doc => ({
  id: "ledger_1",
  userId: "u1",
  creditType: "permanent",
  amount: 10_000,
  direction: "credit",
  transactionType: "credit_purchase",
  referenceType: "payment",
  referenceId: "pay_1",
  idempotencyKey: "payment_pay_1",
  createdAt: OLD,
  ...over,
})

const refundRow = (over: Doc = {}): Doc => ({
  id: "pay_local_r",
  dodoPaymentId: "rf_1",
  refundId: "rf_1",
  originalPaymentId: "pay_1",
  userId: "u1",
  status: "refunded",
  paymentType: "refund",
  amount: -5000,
  currency: "USD",
  creditsGranted: -10_000,
  createdAt: OLD,
  updatedAt: OLD,
  ...over,
})

const reversalEntry = (over: Doc = {}): Doc => ({
  id: "ledger_r",
  userId: "u1",
  creditType: "permanent",
  amount: 10_000,
  direction: "debit",
  transactionType: "refund_reversal",
  referenceType: "refund",
  referenceId: "rf_1",
  idempotencyKey: "refund_rf_1",
  createdAt: OLD,
  ...over,
})

const activeSub = (over: Doc = {}): Doc => ({
  id: "sub_local_1",
  dodoSubscriptionId: "sub_1",
  userId: "u1",
  planId: "pro",
  planName: "Pro",
  priceUSD: 29,
  mirrorCredits: 5000,
  status: "active",
  currentPeriodStart: OLD,
  currentPeriodEnd: NOW + 5 * 86_400_000,
  cancelAtPeriodEnd: false,
  createdAt: OLD,
  updatedAt: OLD,
  ...over,
})

const periodGrantKey = (subscriptionId: string, periodEnd: number) => `sub_grant_${subscriptionId}_period_${Math.floor(periodEnd / 86_400_000)}`

const userDoc = (over: Doc = {}): Doc => ({
  id: "u1",
  credits: 10_000,
  subscriptionCredits: 0,
  permanentCredits: 10_000,
  ...over,
})

const types = (findings: Array<{ type: string }>) => findings.map((f) => f.type).sort()

describe("healthy records produce no false discrepancies", () => {
  it("a fully accounted payment/refund/subscription set is clean", async () => {
    const periodEnd = NOW + 5 * 86_400_000
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [packPayment(), refundRow()],
        ledger: [
          grantEntry(),
          reversalEntry(),
          grantEntry({ id: "ledger_s", transactionType: "subscription_grant", creditType: "subscription", referenceType: "subscription", referenceId: "sub_1", idempotencyKey: periodGrantKey("sub_1", periodEnd), amount: 5000 }),
        ],
        subscriptions: [activeSub({ currentPeriodEnd: periodEnd })],
        webhooks: [],
        users: [userDoc()],
      }),
    )
    expect(page.findings).toEqual([])
    expect(page.summary.total).toBe(0)
    expect(page.readOnly).toBe(true)
    expect(page.scanned.payments).toBe(2)
  })

  it("an active subscription whose credits were fully consumed is NOT a mismatch", async () => {
    const periodEnd = NOW + 5 * 86_400_000
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [],
        ledger: [grantEntry({ id: "ledger_s", transactionType: "subscription_grant", creditType: "subscription", referenceId: "sub_1", idempotencyKey: periodGrantKey("sub_1", periodEnd), amount: 5000 })],
        subscriptions: [activeSub({ currentPeriodEnd: periodEnd })],
        users: [userDoc({ credits: 0, subscriptionCredits: 0, permanentCredits: 0 })],
      }),
    )
    expect(page.findings).toEqual([])
  })
})

describe("payment ↔ grant relationships", () => {
  it("detects a confirmed payment with no credit grant", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ payments: [packPayment()], ledger: [], users: [userDoc()] }))
    expect(types(page.findings)).toEqual(["payment_without_grant"])
    const f = page.findings[0]
    expect(f.severity).toBe("critical")
    expect(f.expected).toContain("payment_pay_1")
    expect(f.observed).toContain("no ledger entry")
    expect(f.relatedIds).toContain("pay_local_1")
    expect(f.resolution).toBe("open")
  })

  it("defers a payment that is still inside the attribution grace window", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [packPayment({ createdAt: NOW - ATTRIBUTION_GRACE_MS + 60_000 })], users: [userDoc()] }),
    )
    expect(page.findings).toEqual([])
    expect(page.summary.deferredRecent).toBe(1)
  })

  it("detects a purchase-shaped grant with no payment behind it", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ payments: [], ledger: [grantEntry({ referenceId: "pay_ghost" })], users: [userDoc()] }))
    expect(types(page.findings)).toEqual(["grant_without_payment"])
    expect(page.findings[0].referenceId).toBe("pay_ghost")
  })

  it("detects a payment with no attribution and treats it as a business decision, not a fix", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ payments: [packPayment({ userId: "", creditsGranted: undefined })], users: [userDoc()] }))
    expect(types(page.findings)).toEqual(["payment_attribution_missing"])
    expect(page.findings[0].resolution).toBe("needs_business_decision")
  })

  it("detects duplicate payment rows (legacy, pre-unique-index)", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [packPayment(), packPayment({ id: "pay_local_dupe" }), grantEntry()],
        ledger: [grantEntry()],
        users: [userDoc()],
      }),
    )
    expect(page.findings.map((f) => f.type)).toContain("duplicate_payment_records")
  })

  it("detects two ledger entries sharing one idempotency key", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [packPayment()], ledger: [grantEntry(), grantEntry({ id: "ledger_dup" })], users: [userDoc()] }),
    )
    expect(page.findings.map((f) => f.type)).toContain("duplicate_credit_grant")
  })
})

describe("refund ↔ reversal relationships", () => {
  it("detects a confirmed refund with no required reversal", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ payments: [packPayment(), refundRow()], ledger: [grantEntry()], users: [userDoc()] }))
    expect(types(page.findings)).toEqual(["refund_without_reversal"])
    expect(page.findings[0].expected).toContain("refund_rf_1")
  })

  it("does NOT require a reversal when the original granted no credits", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [packPayment({ creditsGranted: 0 }), refundRow()],
        ledger: [],
        users: [userDoc()],
      }),
    )
    expect(page.findings.map((f) => f.type)).not.toContain("refund_without_reversal")
  })

  it("detects a refund row whose original payment is missing", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ payments: [refundRow({ originalPaymentId: "pay_ghost" })], users: [userDoc()] }))
    expect(page.findings.map((f) => f.type)).toContain("refund_without_payment")
  })

  it("detects a credit reversal with no confirmed refund, without inventing one", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ payments: [], ledger: [reversalEntry()], users: [userDoc()] }))
    const f = page.findings.find((x) => x.type === "reversal_without_refund")
    expect(f).toBeTruthy()
    expect(f!.resolution).toBe("needs_business_decision")
    expect(f!.description).toMatch(/remains unconfirmed/)
  })

  it("flags two refund rows for the same Dodo refund id", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [packPayment(), refundRow(), refundRow({ id: "pay_local_r2" }), grantEntry(), reversalEntry()],
        ledger: [grantEntry(), reversalEntry()],
        users: [userDoc()],
      }),
    )
    expect(page.findings.map((f) => f.type)).toContain("duplicate_refund_records")
  })

  it("flags refund rows that total more than the original payment", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [
          packPayment(),
          refundRow({ id: "r_a", dodoPaymentId: "rf_a", refundId: "rf_a", amount: -4000 }),
          refundRow({ id: "r_b", dodoPaymentId: "rf_b", refundId: "rf_b", amount: -3000 }),
          grantEntry(),
        ],
        ledger: [grantEntry(), reversalEntry({ id: "rv_a", referenceId: "rf_a", idempotencyKey: "refund_rf_a" }), reversalEntry({ id: "rv_b", referenceId: "rf_b", idempotencyKey: "refund_rf_b" })],
        users: [userDoc()],
      }),
    )
    const over = page.findings.find((f) => f.id.startsWith("duplicate_refund_records:over"))
    expect(over).toBeTruthy()
    expect(over!.observed).toContain("7000")
  })

  it("an unlinked historical refund is an INCOMPLETE record, not a confirmed error", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [refundRow({ originalPaymentId: undefined })], users: [userDoc()] }),
    )
    expect(types(page.findings)).toEqual(["incomplete_record"])
    expect(page.findings[0].severity).toBe("info")
    expect(page.findings[0].resolution).toBe("needs_business_decision")
  })

  it("a cross-currency refund is reported as unevaluable, never converted", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [packPayment({ currency: "USD" }), refundRow({ currency: "EUR" })], ledger: [grantEntry()], users: [userDoc()] }),
    )
    expect(page.findings.map((f) => f.type)).toEqual(["incomplete_record"])
    expect(page.findings[0].observed).toContain("EUR vs USD")
  })
})

describe("ledger shape, subscriptions and balances", () => {
  it("detects a reversal written with the wrong direction", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [], ledger: [reversalEntry({ direction: "credit" })], users: [userDoc()] }),
    )
    const finding = page.findings.find((f) => f.type === "unexpected_ledger_entry")
    expect(finding).toBeDefined()
    // A `refund_reversal` is a clawback: the authoritative direction is debit.
    expect(finding!.expected).toContain('direction "debit"')
  })

  it("direction is read from the reversal vocabulary, not assumed", async () => {
    // `runtime_refund` / `other_reversal` / `build_release` are written by
    // grantCredits → CREDIT rows. They must never be reported as broken, and
    // the same type written as a debit must be.
    const correct = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [],
        ledger: [
          reversalEntry({ id: "l_rt", transactionType: "runtime_refund", direction: "credit", referenceType: "runtime_request", referenceId: "rtreq_1", idempotencyKey: "rtreq_1_refund" }),
          reversalEntry({ id: "l_oth", transactionType: "other_reversal", direction: "credit", referenceType: "project", referenceId: "prj_1", idempotencyKey: "seo_intent_1_refund" }),
          reversalEntry({ id: "l_rel", transactionType: "build_release", direction: "credit", referenceType: "build", referenceId: "bld_1", idempotencyKey: "release_bld_1" }),
        ],
        users: [userDoc()],
      }),
    )
    expect(correct.findings).toEqual([])

    const inverted = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [],
        ledger: [reversalEntry({ id: "l_rt2", transactionType: "runtime_refund", direction: "debit", referenceId: "rtreq_1", idempotencyKey: "rtreq_1_refund" })],
        users: [userDoc()],
      }),
    )
    const finding = inverted.findings.find((f) => f.type === "unexpected_ledger_entry")
    expect(finding!.expected).toContain('direction "credit"')
  })

  it("detects a non-positive or fractional reversal amount", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [], ledger: [reversalEntry({ amount: 1.5 })], users: [userDoc()] }),
    )
    expect(page.findings.map((f) => f.type)).toContain("unexpected_ledger_entry")
  })

  it("detects a billing period with no expected grant", async () => {
    const periodEnd = NOW + 5 * 86_400_000
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [], ledger: [], subscriptions: [activeSub({ currentPeriodEnd: periodEnd, updatedAt: OLD })], users: [userDoc()] }),
    )
    const f = page.findings.find((x) => x.type === "subscription_period_mismatch")
    expect(f).toBeTruthy()
    expect(f!.expected).toContain(periodGrantKey("sub_1", periodEnd))
  })

  it("detects an active subscription whose account is gone", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [], ledger: [], subscriptions: [activeSub({ userId: "u_ghost" })], users: [] }),
    )
    expect(page.findings.map((f) => f.type)).toContain("subscription_mismatch")
  })

  it("detects a balance split that no longer adds up", async () => {
    const periodEnd = NOW + 5 * 86_400_000
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        payments: [],
        ledger: [grantEntry({ id: "ledger_s", transactionType: "subscription_grant", creditType: "subscription", referenceId: "sub_1", idempotencyKey: periodGrantKey("sub_1", periodEnd), amount: 5000 })],
        subscriptions: [activeSub({ currentPeriodEnd: periodEnd })],
        users: [userDoc({ credits: 9_000, subscriptionCredits: 4_000, permanentCredits: 4_000 })],
      }),
    )
    expect(page.findings.map((f) => f.type)).toContain("ledger_balance_mismatch")
  })
})

describe("webhook queue findings", () => {
  const hook = (over: Doc = {}): Doc => ({
    id: "evt_1",
    webhookId: "wh_1",
    eventType: "payment.succeeded",
    status: "failed",
    receivedAt: OLD,
    attempts: 1,
    payload: { data: { secret: "customer@example.com" } },
    ...over,
  })

  it("reports unresolved, failed and manual-review events separately", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({
        webhooks: [hook({ id: "evt_f" }), hook({ id: "evt_u", status: "unresolved" }), hook({ id: "evt_m", status: "manual_review", attempts: 6 })],
      }),
    )
    expect(types(page.findings)).toEqual(["webhook_failed_recovery", "webhook_manual_review", "webhook_unresolved"])
    expect(page.summary.retryable).toBe(2)
    expect(page.summary.requiresManualReview).toBe(1)
    const manual = page.findings.find((f) => f.type === "webhook_manual_review")
    expect(manual!.resolution).toBe("under_review")
    expect(manual!.severity).toBe("warning")
  })

  it("never surfaces webhook payloads in findings", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ webhooks: [hook()] }))
    const serialized = JSON.stringify(page.findings)
    expect(serialized).not.toContain("customer@example.com")
    expect(serialized).not.toContain("secret")
  })

  it("a fresh 'received' event is in flight, not a finding; a stale one needs recovery", async () => {
    const fresh = await reconcileFinances({ now: NOW }, collections({ webhooks: [hook({ id: "evt_r", status: "received", receivedAt: NOW - 60_000 })] }))
    expect(fresh.findings).toEqual([])
    const stale = await reconcileFinances({ now: NOW }, collections({ webhooks: [hook({ id: "evt_r2", status: "received", receivedAt: OLD })] }))
    expect(types(stale.findings)).toEqual(["webhook_failed_recovery"])
  })

  it("an event whose type is not safely re-processable is never called retryable", async () => {
    const page = await reconcileFinances({ now: NOW }, collections({ webhooks: [hook({ id: "evt_x", eventType: "dispute.opened" })] }))
    expect(page.summary.retryable).toBe(0)
    expect(page.summary.requiresManualReview).toBe(1)
    expect(page.findings[0].description).toMatch(/not safely re-processable/)
  })
})

describe("bounded, paginated, read-only", () => {
  function many(count: number) {
    return Array.from({ length: count }, (_, i) => packPayment({ id: `pay_${i}`, dodoPaymentId: `pay_ext_${i}`, createdAt: OLD + i }))
  }

  it("reads at most windowSize records per source", async () => {
    const page = await reconcileFinances({ now: NOW, windowSize: 10 }, collections({ payments: many(25), users: [userDoc()] }))
    expect(page.scanned.payments).toBe(10)
    expect(page.window.more).toBe(true)
    expect(page.window.nextCursor).toBeTruthy()
  })

  it("walks pages with the returned cursor and never repeats a record", async () => {
    const cols = collections({ payments: many(25), users: [userDoc()] })
    const first = await reconcileFinances({ now: NOW, windowSize: 10 }, cols)
    const second = await reconcileFinances({ now: NOW, windowSize: 10, cursor: first.window.nextCursor }, cols)
    const third = await reconcileFinances({ now: NOW, windowSize: 10, cursor: second.window.nextCursor }, cols)
    const ids = [first, second, third].flatMap((p) => p.findings.map((f) => f.referenceId))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(25)
    expect(third.window.nextCursor).toBeNull()
  })

  it("clamps an oversized window instead of scanning the collection", async () => {
    const page = await reconcileFinances({ now: NOW, windowSize: 100_000 }, collections({ payments: many(3), users: [userDoc()] }))
    expect(page.window.size).toBe(MAX_WINDOW_SIZE)
  })

  it("an invalid cursor degrades to the first page rather than throwing", async () => {
    const page = await reconcileFinances({ now: NOW, windowSize: 5, cursor: "not-a-real-cursor" }, collections({ payments: many(3), users: [userDoc()] }))
    expect(page.window.offset).toBe(0)
  })

  it("filters by type and severity without extra scans", async () => {
    const page = await reconcileFinances(
      { now: NOW, types: ["payment_without_grant"] },
      collections({ payments: [packPayment(), refundRow({ originalPaymentId: undefined })], users: [userDoc()] }),
    )
    expect(types(page.findings)).toEqual(["payment_without_grant"])
    // byType still reports everything the scan observed.
    expect(page.summary.byType.incomplete_record).toBe(1)
  })

  it("scopes the scan to one account when asked", async () => {
    const page = await reconcileFinances(
      { now: NOW, userId: "u2" },
      collections({ payments: [packPayment(), packPayment({ id: "pay_b", dodoPaymentId: "pay_2", userId: "u2" })], users: [userDoc({ id: "u2" })] }),
    )
    expect(page.findings.map((f) => f.referenceId)).toEqual(["pay_2"])
    expect(page.findings.every((f) => f.userId === "u2")).toBe(true)
  })

  it("is read-only by construction (the fakes have no writes)", async () => {
    const page = await reconcileFinances(
      { now: NOW },
      collections({ payments: [packPayment()], ledger: [reversalEntry()], subscriptions: [activeSub()], users: [userDoc()] }),
    )
    expect(page.readOnly).toBe(true)
    expect(page.note).toMatch(/Nothing was created, updated, or repaired/)
    expect(page.findings.length).toBeGreaterThan(0)
  })
})
