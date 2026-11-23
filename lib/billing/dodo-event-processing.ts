import { ObjectId, type ClientSession } from "mongodb"
import { paymentRecordsCol, subscriptionRecordsCol, creditLedgerCol } from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { buildUpdate } from "@/lib/db/update"
import {
  grantCredits,
  grantSubscriptionCredits,
  expireSubscriptionCredits,
  reverseCredits,
} from "@/lib/billing/credit-service"
import { getLegacySubscriptionPlans } from "@/lib/billing/config"
import { resolveCommercialProduct } from "@/lib/billing/entitlements/commercial-plans"
import { addMonths } from "@/lib/billing/entitlements/annual-scheduler"
import { activatePaidSubscription } from "@/lib/billing/activate-subscription"
import { resolveRuntimeCatalogProduct } from "@/lib/billing/catalog/runtime"
import {
  buildCatalogPurchasedTerms,
  buildCommercialPurchasedTerms,
  buildLegacyPurchasedTerms,
  buildPurchasedTermsFromRecord,
  resolveRenewalAllocation,
} from "@/lib/billing/subscription-terms"
import {
  findSubscriptionGrantEntry,
  linkPaymentToExistingGrants,
  linkSubscriptionGrantToPayment,
  reverseSubscriptionCredits,
} from "@/lib/billing/subscription-payment-grants"
import { planSubscriptionRefund } from "@/lib/billing/subscription-refunds"
import { logger } from "@/lib/logging/logger"
import { cryptoId } from "@/lib/store/id"
import type { PaymentRecord, SubscriptionRecord } from "@/lib/billing/billing-types"
import type { SubscriptionStatus, PaymentStatus } from "@/lib/billing/config"

/**
 * Atai Finance — Phase 3 authoritative Dodo event processing (Workstream A/B).
 *
 * This module is the SINGLE business-logic path for every Dodo webhook effect.
 * Both the live webhook route (`app/api/billing/webhook/route.ts`) and the
 * recovery worker (`lib/billing/webhook-recovery.ts`) call `processDodoEvent`,
 * so a replayed event always runs the same financial invariants as a live
 * delivery — never a separate, weaker code path.
 *
 * ── Financial lifecycle (documented per brief §3A) ──────────────────────
 *
 * payment.succeeded (pack)     → ledger grant `payment_${paymentId}`
 *                                 (permanent credits) + payment_records row
 *                                 status "succeeded". Unattributable (no
 *                                 trusted userId / no positive integer
 *                                 credits) → "unresolved": NO grant, NO guess.
 * payment.succeeded (sub)      → payment record linked to the exact period
 *                                 grant(s) it funded (`creditsGranted`,
 *                                 `grantLedgerEntryIds`, `grantBucketIds`).
 *                                 A grant that arrives first is linked when
 *                                 the payment lands, and vice versa.
 * payment.failed / cancelled   → payment record with provider status; never
 *                                 treated as revenue or a purchase; renewal
 *                                 failure flips the subscription to past_due
 *                                 (credits kept; Dodo retries).
 * subscription.active/renewed  → activate / expire-then-grant keyed
 *                                 `sub_grant_${subscriptionId}_period_${day}`
 *                                 — the SAME key across active & renewed for
 *                                 one cycle, so a duplicate billing period
 *                                 event can never grant twice.
 * subscription.cancelled/…     → status transitions only (no credit change;
 *                                 credits remain until natural expiry).
 * refund.succeeded             → refund row is a SEPARATE payment_records row
 *                                 (never overwrites the original payment).
 *                                 Subscription refunds reverse the credits
 *                                 the ORIGINAL PAYMENT actually granted, from
 *                                 that grant's own buckets — never the current
 *                                 catalog or permanent credits. Missing grant
 *                                 history is marked "unresolved" for review.
 *                                 Permanent packs keep the flat-balance
 *                                 proportional reversal. Credit reversal is
 *                                 keyed `refund_${refundId}`; the original
 *                                 payment's refundedAmountMinor/status advance;
 *                                 unassociable or currency-mismatched refunds
 *                                 go "unresolved" for reconciliation.
 * refund.failed / disputes / credit.* → logged; no financial effect (Dodo-side
 *                                 accounting objects, not Atai balances).
 *
 * ── Invariants enforced by this module ──────────────────────────────────
 *
 *  1. One successful payment grants its credits at most once (unique ledger
 *     idempotencyKey; duplicates return success=true = already-applied).
 *  2. One subscription billing period grants at most once (period key).
 *  3. A failed payment is never recorded as succeeded and grants nothing.
 *  4. A refund is a new traceable row — the original payment record is never
 *     silently overwritten as if it never occurred.
 *  5. Duplicate webhook deliveries are blocked upstream by the unique
 *     webhookId index AND remain harmless here because every effect is
 *     idempotency-keyed (crash-after-write replays are no-ops).
 *  6. A persistence failure THROWS so the caller marks the event `failed` —
 *     a successful HTTP ack never implies the financial effects completed;
 *     failed events stay discoverable for the recovery workflow.
 *  7. Missing authoritative data (user, payment link, amount, currency) →
 *     explicit "unresolved"; nothing is guessed or fabricated as 0.
 *
 * Event semantics are unchanged from the Phase 1/2 live behavior except where
 * Phase 3 §4 explicitly corrected refund accounting (documented inline).
 *
 * @module lib/billing/dodo-event-processing
 */

export type DodoEventOutcome = { status: "processed" } | { status: "unresolved"; reason: string }

/** Event types whose handlers have (or may have) financial effect and can be
 * SAFELY re-run through this module by the recovery worker. Unknown/dispute/
 * informational types are never replayed — there is nothing to recompute. */
export const REPROCESSABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled",
  "subscription.active",
  "subscription.renewed",
  "subscription.cancelled",
  "subscription.past_due",
  "subscription.on_hold",
  "subscription.expired",
  "subscription.updated",
  "subscription.plan_changed",
  "refund.succeeded",
])

/**
 * Process one Dodo event. Returns "processed" or "unresolved" (with a safe,
 * secret-free reason). THROWS when a required financial write failed — the
 * caller must then mark the event `failed` so recovery can find it.
 */
