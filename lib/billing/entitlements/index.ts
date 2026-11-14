/**
 * Public API for the centralized entitlement system (Phase 3).
 */

export * from "./types"
export * from "./catalog"
export * from "./migration-map"
export * from "./cache"

export {
  resolveEntitlements,
  resolveForWorkspace,
  resolveScope,
  authorize,
  invalidateEntitlements,
  invalidateForUser,
  getBusinessCount,
  scopeKey,
  ENTITLEMENT_VERSION,
} from "./service"
export type { EntitlementScope, AuthorizeOpts } from "./service"

export {
  authorizeProjectCreation,
  authorizeProjectFork,
  authorizeProductionBuild,
  authorizeAgent,
  EntitlementError,
  ENTITLEMENT_ENFORCEMENT_ENABLED,
} from "./require"

// Gate 4 — legacy → commercial migration
export {
  computeMigrationForRecord,
  migrateSubscriptionEntitlements,
} from "./migrate"
export type { MigrationPayload, MigrationReport, MigrateOpts, ComputeOpts } from "./migrate"

// Gate 5 — annual monthly-issuance scheduler
export {
  runAnnualGrantSweep,
  computeDueGrantMonths,
  annualPaymentSucceeded,
  isAnnualSub,
  addMonths,
  getCommercialPlanId,
} from "./annual-scheduler"
export type { AnnualSweepReport, DueGrantMonth } from "./annual-scheduler"

// Gate 6 — downgrade two-flow
export {
  computeDowngradeImpact,
  planCustomerInitiatedDowngrade,
  applyWebhookDowngrade,
  maxBusinessesForPlan,
  CANCELLATION_STATES,
} from "./downgrade"
export type {
  DowngradeImpact,
  CustomerInitiatedDowngrade,
  WebhookDowngradeResult,
  CancellationState,
} from "./downgrade"

// Missing-area: usage alerts
export { computeUsageAlerts, USAGE_WARN_RATIO } from "./usage"
export type { UsageSnapshot, UsageAlerts } from "./usage"
