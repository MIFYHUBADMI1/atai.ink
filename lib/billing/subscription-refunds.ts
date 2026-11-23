/**
 * Pure refund/grant planning for subscription payments (Phase A2 / M-14).
 *
 * These helpers never touch the database. They decide how many credits a
 * refund may reverse from the credits actually granted by the original
 * payment — never from today's catalog, the customer's current plan, or the
 * webhook payload.
 *
 * @module lib/billing/subscription-refunds
 */

import type { PaymentRecord } from "./billing-types"

export interface SubscriptionRefundPlan {
  ok: boolean
  reason?: string
  /** Credits the refund should try to reverse (capped at the actual grant). */
  creditsToReverse: number
  /** True when the refund covers the full original amount. */
  fullRefund: boolean
  /** True when the provider supplied a partial amount. */
  partialRefund: boolean
  /** Set when the credit side needs manual review even if a reversal occurs. */
  reviewReason?: string
}

/**
 * Plan a refund against a subscription payment's ACTUAL recorded grant.
 *
 * - `creditsGranted` is the sum of ledger grants linked to the payment.
 * - `creditsReversed` prevents multiple refunds from exceeding that grant.
 * - A partial refund is proportional to the original amount, then capped at
 *   the remaining grant. No amount is derived from the plan catalog.
 */
export function planSubscriptionRefund(input: {
  creditsGranted: number
  creditsReversed?: number
  originalAmount?: number
  refundAmount?: number
  grantStatus?: PaymentRecord["grantStatus"]
}): SubscriptionRefundPlan {
  if (input.grantStatus === "needs_review") {
    return {
      ok: false,
      reason: "grant_history_unresolved",
      creditsToReverse: 0,
      fullRefund: false,
      partialRefund: false,
      reviewReason: "historical_grant_unknown",
    }
  }

  const granted = Number.isFinite(input.creditsGranted)
    ? Math.max(0, Math.floor(input.creditsGranted))
    : 0
  if (granted <= 0) {
    return {
      ok: false,
      reason: "no_recorded_grant",
      creditsToReverse: 0,
      fullRefund: false,
      partialRefund: false,
      reviewReason: "no_recorded_grant",
    }
  }

  const alreadyReversed = Math.max(0, Math.floor(input.creditsReversed ?? 0))
  const remaining = Math.max(0, granted - alreadyReversed)
  if (remaining <= 0) {
    return {
      ok: false,
      reason: "already_reversed",
      creditsToReverse: 0,
      fullRefund: true,
      partialRefund: false,
    }
  }

  const originalAmount = input.originalAmount
  const refundAmount = input.refundAmount
  if (
    typeof refundAmount === "number" &&
    refundAmount > 0 &&
    (typeof originalAmount !== "number" || originalAmount <= 0)
  ) {
    return {
      ok: false,
      reason: "original_amount_missing",
      creditsToReverse: 0,
      fullRefund: false,
      partialRefund: false,
      reviewReason: "original_amount_missing",
    }
  }
  const partialRefund =
    typeof originalAmount === "number" &&
    originalAmount > 0 &&
    typeof refundAmount === "number" &&
    refundAmount > 0 &&
    refundAmount < originalAmount

  const requested = partialRefund
    ? Math.max(1, Math.floor((granted * (refundAmount as number)) / (originalAmount as number)))
    : granted

  const creditsToReverse = Math.min(remaining, requested)
  const fullRefund = !partialRefund && creditsToReverse >= remaining

  return {
    ok: true,
    creditsToReverse,
    fullRefund,
    partialRefund,
    ...(partialRefund && creditsToReverse < requested
      ? { reviewReason: "partial_refund_exceeds_remaining_grant" }
      : {}),
  }
}

export type HistoricalGrantPlan =
  | {
      action: "link"
      creditsGranted: number
      ledgerEntryIds: string[]
      bucketIds: string[]
      grantStatus: "granted" | "partially_granted"
    }
  | { action: "review"; reason: string }

/**
 * Decide how to reconcile a historical subscription payment that has no
 * recorded `creditsGranted`. A single unambiguous ledger grant can be linked;
 * anything else is marked for review. Nothing is invented.
 */
export function planHistoricalGrantReconciliation(input: {
  payment: Pick<PaymentRecord, "creditsGranted" | "grantStatus" | "paymentType" | "status">
  grants: Array<{
    id?: string
    amount: number
    idempotencyKey?: string
    metadata?: Record<string, unknown>
  }>
}): HistoricalGrantPlan {
  if (input.payment.paymentType !== "subscription") {
    return { action: "review", reason: "not_a_subscription_payment" }
  }
  if (input.payment.grantStatus === "needs_review") {
    return { action: "review", reason: "already_flagged" }
  }
  if ((input.payment.creditsGranted ?? 0) > 0) {
    return { action: "review", reason: "already_has_grant_amount" }
  }

  const unique = new Map<string, (typeof input.grants)[number]>()
  for (const grant of input.grants) {
    const key = grant.id ?? grant.idempotencyKey
    if (!key) continue
    if (!Number.isFinite(grant.amount) || grant.amount <= 0) continue
    unique.set(key, grant)
  }

  if (unique.size !== 1) {
    return {
      action: "review",
      reason: unique.size === 0 ? "no_matching_grant" : "ambiguous_matching_grant",
    }
  }

  const [grant] = [...unique.values()]
  const bucketId = grant.metadata?.bucketId
  return {
    action: "link",
    creditsGranted: grant.amount,
    ledgerEntryIds: grant.id ? [grant.id] : [],
    bucketIds: typeof bucketId === "string" ? [bucketId] : [],
    grantStatus: "granted",
  }
}