export async function processDodoEvent(
  eventType: string,
  data: Record<string, unknown> | undefined,
  eventId: string,
): Promise<DodoEventOutcome> {
  switch (eventType) {
    case "payment.succeeded": {
      const reason = await handlePaymentSucceeded(data, eventId)
      return reason ? { status: "unresolved", reason } : { status: "processed" }
    }
    case "payment.failed":
      await handlePaymentFailed(data)
      return { status: "processed" }
    case "payment.processing":
      logger.info("webhook.dodo", "Payment processing", { eventId })
      return { status: "processed" }
    case "payment.cancelled":
      await handlePaymentCancelled(data)
      return { status: "processed" }
    case "subscription.active": {
      const reason = await handleSubscriptionActive(data)
      return reason ? { status: "unresolved", reason } : { status: "processed" }
    }
    case "subscription.renewed": {
      const reason = await handleSubscriptionRenewed(data)
      return reason ? { status: "unresolved", reason } : { status: "processed" }
    }
    case "subscription.cancelled":
      await handleSubscriptionCancelled(data)
      return { status: "processed" }
    case "subscription.past_due":
      await handleSubscriptionPastDue(data)
      return { status: "processed" }
    case "subscription.on_hold":
      await handleSubscriptionOnHold(data)
      return { status: "processed" }
    case "subscription.expired":
      await handleSubscriptionExpired(data)
      return { status: "processed" }
    case "subscription.updated":
      await handleSubscriptionUpdated(data)
      return { status: "processed" }
    case "subscription.plan_changed":
      await handleSubscriptionPlanChanged(data)
      return { status: "processed" }
    case "refund.succeeded": {
      const reason = await handleRefundSucceeded(data)
      return reason ? { status: "unresolved", reason } : { status: "processed" }
    }
    case "refund.failed":
      logger.warn("webhook.dodo", "Refund failed", { eventId })
      return { status: "processed" }
    case "dispute.opened":
    case "dispute.accepted":
    case "dispute.challenged":
    case "dispute.won":
    case "dispute.lost":
    case "dispute.expired":
    case "dispute.cancelled":
      logger.info("webhook.dodo", `Dispute event: ${eventType}`, { eventId })
      return { status: "processed" }
    case "credit.added":
    case "credit.deducted":
    case "credit.expired":
    case "credit.rolled_over":
      logger.info("webhook.dodo", `Credit event: ${eventType}`, { eventId })
      return { status: "processed" }
    default:
      logger.info("webhook.dodo", `Unhandled event type: ${eventType}`, { eventId })
      return { status: "processed" }
  }
}

// ─── Payment Handlers ──────────────────────────────────────────────────────────

/**
 * metadata.credits arrives from the checkout session as a STRING (the checkout
 * route writes String(pack.credits)) — Phase 3 validates it into a positive
 * integer before any grant. An unparseable/non-positive amount is a missing
 * authoritative fact → unresolved, never a guessed grant.
 */
function positiveIntegerCredits(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isInteger(n) || n <= 0) return undefined
  return n
}

/** Parse a provider ISO timestamp into epoch ms; unknown stays undefined. */
function parseProviderDate(raw: unknown): number | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Returns a safe unresolved-reason string when the verified event could not
 * be attributed to a user/payment (credits are NOT granted, nothing is
 * guessed), or `undefined` when the event was fully handled.
 */
async function handlePaymentSucceeded(
  data: Record<string, unknown> | undefined,
  _eventId: string,
): Promise<string | undefined> {
  if (!data) {
    logger.warn("webhook.dodo", "payment.succeeded: missing data")
    return "payment.succeeded payload contained no data object; nothing to attribute"
  }

  const paymentId = data.payment_id as string
  const customer = data.customer as Record<string, unknown> | undefined
  const customerId = customer?.customer_id as string
  const metadata = data.metadata as Record<string, unknown> | undefined
  const subscriptionId = data.subscription_id as string | null
  const totalAmount = data.total_amount as number | undefined
  const currency = data.currency as string | undefined

  if (subscriptionId) {
    logger.info("webhook.dodo", "Subscription payment — linking to the period grant", { paymentId, subscriptionId })
    const subCol = await subscriptionRecordsCol()
    const sub = await subCol.findOne({ dodoSubscriptionId: subscriptionId })
    const userId = (metadata?.userId as string | undefined) ?? sub?.userId
    const creditsAllocated =
      sub?.purchasedTerms?.annual?.totalCredits ?? sub?.purchasedTerms?.monthlyCredits
    const providerCreatedAt = parseProviderDate(data.created_at)
    const payment = await recordPayment({
      userId,
      dodoPaymentId: paymentId,
      dodoCustomerId: customerId,
      amount: totalAmount,
      currency,
      status: "succeeded",
      paymentType: "subscription",
      subscriptionId,
      productId: data.product_id as string,
      creditType: "subscription",
      creditsAllocated,
      providerCreatedAt,
      grantStatus: "pending",
      createdAt: Date.now(),
    })
    // The subscription event may already have granted the period. Link it now;
    // otherwise the grant handler links this payment when it arrives.
    if (payment) {
      const link = await linkPaymentToExistingGrants(payment)
      if (!link.linked) {
        logger.info("webhook.dodo", "Subscription payment awaiting its period grant", {
          paymentId,
          subscriptionId,
          reason: link.reason,
        })
      }
    }
    return undefined
  }

  const userId = metadata?.userId as string | undefined
  const packageId = metadata?.packageId as string | undefined

  if (!userId) {
    logger.warn("webhook.dodo", "payment.succeeded: missing userId", { paymentId })
    return "payment.succeeded could not be attributed (no trusted userId in metadata); preserved for reconciliation, no credits granted"
  }

  const credits = positiveIntegerCredits(metadata?.credits)
  if (credits === undefined) {
    logger.warn("webhook.dodo", "payment.succeeded: missing or non-numeric credits", { paymentId })
    return "payment.succeeded carried no authoritative positive-integer credits amount; preserved for reconciliation, no credits granted"
  }

  const result = await grantCredits({
    userId,
    creditType: "permanent",
    amount: credits,
    transactionType: "credit_purchase",
    idempotencyKey: `payment_${paymentId}`,
    referenceType: "payment",
    referenceId: paymentId,
    metadata: { packageId, dodoPaymentId: paymentId, dodoCustomerId: customerId, totalAmount, currency },
  })

  if (!result.success) {
    // A failed grant must not be reported as a completed event. The ledger
    // idempotency key makes a later replay safe (no double grant).
    throw new Error(`payment.succeeded: credit grant failed for payment ${paymentId}`)
  }

  await recordPayment({
    userId,
    dodoPaymentId: paymentId,
    dodoCustomerId: customerId,
    amount: totalAmount,
    currency,
    status: "succeeded",
    paymentType: "permanent_credit_pack",
    creditsGranted: credits,
    creditType: "permanent",
    packageId,
    grantStatus: "granted",
    grantedAt: Date.now(),
    createdAt: Date.now(),
  })
  logger.info("webhook.dodo", "Permanent credits granted", { paymentId, userId, credits })
  return undefined
}

