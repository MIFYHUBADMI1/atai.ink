import { describe, expect, it } from "vitest"

import {
  CREDIT_BACK_REVERSAL_TRANSACTION_TYPES,
  CREDIT_REVERSAL_TRANSACTION_TYPES,
  CLAWBACK_REVERSAL_TRANSACTION_TYPES,
  expectedReversalDirection,
} from "@/lib/billing/reversal-types"

/**
 * Phase 3 — the shared reversal vocabulary (Workstream C/D/F).
 *
 * Admin reports, project economics and reconciliation all read ledger
 * reversals through this module. The one thing that must never drift is which
 * direction each type is actually written with: a clawback summed as a refund
 * inverts a real movement and nets the same money twice.
 */

describe("reversal vocabulary", () => {
  it("the union is exactly the credit-back rows plus the clawback rows", () => {
    expect([...CREDIT_REVERSAL_TRANSACTION_TYPES].sort()).toEqual(
      [...CREDIT_BACK_REVERSAL_TRANSACTION_TYPES, ...CLAWBACK_REVERSAL_TRANSACTION_TYPES].sort(),
    )
  })

  it("the two direction groups never overlap", () => {
    const overlap = CREDIT_BACK_REVERSAL_TRANSACTION_TYPES.filter((t) =>
      (CLAWBACK_REVERSAL_TRANSACTION_TYPES as readonly string[]).includes(t),
    )
    expect(overlap).toEqual([])
  })

  it("direction is declared for every reversal type and for nothing else", () => {
    for (const t of CREDIT_REVERSAL_TRANSACTION_TYPES) {
      expect(expectedReversalDirection(t)).toBeTypeOf("string")
    }
    expect(expectedReversalDirection("runtime_usage")).toBeUndefined()
    expect(expectedReversalDirection("credit_purchase")).toBeUndefined()
    expect(expectedReversalDirection("")).toBeUndefined()
  })

  it("matches the writers: refunds credit, the Dodo clawback debits", () => {
    // grantCredits writers → "credit"; reverseCredits writer → "debit".
    expect(expectedReversalDirection("runtime_refund")).toBe("credit")
    expect(expectedReversalDirection("other_reversal")).toBe("credit")
    expect(expectedReversalDirection("build_release")).toBe("credit")
    expect(expectedReversalDirection("build_refund")).toBe("credit")
    expect(expectedReversalDirection("refund_reversal")).toBe("debit")
  })
})
