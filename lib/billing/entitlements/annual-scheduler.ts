/**
 * Atai — Annual subscription monthly-issuance scheduler (Phase 3, Gate 5).
 *
 * Corrected logic per Phase 2 Revision §Issue 3. For an ANNUAL subscriber there
 * is NO monthly payment — the charge was collected once, upfront. Therefore:
 *
 *  - Grants are anchored to the subscription billing period (currentPeriodStart),
 *    not the calendar month. Month index N is earned when its window begins.
 *  - Each monthly grant is gated on the ANNUAL payment having succeeded (a
 *    single one-time charge) — never on a (non-existent) monthly payment.
 *  - Idempotent per month: `annual_grant_<subId>_<n>` (enforced via the
 *    canonical grantSubscriptionCredits idempotency key on the month window).
 *  - Re-running the sweep is a no-op for already-granted months; a delayed
 *    webhook simply causes the next sweep to catch up (recovery).
 *  - Cancellation/expiry halts FUTURE months; already-granted months stay valid.
 *  - Refund/chargeback on the annual charge stops future grants (and triggers
 *    recovery per the refund policy — out of scope here).
 *
 * @module lib/billing/entitlements/annual-scheduler
 */

import { subscriptionRecordsCol, paymentRecordsCol } from "@/lib/db/collections"
import { grantSubscriptionCredits } from "@/lib/billing/credit-service"
import { PROVISIONAL_MONTHLY_CREDITS, ENTITLEMENT_VERSION } from "./catalog"
import { resolveCommercialPlan } from "./migration-map"
import type { SubscriptionRecord } from "@/lib/billing/billing-types"
import type { CommercialPlanId } from "./types"

const DAY_MS = 86_400_000

export function isAnnualSub(sub: SubscriptionRecord): boolean {
  return sub.billingCycle === "annual"
}

/** Add `n` calendar months to a timestamp (clamped day-of-month overflow). */
export function addMonths(start: number, n: number): number {
  const d = new Date(start)
  const targetMonth = d.getUTCMonth() + n
  const targetYear = d.getUTCFullYear() + Math.floor(targetMonth / 12)
  const month = ((targetMonth % 12) + 12) % 12
  const day = Math.min(d.getUTCDate(), daysInMonth(targetYear, month))
  return Date.UTC(targetYear, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

export function getCommercialPlanId(sub: SubscriptionRecord): CommercialPlanId {
  const stored = sub.commercialPlanId as CommercialPlanId | undefined
  if (stored) return stored
  return resolveCommercialPlan(sub.planId).commercialPlanId
}

export interface DueGrantMonth {
  monthIndex: number
  periodStart: number
  periodEnd: number
}

/**
 * Pure: which monthly grants are due for an annual subscriber at time `now`.
 * Returns the windows that have begun but are still inside the paid 12-month
 * window. Idempotency is enforced by the grant function on the month window,
 * so returning a month here means "should be (re)attempted".
 *
 * @param annualPaymentSucceeded false → no grants (refund/chargeback/never paid)
 */
export function computeDueGrantMonths(
  sub: SubscriptionRecord,
  annualPaymentSucceeded: boolean,
  now: number,
): DueGrantMonth[] {
  if (!isAnnualSub(sub)) return []
  if (!annualPaymentSucceeded) return []
  if (sub.status !== "active" && sub.status !== "trialing") return []
  if (sub.currentPeriodEnd <= now) return []

  const due: DueGrantMonth[] = []
  for (let n = 0; n < 12; n++) {
    const monthStart = addMonths(sub.currentPeriodStart, n)
    const monthEnd = addMonths(sub.currentPeriodStart, n + 1)
    // Earned once the month window begins, and within the paid 12-month window.
    if (monthStart <= now && monthStart < sub.currentPeriodEnd) {
      due.push({ monthIndex: n, periodStart: monthStart, periodEnd: monthEnd })
    }
  }
  return due
}

/** Has the upfront annual charge for this subscription been successfully collected? */
export async function annualPaymentSucceeded(sub: SubscriptionRecord): Promise<boolean> {
  try {
    const col = await paymentRecordsCol()
    const record = await col.findOne({
      subscriptionId: sub.dodoSubscriptionId,
      paymentType: "subscription",
      status: "succeeded",
    })
    if (!record) return false
    // Refunded in full (or partially beyond the principal) → stop granting.
    if (record.refundedAmountMinor != null && record.amount != null && record.refundedAmountMinor >= record.amount) {
      return false
    }
    return true
  } catch {
    // On lookup failure, be conservative: do NOT grant (fail closed).
    return false
  }
}

export interface AnnualSweepReport {
  scanned: number
  annual: number
  granted: number
  skipped: number
  errors: Array<{ id: string; error: string }>
}

/**
 * Run the monthly-issuance sweep for all active annual subscriptions. Designed
 * to be invoked by a daily cron/worker; safe to run repeatedly.
 */
export async function runAnnualGrantSweep(now: number = Date.now()): Promise<AnnualSweepReport> {
  const report: AnnualSweepReport = { scanned: 0, annual: 0, granted: 0, skipped: 0, errors: [] }
  const col = await subscriptionRecordsCol()
  const subs = await col
    .find({ billingCycle: "annual", status: { $in: ["active", "trialing"] }, currentPeriodEnd: { $gt: now } })
    .toArray()

  report.scanned = subs.length

  for (const sub of subs) {
    report.annual++
    try {
      const succeeded = await annualPaymentSucceeded(sub)
      const due = computeDueGrantMonths(sub, succeeded, now)
      if (due.length === 0) {
        report.skipped++
        continue
      }
      const planId = getCommercialPlanId(sub)
      const monthly = PROVISIONAL_MONTHLY_CREDITS[planId]
      if (monthly == null) {
        report.skipped++
        continue
      }
      for (const m of due) {
        const ok = await grantSubscriptionCredits({
          userId: sub.userId,
          amount: monthly,
          subscriptionId: sub.dodoSubscriptionId,
          planId,
          periodStart: m.periodStart,
          periodEnd: m.periodEnd,
          metadata: {
            annualGrant: true,
            monthIndex: m.monthIndex,
            billingCycle: "annual",
            entitlementVersion: ENTITLEMENT_VERSION,
          },
        })
        if (ok) report.granted++
      }
    } catch (err) {
      report.errors.push({ id: sub.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return report
}