async function handlePaymentFailed(data: Record<string, unknown> | undefined) {
  if (!data) return
  const paymentId = data.payment_id as string
  const subscriptionId = data.subscription_id as string | null
  const metadata = data.metadata as Record<string, unknown> | undefined
  const userId = metadata?.userId as string | undefined

  // Preserve authoritative provider information where Dodo provides it.
  // Unknown amounts/currencies are recorded as absent — never fabricated
  // as a confirmed $0 USD payment.
  const totalAmount = data.total_amount as number | undefined
  const currency = data.currency as string | undefined

  await recordPayment({
    dodoPaymentId: paymentId,
    amount: totalAmount,
    currency,
    status: "failed",
    paymentType: subscriptionId ? "subscription" : "unknown",
    createdAt: Date.now(),
  })

  if (subscriptionId) {
    const subCol = await subscriptionRecordsCol()
    await subCol.updateOne(
      { dodoSubscriptionId: subscriptionId },
      { $set: { status: "past_due", updatedAt: Date.now() } },
    )
    logger.warn("webhook.dodo", "Subscription renewal payment failed — marked past_due, credits kept, Dodo will retry", {
      paymentId, subscriptionId, userId,
    })
  } else {
    logger.warn("webhook.dodo", "Payment failed", { paymentId, userId })
  }
}

async function handlePaymentCancelled(data: Record<string, unknown> | undefined) {
  if (!data) return
  const paymentId = data.payment_id as string
  await recordPayment({
    dodoPaymentId: paymentId,
    amount: data.total_amount as number | undefined,
    currency: data.currency as string | undefined,
    status: "cancelled",
    paymentType: "unknown",
    createdAt: Date.now(),
  })
  logger.info("webhook.dodo", "Payment cancelled", { paymentId })
}

// ─── Subscription Handlers ─────────────────────────────────────────────────────

async function handleSubscriptionActive(data: Record<string, unknown> | undefined): Promise<string | undefined> {
  if (!data) { logger.warn("webhook.dodo", "subscription.active: missing data"); return "subscription.active payload contained no data object; nothing to attribute" }

  const subscriptionId = data.subscription_id as string
  const customer = data.customer as Record<string, unknown> | undefined
  const result = await activatePaidSubscription({
    subscriptionId,
    customerId: customer?.customer_id as string | undefined,
    productId: data.product_id as string | undefined,
    status: data.status as string | undefined,
    metadata: data.metadata as Record<string, unknown> | undefined,
    nextBillingDate: data.next_billing_date as string | undefined,
    previousBillingDate: data.previous_billing_date as string | undefined,
    paymentId: (data.payment_id ?? data.latest_payment_id) as string | undefined,
  })
  if (!result.ok) {
    logger.warn("webhook.dodo", "subscription.active: could not record", { subscriptionId, reason: result.reason })
    return `subscription.active could not be attributed: ${result.reason}; preserved for reconciliation, no credits granted`
  }
  return undefined
}

