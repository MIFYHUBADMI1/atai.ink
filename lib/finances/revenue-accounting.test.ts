import { describe, it, expect, vi } from "vitest"

/**
 * Phase 3 — Workstream D revenue aggregation correctness (§11 "Refunds and
 * revenue"). These tests pin the DOCUMENTED basis (gross / refunds / net), the
 * no-double-netting rule, the minor→major unit conversion, currency isolation
 * and the "missing ≠ confirmed zero" rule. They also pin the DB-side `$match`
 * to the pure predicate so the admin report and the reconciliation service can
 * never disagree about what counts as money in.
 */

vi.mock("server-only", () => ({}))

import {
  COLLECTED_STATUSES,
  MINOR_UNITS_PER_MAJOR,
  isCollectionRow,
  isMoneyBearing,
  isRefundRow,
  moneyCurrency,
  moneyFiguresFromGroups,
  moneyFiguresFromRows,
  moneyMatch,
  moneyPipeline,
  remainingNetMinor,
  splitCurrencyFigures,
  type PaymentMoneyRow,
} from "@/lib/finances/revenue-accounting"

const usd = (amountMinor: number | undefined, extra: Partial<PaymentMoneyRow> = {}): PaymentMoneyRow => ({
  paymentType: "permanent_credit_pack",
  status: "succeeded",
  currency: "USD",
  amount: amountMinor,
  createdAt: 1_700_000_000_000,
  ...extra,
})

const refund = (amountMinor: number | undefined, currency = "USD"): PaymentMoneyRow => ({
  paymentType: "refund",
  status: "refunded",
  currency,
  amount: amountMinor === undefined ? undefined : -amountMinor,
  createdAt: 1_700_000_000_000,
})

describe("payment plus no refund", () => {
  it("gross is the collection, refunds are zero, net equals gross", () => {
    const figs = moneyFiguresFromRows([usd(5000)])
    expect(figs.USD).toMatchObject({ gross: 50, refunds: 0, net: 50, collectionRows: 1, refundRows: 0 })
  })
})

describe("payment plus full refund", () => {
  const rows = [usd(5000), refund(5000)]
  it("keeps the collection in gross and subtracts the refund exactly once", () => {
    const figs = moneyFiguresFromRows(rows)
    expect(figs.USD).toMatchObject({ gross: 50, refunds: 50, net: 0, rows: 2, collectionRows: 1, refundRows: 1 })
    expect(figs.USD.net).toBeCloseTo(figs.USD.gross - figs.USD.refunds, 10)
  })
})

describe("payment plus partial refund", () => {
  it("nets only the refunded share", () => {
    const figs = moneyFiguresFromRows([usd(5000), refund(1250)])
    expect(figs.USD).toMatchObject({ gross: 50, refunds: 12.5, net: 37.5 })
  })

  it("several partial refunds accumulate without re-netting the original", () => {
    const figs = moneyFiguresFromRows([usd(5000), refund(1000), refund(2000)])
    expect(figs.USD).toMatchObject({ gross: 50, refunds: 30, net: 20, refundRows: 2 })
  })
})

describe("duplicate refund handling", () => {
  it("two DIFFERENT confirmed refunds are two distinct subtractions", () => {
    const figs = moneyFiguresFromRows([usd(5000), refund(1000), refund(1000)])
    expect(figs.USD.refunds).toBe(20)
  })

  it("a refund row is never also counted as a collection", () => {
    const rows = [usd(5000), refund(1000)]
    const figs = moneyFiguresFromRows(rows)
    expect(figs.USD.collectionRows).toBe(1)
    expect(figs.USD.gross).toBe(50)
    expect(isCollectionRow(refund(1000))).toBe(false)
    expect(isRefundRow(usd(5000))).toBe(false)
  })
})

describe("failed and cancelled payments are not revenue", () => {
  it("excludes every non-collected state", () => {
    const rows = [
      usd(5000, { status: "failed" }),
      usd(5000, { status: "cancelled" }),
      usd(5000, { status: "pending" }),
      usd(5000, { status: "processing" }),
    ]
    expect(moneyFiguresFromRows(rows)).toEqual({})
    for (const row of rows) expect(isMoneyBearing(row)).toBe(false)
  })

  it("includes exactly the documented collected states", () => {
    for (const status of COLLECTED_STATUSES) {
      expect(isMoneyBearing(usd(5000, { status }))).toBe(true)
    }
  })
})

