/**
 * Phase A2 — link subscription payments to the credits they actually granted,
 * and reverse those grants safely on refund (M-14).
 *
 * The credit ledger remains the only balance authority. This module never
 * computes a grant from today's catalog: it records the ledger entry that was
 * actually written and, for refunds, debits the exact credit buckets created
 * by that grant. Permanent credits and other subscriptions are never touched.
 *
 * @module lib/billing/subscription-payment-grants
 */

import type { ClientSession } from "mongodb"
import {
  creditLedgerCol,
  paymentRecordsCol,
  subscriptionRecordsCol,
} from "@/lib/db/collections"
import { reverseCredits, type CreditReversalResult } from "@/lib/billing/credit-service"
import { logger } from "@/lib/logging/logger"
import type { CreditLedgerEntry, PaymentRecord } from "@/lib/billing/billing-types"

/** How close a payment timestamp must be to a grant period to link them. */
export const GRANT_LINK_WINDOW_MS = 48 * 60 * 60 * 1000

export function subscriptionGrantIdempotencyKey(subscriptionId: string, periodEnd: number): string {
  return `sub_grant_${subscriptionId}_period_${Math.floor(periodEnd / 86_400_000)}`
}

export async function findSubscriptionGrantEntry(
  subscriptionId: string,
  periodEnd: number,
): Promise<CreditLedgerEntry | null> {
  const col = await creditLedgerCol()
  return col.findOne({ idempotencyKey: subscriptionGrantIdempotencyKey(subscriptionId, periodEnd) })
}

function paymentAnchor(payment: PaymentRecord): number {
  return payment.providerCreatedAt ?? payment.createdAt
}

function isFullyGranted(payment: PaymentRecord): boolean {
  if (payment.grantStatus === "granted") return true
  return (
    typeof payment.creditsAllocated === "number" &&
    (payment.creditsGranted ?? 0) >= payment.creditsAllocated
  )
}

function alreadyLinked(payment: PaymentRecord, ref: string): boolean {
  return (
    payment.grantLedgerEntryIds?.includes(ref) === true ||
    payment.grantIdempotencyKeys?.includes(ref) === true
  )
}

function statusForGrant(granted: number, allocated: number): "granted" | "partially_granted" {
  return granted >= allocated ? "granted" : "partially_granted"
}

/** A payment with a known paid period may only absorb grants inside it. */
function periodFitsPayment(payment: PaymentRecord, periodStart: number): boolean {
  if (typeof payment.paidPeriodStart !== "number" || typeof payment.paidPeriodEnd !== "number") {
    return true
  }
  return periodStart >= payment.paidPeriodStart && periodStart < payment.paidPeriodEnd
}

export interface LinkGrantParams {
  userId: string
  subscriptionId: string
  planId: string
  /** The individual grant period (one month for annual issuance). */
  periodStart: number
  periodEnd: number
  /** Credits actually written to the ledger by this grant. */
  amount: number
  /** Total credits the payment entitles (annual total / monthly allocation). */
  creditsAllocated?: number
  /** The paid period the payment covers (annual: a year). */
  paidPeriodStart?: number
  paidPeriodEnd?: number
  ledgerEntryId?: string
  ledgerIdempotencyKey?: string
  bucketId?: string
  /** Authoritative payment id when the provider supplied one. */
  paymentId?: string
  method?: PaymentRecord["grantLinkMethod"]
  now?: number
}

export interface LinkGrantResult {
  linked: boolean
  reason?: string
  payment?: PaymentRecord | null
}

/**
 * Attach one real ledger grant to the subscription payment that funded it.
 * Idempotent: linking the same ledger entry twice cannot increment
 * `creditsGranted` twice.
 */