async function handleSubscriptionRenewed(data: Record<string, unknown> | undefined): Promise<string | undefined> {
  if (!data) { logger.warn("webhook.dodo", "subscription.renewed: missing data"); return "subscription.renewed payload contained no data object; nothing to attribute" }

  const subscriptionId = data.subscription_id as string
  const metadata = data.metadata as Record<string, unknown> | undefined
  const nextBillingDate = data.next_billing_date as string
  const productId = data.product_id as string | undefined
  const subCol = await subscriptionRecordsCol()
  const subscription = await subCol.findOne({ dodoSubscriptionId: subscriptionId })

  // ── Resolve the PURCHASED allocation, never today's hardcoded constants ──
  // Priority: the subscription's pinned terms, then its own stored legacy
  // allocation, then the resolved purchased product (only when no record
  // exists). Metadata `credits` is deliberately not a source of truth.
  const metadataPlanId = typeof metadata?.planId === "string" ? metadata.planId : undefined
  const legacyProduct = getLegacySubscriptionPlans().find(
    (p) => p.dodoProductId && p.dodoProductId === productId,
  )
  const runtimeProduct = await resolveRuntimeCatalogProduct({
    dodoProductId: productId,
    planId: metadataPlanId,
    billingCycle: metadata?.billingCycle === "annual" ? "annual" : "monthly",
    allowPlanFallback:
      !legacyProduct &&
      (metadata?.billingCycle === "annual" || metadata?.billingCycle === "monthly"),
  })
  const commercialMatch = resolveCommercialProduct(productId)
  const legacyPlan = metadataPlanId
    ? getLegacySubscriptionPlans().find((p) => p.id === metadataPlanId)
    : undefined
  const catalogAllocation =
    runtimeProduct && runtimeProduct.productType === "subscription"
      ? {
          planId: runtimeProduct.planId,
          planName: runtimeProduct.planName,
          commercialPlanId: runtimeProduct.commercialPlanId,
          billingCycle: runtimeProduct.billingCycle === "annual" ? ("annual" as const) : ("monthly" as const),
          monthlyCredits: runtimeProduct.monthlyCredits,
          dodoProductId: productId,
        }
      : commercialMatch
    ? {
        planId: commercialMatch.plan.id,
        planName: commercialMatch.plan.name,
        commercialPlanId: commercialMatch.plan.commercialPlanId,
        billingCycle: commercialMatch.billingCycle,
        monthlyCredits: commercialMatch.plan.mirrorCredits,
        dodoProductId: productId,
      }
    : legacyProduct || legacyPlan
      ? {
          planId: (legacyProduct ?? legacyPlan)!.id,
          planName: (legacyProduct ?? legacyPlan)!.name,
          billingCycle: metadata?.billingCycle === "annual" ? ("annual" as const) : ("monthly" as const),
          monthlyCredits: (legacyProduct ?? legacyPlan)!.mirrorCredits,
          dodoProductId: productId,
        }
      : undefined

  const resolution = resolveRenewalAllocation({ subscription, catalogAllocation })
  if (!resolution.ok) {
    logger.warn("webhook.dodo", "subscription.renewed: purchased terms unresolved", {
      subscriptionId,
      reason: resolution.reason,
    })
    return `subscription.renewed could not resolve the purchased commercial terms (${resolution.reason}); preserved for reconciliation, no credits granted`
  }

  const allocation = resolution.allocation
  const userId = allocation.userId || (metadata?.userId as string | undefined)
  if (!userId) {
    logger.warn("webhook.dodo", "subscription.renewed: no attributable user", { subscriptionId })
    return "subscription.renewed could not be attributed to a user; preserved for reconciliation, no credits granted"
  }

  const now = Date.now()
  const periodStart = parseProviderDate(data.previous_billing_date) ?? now
  const fullPeriodEnd = nextBillingDate ? new Date(nextBillingDate).getTime() : now + 30 * 24 * 60 * 60 * 1000
  // Annual renewals collect a full year upfront: grant month 0 of the new year
  // now; the annual sweep issues months 1–11, deduplicated by the grant window.
  const periodEnd = allocation.billingInterval === "annual" ? addMonths(now, 1) : fullPeriodEnd

  // ── Idempotency: skip if this subscription+period already granted ──
  const grantKey = `sub_grant_${subscriptionId}_period_${Math.floor(periodEnd / 86400000)}`
  const ledger = await creditLedgerCol()
  const alreadyGranted = await ledger.findOne({ idempotencyKey: grantKey })
  if (alreadyGranted) {
    logger.info("webhook.dodo", "subscription.renewed: duplicate — grant already exists, skipping grant", { subscriptionId, grantKey })
  } else {
    logger.info("webhook.dodo", "subscription.renewed: processing genuine renewal", {
      subscriptionId,
      userId,
      planId: allocation.planId,
      credits: allocation.monthlyCredits,
      termsSource: allocation.source,
    })

    // ── Expire only THIS subscription's bucket (not credits from other plans) ──
    await expireSubscriptionCredits({
      userId,
      subscriptionId,
      periodStart: now,
      expiresAtOrBefore: now,
      metadata: { event: "renewal", planId: allocation.planId },
    })

    // ── Grant fresh credits for the new period ──
    const granted = await grantSubscriptionCredits({
      userId, amount: allocation.monthlyCredits, subscriptionId,
      planId: allocation.planId, periodStart, periodEnd,
      metadata: { event: "renewal", dodoCustomerId: metadata?.customerId as string },
    })

    if (!granted) {
      logger.warn("webhook.dodo", "subscription.renewed: credit grant failed", { subscriptionId })
      return "subscription.renewed credit grant failed; preserved for recovery, no payment linked"
    }
  }

  {
    // Lazily pin a legacy record's own stored allocation so the NEXT renewal
    // does not depend on the record's mutable top-level fields either.
    const lazyTerms =
      subscription && !subscription.purchasedTerms
        ? buildPurchasedTermsFromRecord(subscription, { now })
        : undefined
    // Reliable price/credits without a historical snapshot are provisional and
    // must stay in review, exactly like the migration's decision.
    const lazyStatus = lazyTerms?.terms
      ? lazyTerms.terms.entitlementEvidence === "legacy_mapping_provisional"
        ? ("needs_review" as const)
        : ("pinned" as const)
      : undefined

    await subCol.updateOne(
      { dodoSubscriptionId: subscriptionId },
      buildUpdate({
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: fullPeriodEnd,
        billingCycle: allocation.billingInterval,
        ...(allocation.commercialPlanId ? { commercialPlanId: allocation.commercialPlanId } : {}),
        ...(lazyTerms?.terms && lazyStatus
          ? {
              purchasedTerms: lazyTerms.terms,
              termsStatus: lazyStatus,
              ...(lazyTerms.reviewReason ? { termsReviewReason: lazyTerms.reviewReason } : {}),
              entitlementVersion: lazyTerms.terms.entitlementVersion,
              pricingVersion: lazyTerms.terms.pricingVersion,
              entitlementSnapshot: lazyTerms.terms.entitlementSnapshot as unknown as Record<string, unknown>,
            }
          : {}),
        nextBillingDate: nextBillingDate ? new Date(nextBillingDate).getTime() : undefined,
        updatedAt: now,
      }),
    )
    const grantEntry = await findSubscriptionGrantEntry(subscriptionId, periodEnd)
    if (grantEntry) {
      await linkSubscriptionGrantToPayment({
        userId,
        subscriptionId,
        planId: allocation.planId,
        periodStart,
        periodEnd,
        amount: allocation.monthlyCredits,
        creditsAllocated:
          subscription?.purchasedTerms?.annual?.totalCredits ??
          (allocation.billingInterval === "annual"
            ? allocation.monthlyCredits * 12
            : allocation.monthlyCredits),
        paidPeriodStart: periodStart,
        paidPeriodEnd: fullPeriodEnd,
        ledgerEntryId: grantEntry.id,
        ledgerIdempotencyKey: grantEntry.idempotencyKey,
        bucketId:
          typeof grantEntry.metadata?.bucketId === "string" ? grantEntry.metadata.bucketId : undefined,
        paymentId: (data.payment_id ?? data.latest_payment_id) as string | undefined,
        now,
      })
    }

    logger.info("webhook.dodo", "subscription.renewed: renewal credits granted", {
      subscriptionId,
      userId,
      credits: allocation.monthlyCredits,
      planId: allocation.planId,
      termsSource: allocation.source,
    })
  }
  return undefined
}

async function handleSubscriptionCancelled(data: Record<string, unknown> | undefined) {
  if (!data) return
  const subscriptionId = data.subscription_id as string
  const metadata = data.metadata as Record<string, unknown> | undefined
  const userId = metadata?.userId as string | undefined
  const cancelledAt = data.cancelled_at as string | undefined

  const subCol = await subscriptionRecordsCol()
  await subCol.updateOne(
    { dodoSubscriptionId: subscriptionId },
    { $set: { status: "cancelled", cancelledAt: cancelledAt ? new Date(cancelledAt).getTime() : Date.now(), cancelAtPeriodEnd: true, updatedAt: Date.now() } },
  )
  logger.info("webhook.dodo", "Subscription cancelled (credits remain until period ends)", { subscriptionId, userId, cancelledAt })
}

async function handleSubscriptionPastDue(data: Record<string, unknown> | undefined) {
  if (!data) return
  const subscriptionId = data.subscription_id as string
  const subCol = await subscriptionRecordsCol()
  await subCol.updateOne({ dodoSubscriptionId: subscriptionId }, { $set: { status: "past_due", updatedAt: Date.now() } })
  logger.warn("webhook.dodo", "Subscription past due", { subscriptionId })
}