describe("the database $match mirrors the pure predicate", () => {
  /** Minimal in-memory evaluator for the operators moneyMatch() emits. */
  function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, cond] of Object.entries(filter)) {
      if (key === "$or") {
        if (!(cond as Record<string, unknown>[]).some((branch) => matches(row, branch))) return false
        continue
      }
      if (key === "createdAt") {
        const gte = (cond as { $gte: number }).$gte
        if (typeof row.createdAt !== "number" || row.createdAt < gte) return false
        continue
      }
      if (key === "paymentType" || key === "status") {
        const actual = row[key]
        // MongoDB equality shorthand (branch `{ paymentType: "refund" }`).
        if (typeof cond === "string") {
          if (actual !== cond) return false
          continue
        }
        const c = cond as { $ne?: string; $in?: string[] }
        if (c.$ne !== undefined && actual === c.$ne) return false
        if (c.$in !== undefined && !c.$in.includes(String(actual))) return false
        continue
      }
      throw new Error(`revenue-accounting test: unsupported $match key "${key}" — extend the evaluator deliberately`)
    }
    return true
  }

  const corpus: PaymentMoneyRow[] = [
    usd(5000),
    usd(5000, { status: "partially_refunded" }),
    usd(5000, { status: "refunded" }),
    usd(5000, { status: "failed" }),
    usd(5000, { status: "cancelled" }),
    usd(5000, { status: "pending" }),
    usd(5000, { paymentType: "subscription" }),
    usd(5000, { paymentType: undefined }),
    refund(5000),
    { ...usd(5000), createdAt: 1_600_000_000_000 },
    { ...refund(1000), createdAt: 1_600_000_000_000 },
    { ...usd(5000, { status: "failed" }), createdAt: undefined },
  ]

  for (const since of [undefined, 1_650_000_000_000]) {
    it(`selects the same rows as isMoneyBearing (since=${since ?? "all time"})`, () => {
      const filter = moneyMatch(since)
      for (const row of corpus) {
        expect(matches(row as Record<string, unknown>, filter)).toBe(isMoneyBearing(row, since))
      }
    })
  }

  it("the aggregation pipeline uses that same match", () => {
    const pipeline = moneyPipeline(1_650_000_000_000) as Array<Record<string, unknown>>
    expect(pipeline[0]).toEqual({ $match: moneyMatch(1_650_000_000_000) })
    expect(pipeline[1]).toHaveProperty("$group")
  })
})

describe("the grouped (database-side) reduction equals the row-side reduction", () => {
  it("gross/refunds/net agree for a mixed corpus", () => {
    const rows: PaymentMoneyRow[] = [
      usd(5000),
      usd(1000, { paymentType: "subscription" }),
      usd(5000, { status: "failed" }),
      refund(1250),
      { currency: "EUR", paymentType: "permanent_credit_pack", status: "succeeded", amount: 4500, createdAt: 1 },
      { currency: "eur", paymentType: "refund", status: "refunded", amount: -500, createdAt: 1 },
      { currency: "USD", paymentType: "permanent_credit_pack", status: "succeeded", createdAt: 1 },
    ]
    const byRow = moneyFiguresFromRows(rows)

    // Build the group rows the database would return for the same corpus.
    const groups = new Map<string, { currency: string; kind: "collection" | "refund"; minor: number; rows: number; unknownAmountRows: number }>()
    for (const row of rows) {
      if (!isMoneyBearing(row)) continue
      const kind = isRefundRow(row) ? "refund" : "collection"
      const currency = moneyCurrency(row)
      const key = `${currency}|${kind}`
      const g = groups.get(key) ?? { currency, kind, minor: 0, rows: 0, unknownAmountRows: 0 }
      g.rows += 1
      if (typeof row.amount === "number") g.minor += row.amount
      else g.unknownAmountRows += 1
      groups.set(key, g)
    }
    const byGroups = moneyFiguresFromGroups(
      [...groups.values()].map((g) => ({ _id: { currency: g.currency, kind: g.kind }, minor: g.minor, rows: g.rows, unknownAmountRows: g.unknownAmountRows })),
    )
    expect(byGroups).toEqual(byRow)

    expect(byRow.USD).toMatchObject({ gross: 60, refunds: 12.5, net: 47.5, unknownAmountRows: 1 })
    expect(byRow.EUR).toMatchObject({ gross: 45, refunds: 5, net: 40 })
  })
})

describe("mixed currencies remain separated", () => {
  it("non-USD never enters the USD headline", () => {
    const figs = moneyFiguresFromRows([usd(5000), { ...usd(10000), currency: "EUR" }])
    const { headline, otherCurrencies } = splitCurrencyFigures(figs)
    expect(headline.gross).toBe(50)
    expect(otherCurrencies).toHaveLength(1)
    expect(otherCurrencies[0]).toMatchObject({ currency: "EUR", gross: 100 })
  })

  it("a lower-case currency code normalizes to the same bucket", () => {
    const figs = moneyFiguresFromRows([{ ...usd(5000), currency: "usd" }])
    expect(figs.USD).toMatchObject({ gross: 50 })
  })

  it("an absent currency is reported as UNKNOWN, never assumed USD", () => {
    const figs = moneyFiguresFromRows([{ paymentType: "permanent_credit_pack", status: "succeeded", amount: 5000 }])
    expect(figs.USD).toBeUndefined()
    expect(figs.UNKNOWN).toMatchObject({ gross: 50 })
    expect(splitCurrencyFigures(figs).otherCurrencies.map((c) => c.currency)).toEqual(["UNKNOWN"])
  })
})

describe("units and missing amounts", () => {
  it("converts provider minor units to major units exactly once", () => {
    expect(MINOR_UNITS_PER_MAJOR).toBe(100)
    expect(moneyFiguresFromRows([usd(1)]).USD.gross).toBe(0.01)
  })

  it("a row with no amount is reported, not summed as a confirmed zero", () => {
    const figs = moneyFiguresFromRows([usd(5000), { ...usd(undefined) }])
    expect(figs.USD).toMatchObject({ gross: 50, rows: 2, unknownAmountRows: 1 })
  })

  it("remaining net is null when the original amount is unknown", () => {
    expect(remainingNetMinor(5000, undefined)).toBe(5000)
    expect(remainingNetMinor(5000, 1250)).toBe(3750)
    expect(remainingNetMinor(undefined, 1250)).toBeNull()
  })
})