export async function linkSubscriptionGrantToPayment(params: LinkGrantParams): Promise<LinkGrantResult> {
  const payCol = await paymentRecordsCol()
  const ledgerRef = params.ledgerEntryId ?? params.ledgerIdempotencyKey
  const now = params.now ?? Date.now()

  // The ledger entry is authoritative. When we have its id, verify it belongs
  // to this subscription and is really a subscription grant before letting a
  // payment absorb it.
  let grantAmount = params.amount
  if (params.ledgerEntryId) {
    const entry = await (await creditLedgerCol()).findOne({ id: params.ledgerEntryId })
    if (entry) {
      if (entry.referenceId && entry.referenceId !== params.subscriptionId) {
        return { linked: false, reason: "grant_subscription_mismatch" }
      }
      if (
        (entry.direction && entry.direction !== "credit") ||
        (entry.transactionType && entry.transactionType !== "subscription_grant")
      ) {
        return { linked: false, reason: "not_a_subscription_grant" }
      }
      if (Number.isFinite(entry.amount) && entry.amount !== params.amount) {
        return { linked: false, reason: "grant_amount_mismatch" }
      }
      grantAmount = entry.amount
    }
  }

  let payment: PaymentRecord | null = null
  let method: PaymentRecord["grantLinkMethod"] = params.method ?? "subscription_period"

  if (params.paymentId) {
    payment = await payCol.findOne({ dodoPaymentId: params.paymentId })
    if (payment?.subscriptionId && payment.subscriptionId !== params.subscriptionId) {
      return { linked: false, reason: "payment_subscription_mismatch" }
    }
    if (payment && payment.status !== "succeeded" && payment.status !== "partially_refunded") {
      return { linked: false, reason: "payment_not_linkable" }
    }
    if (payment && !periodFitsPayment(payment, params.periodStart)) {
      return { linked: false, reason: "grant_outside_paid_period" }
    }
    method = params.method ?? "payment_id"
  } else {
    const candidates = await payCol
      .find({
        subscriptionId: params.subscriptionId,
        paymentType: "subscription",
        status: { $in: ["succeeded", "partially_refunded"] },
      })
      .sort({ providerCreatedAt: -1, createdAt: -1 })
      .limit(20)
      .toArray()

    // A payment already covering this paid period wins. This is the only
    // deterministic match for annual months 1..N, whose grant timestamps are
    // far from the original annual payment.
    const containing = candidates.filter((candidate) => {
      if (isFullyGranted(candidate) || candidate.grantStatus === "needs_review") return false
      if (ledgerRef && alreadyLinked(candidate, ledgerRef)) return true
      return (
        typeof candidate.paidPeriodStart === "number" &&
        typeof candidate.paidPeriodEnd === "number" &&
        params.periodStart >= candidate.paidPeriodStart &&
        params.periodStart < candidate.paidPeriodEnd
      )
    })

    if (containing.length > 1) {
      return { linked: false, reason: "ambiguous_payment" }
    }

    if (containing.length === 1) {
      payment = containing[0]
      method = params.method ?? "subscription_period"
    } else {
      const nearby = candidates
        .filter((candidate) => {
          if (isFullyGranted(candidate) || candidate.grantStatus === "needs_review") return false
          if (!periodFitsPayment(candidate, params.periodStart)) return false
          if (ledgerRef && alreadyLinked(candidate, ledgerRef)) return true
          return Math.abs(paymentAnchor(candidate) - params.periodStart) <= GRANT_LINK_WINDOW_MS
        })
        .sort(
          (a, b) =>
            Math.abs(paymentAnchor(a) - params.periodStart) -
            Math.abs(paymentAnchor(b) - params.periodStart),
        )

      if (nearby.length === 0) return { linked: false, reason: "no_payment_candidate" }
      if (nearby.length > 1) {
        const first = Math.abs(paymentAnchor(nearby[0]) - params.periodStart)
        const second = Math.abs(paymentAnchor(nearby[1]) - params.periodStart)
        // Only link when the nearest candidate is clearly the one. Two equally
        // plausible payments must go to review, never to a guessed link.
        if (first > GRANT_LINK_WINDOW_MS || first * 2 > second) {
          return { linked: false, reason: "ambiguous_payment" }
        }
      }
      payment = nearby[0]
    }
  }

  if (!payment) return { linked: false, reason: "no_payment_candidate" }
  if (payment.grantStatus === "needs_review") {
    return { linked: false, reason: "payment_needs_review" }
  }
  if (isFullyGranted(payment)) {
    return { linked: true, payment }
  }
  if (ledgerRef && alreadyLinked(payment, ledgerRef)) {
    return { linked: true, payment }
  }

  const allocated = params.creditsAllocated ?? payment.creditsAllocated ?? grantAmount
  const granted = (payment.creditsGranted ?? 0) + grantAmount
  const status = statusForGrant(granted, allocated)

  const set: Record<string, unknown> = {
    creditType: "subscription",
    grantStatus: status,
    grantedAt: payment.grantedAt ?? now,
    grantLinkMethod: method,
    creditsAllocated: allocated,
  }
  if (!payment.userId && params.userId) set.userId = params.userId
  if (payment.paidPeriodStart == null) {
    set.paidPeriodStart = params.paidPeriodStart ?? params.periodStart
  }
  if (payment.paidPeriodEnd == null) {
    set.paidPeriodEnd = params.paidPeriodEnd ?? params.periodEnd
  }

  const addToSet: Record<string, unknown> = {}
  if (params.ledgerEntryId) addToSet.grantLedgerEntryIds = params.ledgerEntryId
  if (params.ledgerIdempotencyKey) addToSet.grantIdempotencyKeys = params.ledgerIdempotencyKey
  if (params.bucketId) addToSet.grantBucketIds = params.bucketId

  const update: Record<string, unknown> = {
    $inc: { creditsGranted: grantAmount },
    $set: set,
  }
  if (Object.keys(addToSet).length > 0) update.$addToSet = addToSet

  const filter: Record<string, unknown> = {
    dodoPaymentId: payment.dodoPaymentId,
    // A concurrent link cannot push the payment past the credits it actually
    // bought. For an annual payment this still allows months 1..N; for a
    // monthly payment it makes a second period's grant fail the filter.
    // `$or` keeps a brand-new payment (no creditsGranted field) eligible.
    $or: [
      { creditsGranted: { $exists: false } },
      { creditsGranted: { $lt: allocated } },
    ],
  }
  if (ledgerRef) {
    // Conditional on the grant not already being linked. The unique ledger
    // idempotency key makes the grant itself single; this makes the payment
    // increment single too.
    filter.grantLedgerEntryIds = { $ne: ledgerRef }
  }

  const result = await payCol.updateOne(filter, update)
  if (result.matchedCount === 0 && ledgerRef) {
    const fresh = await payCol.findOne({ dodoPaymentId: payment.dodoPaymentId })
    if (fresh && alreadyLinked(fresh, ledgerRef)) return { linked: true, payment: fresh }
    return { linked: false, reason: "payment_link_race" }
  }

  if (params.ledgerEntryId) {
    await (await creditLedgerCol()).updateOne(
      { id: params.ledgerEntryId },
      { $set: { paymentId: payment.dodoPaymentId } },
    )
  }

  const fresh = await payCol.findOne({ dodoPaymentId: payment.dodoPaymentId })
  logger.info("billing.payment_grant", "Subscription payment linked to its credit grant", {
    paymentId: payment.dodoPaymentId,
    subscriptionId: params.subscriptionId,
    credits: grantAmount,
    status,
  })
  return { linked: true, payment: fresh }
}

