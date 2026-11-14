/**
 * Atai — Legacy → commercial plan migration mapping (Phase 3).
 *
 * Critical rule (Phase 2 ADR-2): we NEVER rename the plan id that Dodo uses
 * for renewal resolution. Legacy subscribers keep their `planId` in
 * subscriptionRecords; this module maps that id to the new commercial plan so
 * the entitlement service can compute the correct capability set.
 *
 * Grandfathering: existing free users who already have projects or permanent
 * credits must NOT be silently downgraded when enforcement turns on. They keep
 * production capability (preserveLegacyBehavior) until the migration explicitly
 * re-classifies them.
 *
 * @module lib/billing/entitlements/migration-map
 */

import type { CommercialPlanId } from "./types"

/** Legacy ids as they appear in subscriptionRecords.planId today. */
export const LEGACY_TO_COMMERCIAL: Record<string, CommercialPlanId> = {
  free: "explorer",
  explorer: "starter", // paid $12 builder ≈ new Starter capability
  starter: "starter",
  business: "growth",
  professional: "scale",
  enterprise: "enterprise",
}

export interface ResolvedPlan {
  commercialPlanId: CommercialPlanId
  legacyPlanId: string
  grandfathered: boolean
  preserveLegacyBehavior: boolean
}

export interface ResolveOpts {
  hasProjects?: boolean
  hasPermanentCredits?: boolean
}

export function resolveCommercialPlan(legacyPlanId: string | undefined, opts: ResolveOpts = {}): ResolvedPlan {
  const legacy = legacyPlanId ?? "free"
  const commercial = LEGACY_TO_COMMERCIAL[legacy] ?? "explorer"

  // Legacy free users with existing assets keep production capability.
  const preserveLegacyBehavior = legacy === "free" && (opts.hasProjects === true || opts.hasPermanentCredits === true)

  return {
    commercialPlanId: commercial,
    legacyPlanId: legacy,
    grandfathered: commercial !== legacy || preserveLegacyBehavior,
    preserveLegacyBehavior,
  }
}