async function handleSubscriptionOnHold(data: Record<string, unknown> | undefined) {
  if (!data) return
  const subscriptionId = data.subscription_id as string
  const subCol = await subscriptionRecordsCol()
  await subCol.updateOne({ dodoSubscriptionId: subscriptionId }, { $set: { status: "paused", updatedAt: Date.now() } })
  logger.warn("webhook.dodo", "Subscription on hold", { subscriptionId })
}

async function handleSubscriptionExpired(data: Record<string, unknown> | undefined) {
  if (!data) return
  const subscriptionId = data.subscription_id as string
  const metadata = data.metadata as Record<string, unknown> | undefined
  const userId = metadata?.userId as string | undefined

  if (userId) {
    await expireSubscriptionCredits({ userId, subscriptionId, metadata: { event: "expiration" } })
  }

  const subCol = await subscriptionRecordsCol()
  await subCol.updateOne({ dodoSubscriptionId: subscriptionId }, { $set: { status: "expired", expiredAt: Date.now(), updatedAt: Date.now() } })
  logger.info("webhook.dodo", "Subscription expired", { subscriptionId, userId })
}

async function handleSubscriptionUpdated(data: Record<string, unknown> | undefined) {
  if (!data) return
  const subscriptionId = data.subscription_id as string
  const status = data.status as string
  const statusMap: Record<string, string> = { active: "active", cancelled: "cancelled", past_due: "past_due", paused: "paused", expired: "expired" }
  const subCol = await subscriptionRecordsCol()
  await subCol.updateOne({ dodoSubscriptionId: subscriptionId }, { $set: { status: (statusMap[status] ?? status) as never, updatedAt: Date.now() } })
  logger.info("webhook.dodo", "Subscription updated", { subscriptionId, status })
}

async function handleSubscriptionPlanChanged(data: Record<string, unknown> | undefined) {
  if (!data) return
  const subscriptionId = data.subscription_id as string
  const productId = data.product_id as string
  const runtimeProduct = await resolveRuntimeCatalogProduct({ dodoProductId: productId })
  const commercial = resolveCommercialProduct(productId)
  const legacyPlan = getLegacySubscriptionPlans().find(
    (p) => p.dodoProductId === productId,
  )
  const dbPlan =
    runtimeProduct && runtimeProduct.productType === "subscription" ? runtimeProduct : undefined
  const newPlan = dbPlan
    ? {
        id: dbPlan.planId,
        name: dbPlan.planName,
        mirrorCredits: dbPlan.monthlyCredits,
        priceUSD: dbPlan.priceMinor / 100,
        annualPriceUSD: null,
        commercialPlanId: dbPlan.commercialPlanId,
      }
    : (commercial?.plan ?? legacyPlan)
  if (!newPlan) return

  // A plan change is a deliberate new purchase: re-pin the terms from the
  // resolved product. It is the only event allowed to change a subscriber's
  // commercial terms after activation.
  const subCol = await subscriptionRecordsCol()
  const subscription = await subCol.findOne({ dodoSubscriptionId: subscriptionId })
  if (!subscription) return

  // A duplicate or stale plan_changed for the plan already purchased must not
  // re-pin from a catalog that may have changed since. Only a genuinely
  // different plan (or interval) is an authoritative commercial change.
  const pinned = subscription.purchasedTerms
  const billingInterval = dbPlan
    ? dbPlan.billingCycle === "annual"
      ? "annual"
      : "monthly"
    : (commercial?.billingCycle ?? "monthly")
  const samePlan = dbPlan
    ? pinned?.commercialPlanId === dbPlan.commercialPlanId &&
      pinned?.billingInterval === billingInterval
    : commercial
      ? pinned?.commercialPlanId === commercial.plan.commercialPlanId &&
        pinned?.billingInterval === commercial.billingCycle
      : pinned?.planId === legacyPlan?.id
  if (samePlan) {
    logger.info("webhook.dodo", "Subscription plan unchanged; keeping pinned terms", {
      subscriptionId,
      productId,
    })
    return
  }

  const now = Date.now()
  const priceUSD = dbPlan
    ? dbPlan.priceMinor / 100
    : commercial?.billingCycle === "annual"
      ? (commercial.plan.annualPriceUSD ?? newPlan.priceUSD)
      : newPlan.priceUSD
  const terms =
    subscription &&
    (dbPlan
      ? dbPlan.entitlementSnapshot
        ? buildCatalogPurchasedTerms(
            {
              subscriptionRecordId: subscription.id,
              dodoSubscriptionId: subscriptionId,
              dodoProductId: productId,
              activatedAt: now,
              periodStart: subscription.currentPeriodStart || now,
              periodEnd: subscription.currentPeriodEnd || now,
            },
            {
              planId: dbPlan.planId,
              planName: dbPlan.planName,
              commercialPlanId: dbPlan.commercialPlanId,
              billingInterval,
              priceMinor: dbPlan.priceMinor,
              monthlyCredits: dbPlan.monthlyCredits,
              entitlementSnapshot: dbPlan.entitlementSnapshot,
              entitlementVersion: dbPlan.entitlementVersion,
              pricingVersion: dbPlan.pricingVersion,
            },
          )
        : commercial
          ? buildCommercialPurchasedTerms(
              {
                subscriptionRecordId: subscription.id,
                dodoSubscriptionId: subscriptionId,
                dodoProductId: productId,
                activatedAt: now,
                periodStart: subscription.currentPeriodStart || now,
                periodEnd: subscription.currentPeriodEnd || now,
              },
              commercial.plan,
              commercial.billingCycle,
            )
          : undefined
      : commercial
        ? buildCommercialPurchasedTerms(
            {
              subscriptionRecordId: subscription.id,
              dodoSubscriptionId: subscriptionId,
              dodoProductId: productId,
              activatedAt: now,
              periodStart: subscription.currentPeriodStart || now,
              periodEnd: subscription.currentPeriodEnd || now,
            },
            commercial.plan,
            commercial.billingCycle,
          )
        : legacyPlan
          ? buildLegacyPurchasedTerms(
              {
                subscriptionRecordId: subscription.id,
                dodoSubscriptionId: subscriptionId,
                dodoProductId: productId,
                activatedAt: now,
                periodStart: subscription.currentPeriodStart || now,
                periodEnd: subscription.currentPeriodEnd || now,
              },
              legacyPlan,
              billingInterval,
            )
          : undefined)

  await subCol.updateOne(
    { dodoSubscriptionId: subscriptionId },
    {
      $set: {
        planId: newPlan.id,
        planName: newPlan.name,
        priceUSD,
        mirrorCredits: newPlan.mirrorCredits,
        billingCycle: billingInterval,
        ...(dbPlan?.commercialPlanId
          ? { commercialPlanId: dbPlan.commercialPlanId }
          : commercial
            ? { commercialPlanId: commercial.plan.commercialPlanId }
            : {}),
        ...(terms
          ? {
              purchasedTerms: terms,
              termsStatus: "pinned" as const,
              entitlementVersion: terms.entitlementVersion,
              pricingVersion: terms.pricingVersion,
              entitlementSnapshot: terms.entitlementSnapshot as unknown as Record<string, unknown>,
            }
          : {}),
        updatedAt: now,
      },
    },
  )
  logger.info("webhook.dodo", "Subscription plan changed", { subscriptionId, productId })
}