/**
 * When `payment.succeeded` arrives after the subscription grant, attach every
 * unlinked grant the payment covers. Used for both ordering directions.
 */
export async function linkPaymentToExistingGrants(payment: PaymentRecord): Promise<LinkGrantResult> {
  if (payment.paymentType !== "subscription" || !payment.subscriptionId) {
    return { linked: false, reason: "not_a_subscription_payment" }
  }
  if (payment.grantStatus === "needs_review" || isFullyGranted(payment)) {
    return { linked: false, reason: "payment_not_linkable" }
  }

  const anchor = paymentAnchor(payment)
  const sub = await (await subscriptionRecordsCol()).findOne({
    dodoSubscriptionId: payment.subscriptionId,
  })
  // An annual payment covers the whole subscription period, not a 48h
  // ingestion window: months 1..N must be able to find it later. A monthly
  // payment keeps the narrow window so it cannot absorb a later period.
  const isAnnual = sub?.billingCycle === "annual" || Boolean(sub?.purchasedTerms?.annual)
  const paidEnd =
    payment.paidPeriodEnd ??
    (isAnnual && typeof sub?.currentPeriodEnd === "number"
      ? sub.currentPeriodEnd
      : Math.min(
          sub?.currentPeriodEnd ?? anchor + GRANT_LINK_WINDOW_MS,
          anchor + GRANT_LINK_WINDOW_MS,
        ))
  const paidStart =
    payment.paidPeriodStart ??
    (isAnnual && typeof sub?.currentPeriodStart === "number"
      ? sub.currentPeriodStart
      : anchor - GRANT_LINK_WINDOW_MS)

  const grants = await (await creditLedgerCol())
    .find({
      transactionType: "subscription_grant",
      referenceId: payment.subscriptionId,
      direction: "credit",
    })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray()

  const candidates = grants.filter((grant) => {
    if (grant.paymentId) return false
    if (grant.createdAt < anchor - GRANT_LINK_WINDOW_MS) return false
    if (grant.createdAt > paidEnd + GRANT_LINK_WINDOW_MS) return false
    return true
  })

  if (candidates.length === 0) return { linked: false, reason: "no_grant_candidate" }

  let linked = false
  let current = payment
  for (const grant of candidates) {
    if (isFullyGranted(current)) break
    const periodStart = Number(grant.metadata?.periodStart ?? grant.createdAt)
    const periodEnd = Number(grant.metadata?.periodEnd ?? periodStart)
    const bucketId = typeof grant.metadata?.bucketId === "string" ? grant.metadata.bucketId : undefined
    const result = await linkSubscriptionGrantToPayment({
      userId: payment.userId,
      subscriptionId: payment.subscriptionId,
      planId: String(grant.metadata?.planId ?? ""),
      periodStart,
      periodEnd,
      amount: grant.amount,
      creditsAllocated: payment.creditsAllocated ?? sub?.purchasedTerms?.annual?.totalCredits ?? sub?.purchasedTerms?.monthlyCredits,
      paidPeriodStart: paidStart,
      paidPeriodEnd: paidEnd,
      ledgerEntryId: grant.id,
      ledgerIdempotencyKey: grant.idempotencyKey,
      bucketId,
      paymentId: payment.dodoPaymentId,
      method: "ledger_reference",
    })
    if (result.linked) {
      linked = true
      if (result.payment) current = result.payment
    }
  }

  if (!linked) return { linked: false, reason: "no_linkable_grant" }
  return { linked: true, payment: await (await paymentRecordsCol()).findOne({ dodoPaymentId: payment.dodoPaymentId }) }
}

