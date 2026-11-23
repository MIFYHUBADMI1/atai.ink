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
  getUsageCounts,
  scopeKey,
  ENTITLEMENT_VERSION,
} from "./service"
export type { EntitlementScope, AuthorizeOpts } from "./service"
export { buildProjectAccessView } from "./presentation"

export {
  authorizeProjectCreation,
  authorizeProjectFork,
  authorizeProductionBuild,
  authorizeAgent,
  authorizeCustomDomain,
  authorizeSubdomain,
  authorizeProvisionDatabase,
  authorizeStorage,
  authorizeSpecialistTeam,
  authorizeCompetitionIntel,
  entitlementDenial,
  EntitlementError,
  ENTITLEMENT_ENFORCEMENT_ENABLED,
} from "./require"

// Gate 4 — legacy → commercial migration
export {
  computeMigrationForRecord,
  computePinnedTermsForRecord,
  migrateSubscriptionEntitlements,
} from "./migrate"
export type {
  MigrationPayload,
  TermsMigrationPayload,
  MigrationReport,
  MigrateOpts,
  ComputeOpts,
} from "./migrate"

// Phase A1 — published catalog version records
export { ensureCatalogVersionRecords, ensureCatalogVersionRecordsSafe } from "./versions"
export {
  PRICE_BOOK_VERSION,
  PRICE_BOOK_PRE_VERSIONING,
  PRICE_BOOK_CURRENCY,
  commercialPriceMinor,
  legacyPriceMinor,
} from "./price-book"

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
