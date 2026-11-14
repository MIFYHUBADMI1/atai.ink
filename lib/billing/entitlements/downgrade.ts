/**
 * Atai — Plan downgrade handling (Phase 3, Gate 6).
 *
 * Implements the corrected two-flow model from Phase 2 Revision §Issue 4:
 *
 *  A. Customer-initiated downgrade — pre-confirmation UI shows consequences;
 *     the backend schedules the change (caller integrates with Dodo). No second
 *     confirmation is needed when the webhook later reconciles.
 *  B. Webhook-driven downgrade — the verified event is processed immediately.
 *     ALL data/applications are preserved (never auto-deleted/suspended); only
 *     over-limit businesses become `preserved_readonly` and the user picks
 *     which to keep active. New creation beyond the new cap is blocked.
 *
 * Cancellation ≠ takedown. Five post-cancellation states are honoured by the
 * entitlement service + hosting layer (not deletion):
 *   1) public availability, 2) new-deploy permission, 3) resource consumption,
 *   4) administrative access, 5) data export — each with explicit behaviour.
 *
 * Pure functions here are unit-tested; DB writes (marking readonly, scheduling)
 * live in the calling routes so this module stays side-effect free.
 *
 * @module lib/billing/entitlements/downgrade
 */

import { buildEntitlementSet } from "./catalog"
import type { CommercialPlanId } from "./types"

const ZERO = { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 }

/** The business cap for a commercial plan (single source of truth = catalog). */
export function maxBusinessesForPlan(plan: CommercialPlanId): number | "unlimited" {
  return buildEntitlementSet(plan, ZERO).businesses.max
}

export interface DowngradeImpact {
  fromPlan: CommercialPlanId
  toPlan: CommercialPlanId
  currentBusinesses: number
  allowedBusinessesInToPlan: number | "unlimited"
  overLimit: number
  withinLimit: boolean
  /** User must choose which businesses stay active (over-limit ones go readonly). */
  requiresActiveSelection: boolean
  /** Count that will be marked `preserved_readonly` if no selection is made. */
  preservedReadonlyCount: number
}

export function computeDowngradeImpact(
  from: CommercialPlanId,
  to: CommercialPlanId,
  currentBusinesses: number,
): DowngradeImpact {
  const allowed = maxBusinessesForPlan(to)
  const allowedNum = allowed === "unlimited" ? Number.POSITIVE_INFINITY : allowed
  const overLimit = allowed === "unlimited" ? 0 : Math.max(0, currentBusinesses - allowed)
  return {
    fromPlan: from,
    toPlan: to,
    currentBusinesses,
    allowedBusinessesInToPlan: allowed,
    overLimit,
    withinLimit: currentBusinesses <= allowedNum,
    requiresActiveSelection: overLimit > 0,
    preservedReadonlyCount: overLimit,
  }
}

export interface CustomerInitiatedDowngrade {
  fromPlan: CommercialPlanId
  toPlan: CommercialPlanId
  impact: DowngradeImpact
  consequences: string[]
  scheduledAtPeriodEnd: boolean
}

/**
 * Flow A — produce the pre-confirmation view and the scheduled change. The
 * caller persists the schedule with Dodo; this returns the human-readable
 * consequences for the confirmation UI.
 */
export function planCustomerInitiatedDowngrade(
  from: CommercialPlanId,
  to: CommercialPlanId,
  currentBusinesses: number,
  scheduledAtPeriodEnd = true,
): CustomerInitiatedDowngrade {
  const impact = computeDowngradeImpact(from, to, currentBusinesses)
  const consequences: string[] = []

  if (impact.overLimit > 0) {
    const keep = impact.allowedBusinessesInToPlan === "unlimited" ? "all" : `${impact.allowedBusinessesInToPlan}`
    consequences.push(
      `You'll keep ${keep} active business(es) on ${to}; ${impact.overLimit} will become read-only until you upgrade or choose which to keep active.`,
    )
  } else {
    consequences.push(`All ${currentBusinesses} business(es) remain active on ${to}.`)
  }
  consequences.push("New business creation is blocked at the new cap immediately; existing apps keep serving through period end.")
  consequences.push("Included custom-domain registrations apply going forward; domains beyond the included count renew per policy.")
  consequences.push(scheduledAtPeriodEnd
    ? "The downgrade takes effect at the end of the current billing period."
    : "The downgrade takes effect immediately.")

  return { fromPlan: from, toPlan: to, impact, consequences, scheduledAtPeriodEnd }
}

export interface WebhookDowngradeResult {
  fromPlan: CommercialPlanId
  toPlan: CommercialPlanId
  impact: DowngradeImpact
  /** Business ids to mark `preserved_readonly` (first N stay active). */
  preservedReadonly: string[]
  /** True when the user must pick which businesses stay active. */
  chooseActiveSelector: boolean
}

/**
 * Flow B — apply a verified webhook-driven downgrade. Returns the set of
 * over-limit business ids that should be marked `preserved_readonly`; the first
 * `allowed` businesses stay active. No deletion, no silent suspension. The
 * caller performs the persistence + shows the in-app selector.
 */
export function applyWebhookDowngrade(
  from: CommercialPlanId,
  to: CommercialPlanId,
  currentBusinesses: number,
  businessIds: string[],
): WebhookDowngradeResult {
  const impact = computeDowngradeImpact(from, to, currentBusinesses)
  const allowedNum = impact.allowedBusinessesInToPlan === "unlimited" ? currentBusinesses : impact.allowedBusinessesInToPlan
  const preservedReadonly = businessIds.slice(allowedNum)
  return {
    fromPlan: from,
    toPlan: to,
    impact,
    preservedReadonly,
    chooseActiveSelector: impact.requiresActiveSelection,
  }
}

/** The five post-cancellation states the system must honour (never delete). */
export const CANCELLATION_STATES = [
  "public_availability",
  "new_deploy_permission",
  "resource_consumption",
  "administrative_access",
  "data_export",
] as const
export type CancellationState = (typeof CANCELLATION_STATES)[number]