export interface SubscriptionReversalResult
  extends Omit<CreditReversalResult, "bucketDeductions"> {
  bucketDeductions: Array<{ bucketId?: string; subscriptionId: string; amount: number }>
}

/**
 * Reverse subscription credits from the exact buckets created by the linked
 * grant(s). Maintains the flat `subscriptionCredits`/`credits` fields and the
 * bucket amounts in one transaction, and records one ledger debit keyed by
 * the refund. Permanent credits and unrelated subscriptions are untouched.
 *
 * If the grant's bucket was already consumed or expired, only what remains is
 * reversed; the caller records that as a partial/unresolved credit reversal.
 */
export async function reverseSubscriptionCredits(params: {
  userId: string
  subscriptionId: string
  amount: number
  bucketIds?: string[]
  idempotencyKey: string
  referenceType?: string
  referenceId?: string
  metadata?: Record<string, unknown>
  now?: number
  /** Join an existing transaction instead of opening one. */
  session?: ClientSession
}): Promise<SubscriptionReversalResult> {
  const result = await reverseCredits({
    userId: params.userId,
    creditType: "subscription",
    amount: params.amount,
    transactionType: "refund_reversal",
    idempotencyKey: params.idempotencyKey,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    metadata: params.metadata,
    bucketIds: params.bucketIds,
    subscriptionId: params.subscriptionId,
    paymentId:
      typeof params.metadata?.originalPaymentId === "string"
        ? params.metadata.originalPaymentId
        : undefined,
    session: params.session,
    now: params.now,
  })

  return {
    ...result,
    reason:
      result.reason ??
      (result.success && result.actualReversed < params.amount ? "partially_consumed" : undefined),
    bucketDeductions: result.bucketDeductions.map((deduction) => ({
      ...deduction,
      subscriptionId: deduction.subscriptionId ?? params.subscriptionId,
    })),
  }
}
