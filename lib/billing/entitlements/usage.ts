/**
 * Atai — Usage-alert computation (Phase 3, missing-area clarification).
 *
 * Pure helper that turns a resolved EntitlementSet + a live usage snapshot into
 * alert flags the billing UI surfaces (e.g. "80% of monthly credits used",
 * "1 business slot left"). Kept side-effect free and framework-free so it is
 * trivially testable and can be called from server components / API routes.
 *
 * Thresholds are named constants — not invented product numbers — so they stay
 * easy to tune without touching enforcement logic.
 *
 * @module lib/billing/entitlements/usage
 */

import type { EntitlementSet } from "./types"

/** Warn once consumption passes this fraction of the monthly allowance. */
export const USAGE_WARN_RATIO = 0.8

export interface UsageSnapshot {
  /** Subscription credits consumed in the current period. */
  creditsUsed: number
  /** Total available this period (subscription + any override). null = unknown. */
  creditsTotal?: number | null
  /** Businesses currently owned by the workspace. */
  businessCount: number
}

export interface UsageAlerts {
  creditsNearLimit: boolean
  creditsAtLimit: boolean
  /** 0..1 of monthly credits used; null when the total is unknown. */
  creditUsageRatio: number | null
  businessCapReached: boolean
  businessCapNear: boolean
  /** Human-readable, i18n-ready warning strings for the UI. */
  warnings: string[]
}

export function computeUsageAlerts(set: EntitlementSet, usage: UsageSnapshot): UsageAlerts {
  const warnings: string[] = []

  // ── Credits ────────────────────────────────────────────────────────────────
  const monthly = set.credits.monthlyGrant
  const total = usage.creditsTotal ?? monthly
  let creditUsageRatio: number | null = null
  let creditsNearLimit = false
  let creditsAtLimit = false

  if (total != null && total > 0) {
    creditUsageRatio = Math.min(1, usage.creditsUsed / total)
    if (creditUsageRatio >= 1) {
      creditsAtLimit = true
      warnings.push("You've used all your monthly credits — top up or wait for the next refill.")
    } else if (creditUsageRatio >= USAGE_WARN_RATIO) {
      creditsNearLimit = true
      warnings.push(`You've used ${Math.round(creditUsageRatio * 100)}% of your monthly credits.`)
    }
  }

  // ── Business cap ─────────────────────────────────────────────────────────────
  const bizMax = set.businesses.max
  let businessCapReached = false
  let businessCapNear = false

  if (bizMax !== "unlimited") {
    if (usage.businessCount >= bizMax) {
      businessCapReached = true
      warnings.push("You've reached your plan's business limit. Upgrade to add more.")
    } else {
      const remaining = bizMax - usage.businessCount
      const nearThreshold = Math.max(1, Math.ceil(bizMax * (1 - USAGE_WARN_RATIO)))
      if (remaining <= nearThreshold) {
        businessCapNear = true
        warnings.push(`You have ${remaining} business slot${remaining === 1 ? "" : "s"} left on your plan.`)
      }
    }
  }

  return {
    creditsNearLimit,
    creditsAtLimit,
    creditUsageRatio,
    businessCapReached,
    businessCapNear,
    warnings,
  }
}
