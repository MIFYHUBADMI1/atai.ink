import { requireUser } from "@/lib/auth/session"
import { getBalance, getCreditHistory } from "@/lib/billing/credit-service"
import { subscriptionRecordsCol } from "@/lib/db/collections"
import { ok, handleRouteError } from "@/lib/api/respond"
import {
  resolveEntitlements,
  getBusinessCount,
  computeUsageAlerts,
  resolveCommercialPlan,
} from "@/lib/billing/entitlements"
import type { UsageAlerts } from "@/lib/billing/entitlements"
import { resolvePublicCommercialCatalog } from "@/lib/billing/catalog/published-resolver"

/**
 * GET /api/billing/overview
 *
 * Single endpoint backing the Settings → Billing page:
 * - balance: total credits split by subscription/permanent
 * - history: recent signed credit ledger entries (positive = granted,
 *   negative = consumed) with human-readable reasons
 * - subscription: the user's current (non-terminated) subscription summary,
 *   or null when on the free plan
 */
export async function GET() {
  try {
    const user = await requireUser()

    const [balance, history, subRows, catalog] = await Promise.all([
      getBalance(user.id),
      getCreditHistory(user.id, 50),
      (await subscriptionRecordsCol())
        .find({ userId: user.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray(),
      resolvePublicCommercialCatalog(),
    ])

    const sub = subRows[0]
    // Only surface subscriptions that still grant/retain access. Terminated
    // statuses fall through to null so the page renders the Free plan state.
    const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due", "paused", "payment_failed"])
    const subscription =
      sub && ACTIVE_STATUSES.has(sub.status)
        ? {
            planId: sub.planId,
            planName: sub.planName,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
          }
        : null

    // ── Usage alerts (advisory) ──────────────────────────────────────────────
    // Only for active subscribers, and fully fail-open: a resolution error must
    // never break the billing overview. Uses the subscription record's actual
    // granted amount (not the provisional commercial figure) as the period total,
    // so legacy subscribers get accurate warnings before migration.
    let usageAlerts: UsageAlerts | null = null
    let businessCount = 0
    let activeCommercialPlanId: string | null = null
    if (subscription) {
      try {
        const [set, count] = await Promise.all([
          resolveEntitlements(user.id),
          getBusinessCount(user.id),
        ])
        businessCount = count
        const creditsTotal =
          (sub?.mirrorCredits as number | undefined) ?? set.credits.monthlyGrant ?? null
        const creditsUsed =
          creditsTotal != null && creditsTotal > 0
            ? Math.max(0, creditsTotal - balance.subscription)
            : 0
        usageAlerts = computeUsageAlerts(set, { creditsUsed, creditsTotal, businessCount })

        // When the commercial catalog is live, expose which commercial plan the
        // user's (possibly legacy) subscription maps to, so the in-app billing
        // page highlights the right card in the new five-plan list.
        activeCommercialPlanId =
          (sub?.commercialPlanId as string | undefined) ??
          resolveCommercialPlan(sub?.planId as string, { hasProjects: count > 0 }).commercialPlanId
      } catch {
        usageAlerts = null
      }
    }

    // The active plan and top-up catalogs come from the one published resolver,
    // so Settings → Billing shows the same offerings as /pricing.
    return ok({
      balance,
      history,
      subscription,
      usageAlerts,
      plans: catalog.plans,
      packs: catalog.packs,
      activeCommercialPlanId,
      businessCount,
    })
  } catch (e) {
    return handleRouteError("api.billing.overview", e)
  }
}
