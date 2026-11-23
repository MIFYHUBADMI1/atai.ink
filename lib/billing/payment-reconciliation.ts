/**
 * Phase A2 — read-only-first reconciliation of historical subscription
 * payments that never recorded the credits they granted (M-14).
 *
 * A payment is linked only when exactly one real subscription grant can be
 * attributed to it. Everything else is marked `grantStatus: "needs_review"`;
 * no credit amount is invented. Re-running is a no-op for reconciled records.
 *
 * @module lib/billing/payment-reconciliation
 */

import { creditLedgerCol, paymentRecordsCol, subscriptionRecordsCol } from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { planHistoricalGrantReconciliation } from "@/lib/billing/subscription-refunds"
import type { PaymentRecord } from "@/lib/billing/billing-types"
import { logger } from "@/lib/logging/logger"

const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface PaymentReconciliationReport {
  scanned: number
  linked: number
  needsReview: number
  skipped: number
  errors: Array<{ id: string; error: string }>
  details: Array<{
    paymentId: string
    action: "link" | "review" | "skip"
    reason?: string
    credits?: number
  }>
}

export async function reconcileSubscriptionPayments(opts: {
  mode: "dry-run" | "apply"
  now?: number
}): Promise<PaymentReconciliationReport> {
  const now = opts.now ?? Date.now()
  const report: PaymentReconciliationReport = {
    scanned: 0,
    linked: 0,
    needsReview: 0,
    skipped: 0,
    errors: [],
    details: [],
  }

  const payCol = await paymentRecordsCol()
  const ledger = await creditLedgerCol()
  const subCol = await subscriptionRecordsCol()

  const payments = await payCol
    .find({ paymentType: "subscription" })
    .sort({ createdAt: 1 })
    .toArray()

  report.scanned = payments.length

  for (const payment of payments) {
    try {
      if (payment.grantStatus) {
        report.skipped++
        report.details.push({ paymentId: payment.dodoPaymentId, action: "skip", reason: "already_reconciled" })
        continue
      }
      if ((payment.creditsGranted ?? 0) > 0) {
        // An amount without a ledger reference is not enough to reverse
        // safely. Preserve it and make the gap visible.
        if ((payment.grantLedgerEntryIds?.length ?? 0) === 0) {
          if (opts.mode === "apply") {
            await payCol.updateOne(
              { dodoPaymentId: payment.dodoPaymentId },
              {
                $set: {
                  grantStatus: "needs_review",
                  grantLinkMethod: "manual_review",
                  refundReviewReason: "grant_reference_missing",
                  updatedAt: now,
                },
              },
            )
          }
          report.needsReview++
          report.details.push({
            paymentId: payment.dodoPaymentId,
            action: "review",
            reason: "grant_reference_missing",
            credits: payment.creditsGranted,
          })
        } else {
          report.skipped++
          report.details.push({ paymentId: payment.dodoPaymentId, action: "skip", reason: "already_has_grant" })
        }
        continue
      }

      const anchor = payment.providerCreatedAt ?? payment.createdAt
      const grants = await ledger
        .find({
          transactionType: "subscription_grant",
          referenceId: payment.subscriptionId,
          direction: "credit",
        })
        .sort({ createdAt: 1 })
        .limit(50)
        .toArray()

      const near = grants.filter((grant) => {
        if (grant.paymentId) return false
        if (grant.createdAt < anchor - RECONCILE_WINDOW_MS) return false
        if (grant.createdAt > anchor + RECONCILE_WINDOW_MS) return false
        // Never attach a grant from another billing period. When the payment
        // knows its paid period, the grant's own period must fit it; otherwise
        // the grant must at least start near the payment timestamp.
        const periodStart = Number(grant.metadata?.periodStart ?? grant.createdAt)
        if (payment.paidPeriodStart != null && payment.paidPeriodEnd != null) {
          return periodStart >= payment.paidPeriodStart && periodStart < payment.paidPeriodEnd
        }
        return (
          periodStart >= anchor - RECONCILE_WINDOW_MS &&
          periodStart <= anchor + RECONCILE_WINDOW_MS
        )
      })

      const plan = planHistoricalGrantReconciliation({ payment, grants: near })
      if (plan.action === "review") {
        if (opts.mode === "apply") {
          await payCol.updateOne(
            { dodoPaymentId: payment.dodoPaymentId },
            {
              $set: {
                grantStatus: "needs_review",
                grantLinkMethod: "manual_review",
                refundReviewReason: plan.reason,
                updatedAt: now,
              },
            },
          )
        }
        report.needsReview++
        report.details.push({ paymentId: payment.dodoPaymentId, action: "review", reason: plan.reason })
        continue
      }

      const sub = await subCol.findOne({ dodoSubscriptionId: payment.subscriptionId })
      const allocated =
        sub?.purchasedTerms?.annual?.totalCredits ?? sub?.purchasedTerms?.monthlyCredits
      const grant = near[0]
      const grantStatus: NonNullable<PaymentRecord["grantStatus"]> =
        allocated && plan.creditsGranted < allocated ? "partially_granted" : "granted"

      if (opts.mode === "apply") {
        const set: Partial<PaymentRecord> = {
          creditType: "subscription",
          creditsGranted: plan.creditsGranted,
          creditsAllocated: allocated ?? plan.creditsGranted,
          grantStatus,
          grantedAt: grant.createdAt,
          grantLedgerEntryIds: plan.ledgerEntryIds,
          grantBucketIds: plan.bucketIds,
          grantLinkMethod: "ledger_reference",
          updatedAt: now,
        }
        const client = await getMongoClient()
        const session = client.startSession()
        try {
          await session.withTransaction(async () => {
            await payCol.updateOne(
              { dodoPaymentId: payment.dodoPaymentId },
              { $set: set },
              { session },
            )
            if (grant.id) {
              await ledger.updateOne(
                { id: grant.id },
                { $set: { paymentId: payment.dodoPaymentId } },
                { session },
              )
            }
          })
        } finally {
          await session.endSession()
        }
      }

      report.linked++
      report.details.push({
        paymentId: payment.dodoPaymentId,
        action: "link",
        credits: plan.creditsGranted,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      report.errors.push({ id: payment.dodoPaymentId, error: message })
      logger.warn("billing.payment_reconciliation", "Payment reconciliation failed", {
        paymentId: payment.dodoPaymentId,
        error: message,
      })
    }
  }

  return report
}