// ─── Refund Handler (Phase 3 §4 corrected accounting) ─────────────────────────

/**
 * refund.succeeded accounting rules:
 *
 *  - The refund is a NEW payment_records row (`paymentType: "refund"`,
 *    negative amount preserved from Dodo, `dodoPaymentId = refund_id` under
 *    the unique index, `originalPaymentId` link). The original successful
 *    payment row is NEVER overwritten as if it never happened.
 *  - Credit reversal is keyed on the stable Dodo refund id
 *    (`refund_${refundId}`) with transactionType "refund_reversal" — the
 *    honest enum for a payment refund clawback. (Phase 3 correction: the old
 *    code mislabeled Dodo refunds as "build_refund", the build-release type.)
 *  - Partial refunds: when the original payment's amount and the refund's
 *    amount/currency are both authoritative, only the PROPORTIONAL share of
 *    granted credits is reversed; the original row accumulates
 *    refundedAmountMinor and moves succeeded → partially_refunded → refunded.
 *    Amounts are never converted across currencies.
 *  - Unattributable refunds (no matching original payment — including a
 *    refund event that arrives before its payment — or currency mismatch)
 *    return an unresolved reason: the event stays discoverable and the
 *    recovery worker can re-run it once the missing record lands. Reversal
 *    FAILURE (e.g. clawback hit an empty balance) THROWS → status failed →
 *    recoverable discrepancy, never a silently "processed" refund.
 */
class RefundRejected extends Error {
  constructor(
    readonly reason: "already_applied" | "exceeds",
    message: string,
  ) {
    super(message)
    this.name = "RefundRejected"
  }
}

function refundReplayMessage(refund: PaymentRecord): string | undefined {
  if (refund.reversalStatus === "unresolved") {
    return `refund.succeeded already recorded but its credit reversal is unresolved (${refund.refundReviewReason ?? "unknown"}); requires review`
  }
  return undefined
}

async function handleRefundSucceeded(data: Record<string, unknown> | undefined): Promise<string | undefined> {
  if (!data) {
    logger.warn("webhook.dodo", "refund.succeeded: missing data")
    return "refund.succeeded payload contained no data object; nothing to attribute"
  }

  const refundId = data.refund_id as string
  const paymentId = data.payment_id as string
  const refundAmount = typeof data.amount === "number" ? data.amount : undefined
  const refundCurrency = typeof data.currency === "string" ? data.currency.toUpperCase() : undefined

  if (!refundId || !paymentId) {
    return "refund.succeeded carried no authoritative refund_id/payment_id pair; preserved for reconciliation, nothing reversed"
  }

  const payCol = await paymentRecordsCol()
  const mongoClient = await getMongoClient()
  const session = mongoClient.startSession()

  let message: string | undefined
  let logInfo:
    | { userId: string; creditsReversed: number; reversalStatus: PaymentRecord["reversalStatus"] }
    | undefined

  try {
    await session.withTransaction(async () => {
      message = undefined

      const originalPayment = await payCol.findOne({ dodoPaymentId: paymentId }, { session })
      if (!originalPayment?.userId) {
        // Includes the refund-before-payment ordering case: recovery re-runs
        // this event once the payment row exists (the reversal key makes that
        // replay idempotent).
        logger.warn("webhook.dodo", "Refund: no matching payment found", { refundId, paymentId })
        message = `refund.succeeded has no matching original payment record (${paymentId}); preserved for recovery — reversal skipped, nothing fabricated`
        return
      }

      if (
        refundCurrency &&
        originalPayment.currency &&
        refundCurrency !== originalPayment.currency.toUpperCase()
      ) {
        logger.warn("webhook.dodo", "Refund: currency mismatch", {
          refundId,
          refundCurrency,
          paymentCurrency: originalPayment.currency,
        })
        message = `refund.succeeded currency (${refundCurrency}) does not match the original payment (${originalPayment.currency}); no FX source exists, preserved for manual reconciliation`
        return
      }

      const existingRefund = await payCol.findOne({ dodoPaymentId: refundId }, { session })
      if (existingRefund) {
        message = refundReplayMessage(existingRefund)
        return
      }

      const originalAmount = originalPayment.amount
      const alreadyRefundedAmount = originalPayment.refundedAmountMinor ?? 0
      if (
        typeof refundAmount === "number" &&
        refundAmount > 0 &&
        typeof originalAmount === "number" &&
        alreadyRefundedAmount + refundAmount > originalAmount
      ) {
        logger.warn("webhook.dodo", "Refund exceeds the original payment", {
          refundId,
          paymentId,
          refundAmount,
          alreadyRefundedAmount,
          originalAmount,
        })
        message = `refund.succeeded exceeds the original payment's remaining refundable amount (already ${alreadyRefundedAmount}, new ${refundAmount}, original ${originalAmount}); preserved for reconciliation, nothing recorded`
        return
      }

      const isSubscription =
        originalPayment.paymentType === "subscription" ||
        originalPayment.creditType === "subscription"
      const alreadyReversed = originalPayment.creditsReversed ?? 0

      let creditsReversed = 0
      let creditsReversalShortfall = 0
      let reversalStatus: PaymentRecord["reversalStatus"] = "nothing_to_reverse"
      let reviewReason: string | undefined
      const reversalLedgerEntryIds: string[] = []

      if (isSubscription) {
        const plan = planSubscriptionRefund({
          creditsGranted: originalPayment.creditsGranted ?? 0,
          creditsReversed: alreadyReversed,
          originalAmount,
          refundAmount,
          grantStatus: originalPayment.grantStatus,
        })

        if (!plan.ok) {
          if (plan.reason === "already_reversed") {
            reversalStatus = "nothing_to_reverse"
          } else {
            reversalStatus = "unresolved"
            reviewReason = plan.reviewReason ?? plan.reason
            logger.warn("webhook.dodo", "Refund: subscription grant history unresolved", {
              refundId,
              paymentId,
              reason: reviewReason,
            })
          }
        } else if (plan.creditsToReverse > 0) {
          const hasBucketRefs = (originalPayment.grantBucketIds?.length ?? 0) > 0
          if (!hasBucketRefs) {
            reversalStatus = "unresolved"
            reviewReason = "grant_bucket_unresolved"
            logger.warn("webhook.dodo", "Refund: subscription grant has no bucket reference", {
              refundId,
              paymentId,
            })
          } else {
            const reversal = await reverseSubscriptionCredits({
              userId: originalPayment.userId,
              subscriptionId: originalPayment.subscriptionId ?? "",
              amount: plan.creditsToReverse,
              bucketIds: originalPayment.grantBucketIds,
              idempotencyKey: `refund_${refundId}`,
              referenceType: "refund",
              referenceId: refundId,
              metadata: {
                originalPaymentId: paymentId,
                refundAmount: refundAmount ?? null,
                currency: refundCurrency ?? originalPayment.currency ?? null,
                creditsRequested: plan.creditsToReverse,
                partialRefund: plan.partialRefund,
                grantLedgerEntryIds: originalPayment.grantLedgerEntryIds ?? [],
              },
              session,
            })

            if (!reversal.success) {
              if (reversal.reason === "nothing_available" || reversal.reason === "insufficient_balance") {
                creditsReversed = 0
                creditsReversalShortfall =
                  reversal.shortfall > 0 ? reversal.shortfall : plan.creditsToReverse
                reversalStatus = "nothing_to_reverse"
                reviewReason = "grant_already_consumed_or_expired"
              } else {
                throw new Error(
                  `refund.succeeded: subscription credit reversal failed for refund ${refundId} (${reversal.reason})`,
                )
              }
            } else {
              creditsReversed = reversal.actualReversed
              if (reversal.ledgerEntryId) reversalLedgerEntryIds.push(reversal.ledgerEntryId)
              const remainingGrant = Math.max(
                0,
                (originalPayment.creditsGranted ?? 0) - alreadyReversed,
              )
              reversalStatus = creditsReversed >= remainingGrant ? "reversed" : "partially_reversed"
              if (reversal.shortfall > 0 || creditsReversed < plan.creditsToReverse) {
                creditsReversalShortfall =
                  reversal.shortfall > 0
                    ? reversal.shortfall
                    : plan.creditsToReverse - creditsReversed
                reversalStatus = "partially_reversed"
                reviewReason =
                  reversal.shortfallReason === "expired"
                    ? "grant_partially_expired"
                    : reversal.shortfallReason === "already_reversed"
                      ? "grant_already_reversed"
                      : "grant_partially_consumed"
              }
            }
          }
        }
      } else {
        const creditsGranted = originalPayment.creditsGranted ?? 0
        if (creditsGranted > 0) {
          const isPartial =
            typeof originalAmount === "number" &&
            originalAmount > 0 &&
            typeof refundAmount === "number" &&
            refundAmount > 0 &&
            refundAmount < originalAmount
          const creditsToReverse = isPartial
            ? Math.max(1, Math.floor((creditsGranted * refundAmount) / originalAmount))
            : creditsGranted

          const result = await reverseCredits({
            userId: originalPayment.userId,
            creditType: originalPayment.creditType ?? "permanent",
            amount: creditsToReverse,
            transactionType: "refund_reversal",
            idempotencyKey: `refund_${refundId}`,
            referenceType: "refund",
            referenceId: refundId,
            paymentId,
            metadata: {
              originalPaymentId: paymentId,
              refundAmount: refundAmount ?? null,
              currency: refundCurrency ?? originalPayment.currency ?? null,
              creditsReversed: creditsToReverse,
              partialRefund: isPartial,
            },
            session,
          })

          if (!result.success) {
            if (result.reason === "nothing_available" || result.reason === "insufficient_balance") {
              creditsReversed = 0
              creditsReversalShortfall =
                result.shortfall > 0 ? result.shortfall : creditsToReverse
              reversalStatus = "nothing_to_reverse"
              reviewReason = "grant_already_consumed_or_expired"
            } else {
              throw new Error(`refund.succeeded: credit reversal failed for refund ${refundId}`)
            }
          } else {
            creditsReversed = result.actualReversed
            if (result.ledgerEntryId) reversalLedgerEntryIds.push(result.ledgerEntryId)
            if (result.actualReversed < creditsToReverse) {
              creditsReversalShortfall =
                result.shortfall > 0
                  ? result.shortfall
                  : creditsToReverse - result.actualReversed
              reversalStatus = "partially_reversed"
              reviewReason =
                result.shortfallReason === "expired"
                  ? "grant_partially_expired"
                  : result.shortfallReason === "already_reversed"
                    ? "grant_already_reversed"
                    : "grant_partially_consumed"
            } else {
              reversalStatus = "reversed"
            }
          }
        }
      }

      const status: PaymentStatus =
        typeof refundAmount === "number" && refundAmount > 0
          ? (() => {
              const total = typeof originalAmount === "number" ? originalAmount : undefined
              const next = (originalPayment.refundedAmountMinor ?? 0) + refundAmount
              return total !== undefined && next >= total ? "refunded" : "partially_refunded"
            })()
          : "refunded"

      const update: Record<string, unknown> = {
        $set: {
          status,
          reversalStatus,
          ...(reviewReason ? { refundReviewReason: reviewReason } : {}),
          ...(reversalLedgerEntryIds.length > 0
            ? {
                reversalLedgerEntryIds: [
                  ...(originalPayment.reversalLedgerEntryIds ?? []),
                  ...reversalLedgerEntryIds,
                ],
              }
            : {}),
          updatedAt: Date.now(),
        },
      }
      if (typeof refundAmount === "number" && refundAmount > 0) {
        update.$inc = { refundedAmountMinor: refundAmount }
      }
      if (creditsReversed > 0) {
        update.$inc = { ...(update.$inc as Record<string, number>), creditsReversed }
      }
      if (creditsReversalShortfall > 0) {
        update.$inc = {
          ...(update.$inc as Record<string, number>),
          creditsReversalShortfall,
        }
      }
      update.$addToSet = { refundIds: refundId }

      // The refund id dedupe and the cumulative monetary cap are enforced in
      // the SAME atomic update as the $inc. Different concurrent refund ids
      // therefore cannot both push refundedAmountMinor past the charge.
      const filter: Record<string, unknown> = {
        dodoPaymentId: paymentId,
        refundIds: { $ne: refundId },
      }
      if (
        typeof refundAmount === "number" &&
        refundAmount > 0 &&
        typeof originalAmount === "number" &&
        originalAmount > 0
      ) {
        // Cumulative cap without $expr: a missing field is the first refund;
        // otherwise the stored total must still leave room for this one.
        filter.$or = [
          { refundedAmountMinor: { $exists: false } },
          { refundedAmountMinor: { $lte: originalAmount - refundAmount } },
        ]
      }

      const applied = await payCol.updateOne(filter, update, { session })
      if (applied.matchedCount === 0) {
        const current = await payCol.findOne({ dodoPaymentId: paymentId }, { session })
        if (current?.refundIds?.includes(refundId)) {
          throw new RefundRejected("already_applied", "refund already applied")
        }
        throw new RefundRejected(
          "exceeds",
          `refund.succeeded exceeds the original payment's remaining refundable amount; preserved for reconciliation, nothing recorded`,
        )
      }

      await recordPayment({
        userId: originalPayment.userId,
        dodoPaymentId: refundId,
        amount: typeof refundAmount === "number" ? -refundAmount : undefined,
        currency: refundCurrency ?? originalPayment.currency,
        status: "refunded",
        paymentType: "refund",
        creditsGranted: creditsReversed > 0 ? -creditsReversed : undefined,
        creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
        creditsReversalShortfall:
          creditsReversalShortfall > 0 ? creditsReversalShortfall : undefined,
        reversalStatus,
        refundReviewReason: reviewReason,
        reversalLedgerEntryIds,
        originalPaymentId: paymentId,
        refundId,
        createdAt: Date.now(),
        session,
      })

      if (typeof originalAmount === "number" && originalAmount > 0) {
        await payCol.updateOne(
          { dodoPaymentId: paymentId, refundedAmountMinor: { $gte: originalAmount } },
          { $set: { status: "refunded", updatedAt: Date.now() } },
          { session },
        )
      }

      logInfo = {
        userId: originalPayment.userId,
        creditsReversed,
        reversalStatus,
      }

      if (reversalStatus === "unresolved") {
        message = `refund.succeeded recorded, but the original payment's credit grant history is unresolved (${reviewReason}); credit reversal requires review`
      }
    })
  } catch (err) {
    if (err instanceof RefundRejected) {
      if (err.reason === "already_applied") {
        const existing = await payCol.findOne({ dodoPaymentId: refundId })
        return existing ? refundReplayMessage(existing) : undefined
      }
      return err.message
    }
    if (err instanceof Error && /E11000|duplicate key/i.test(err.message)) {
      const existing = await payCol.findOne({ dodoPaymentId: refundId })
      if (existing) return refundReplayMessage(existing)
    }
    throw err
  } finally {
    await session.endSession()
  }

  if (logInfo) {
    logger.info("webhook.dodo", "Refund accounted", {
      refundId,
      paymentId,
      userId: logInfo.userId,
      creditsReversed: logInfo.creditsReversed,
      reversalStatus: logInfo.reversalStatus,
    })
  }

  return message
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Persist a payment record. Amount/currency are recorded only when Dodo
 * actually provided them — an unknown amount is stored as absent, never as
 * a fabricated confirmed $0. A persistence failure is re-thrown so the
 * caller can mark the webhook event as failed; a required financial write
 * must never be silently treated as success. (Payment-record lookup keeps
 * the insert idempotent, so a later replay cannot double-record.)
 */
export async function recordPayment(params: {
  userId?: string
  dodoPaymentId: string
  dodoCustomerId?: string
  amount?: number
  currency?: string
  status: PaymentStatus
  paymentType: string
  creditsGranted?: number
  creditsAllocated?: number
  creditType?: string
  subscriptionId?: string
  packageId?: string
  productId?: string
  originalPaymentId?: string
  refundId?: string
  providerCreatedAt?: number
  grantStatus?: PaymentRecord["grantStatus"]
  grantedAt?: number
  paidPeriodStart?: number
  paidPeriodEnd?: number
  grantLinkMethod?: PaymentRecord["grantLinkMethod"]
  creditsReversed?: number
  reversalStatus?: PaymentRecord["reversalStatus"]
  refundReviewReason?: string
  reversalLedgerEntryIds?: string[]
  creditsReversalShortfall?: number
  createdAt: number
  session?: ClientSession
}): Promise<PaymentRecord | undefined> {
  try {
    const col = await paymentRecordsCol()
    const existing = await col.findOne(
      { dodoPaymentId: params.dodoPaymentId },
      params.session ? { session: params.session } : {},
    )
    if (existing) return existing

    const record: PaymentRecord = {
      _id: new ObjectId(),
      id: `pay_${cryptoId()}`,
      userId: params.userId ?? "",
      dodoPaymentId: params.dodoPaymentId,
      dodoCustomerId: params.dodoCustomerId,
      amount: params.amount,
      currency: params.currency,
      status: params.status,
      paymentType: params.paymentType,
      creditsGranted: params.creditsGranted,
      creditsAllocated: params.creditsAllocated,
      creditType: params.creditType as "subscription" | "permanent" | undefined,
      subscriptionId: params.subscriptionId,
      packageId: params.packageId,
      productId: params.productId,
      originalPaymentId: params.originalPaymentId,
      refundId: params.refundId,
      providerCreatedAt: params.providerCreatedAt,
      grantStatus: params.grantStatus,
      grantedAt: params.grantedAt,
      paidPeriodStart: params.paidPeriodStart,
      paidPeriodEnd: params.paidPeriodEnd,
      grantLinkMethod: params.grantLinkMethod,
      creditsReversed: params.creditsReversed,
      creditsReversalShortfall: params.creditsReversalShortfall,
      reversalStatus: params.reversalStatus,
      refundReviewReason: params.refundReviewReason,
      reversalLedgerEntryIds: params.reversalLedgerEntryIds,
      createdAt: params.createdAt,
      updatedAt: Date.now(),
    }
    if (params.session) {
      await col.insertOne(record, { session: params.session })
    } else {
      await col.insertOne(record)
    }
    return record
  } catch (err) {
    logger.error("webhook.dodo", "Failed to record payment", { dodoPaymentId: params.dodoPaymentId, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

export type { SubscriptionRecord, SubscriptionStatus }
