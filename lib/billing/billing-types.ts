/**
 * Atai — Billing System Types
 *
 * Types for the unified billing system: credit ledger, build authorization,
 * payment records, subscription records, and reconciliation.
 *
 * @module lib/billing/billing-types
 */

import type { ObjectId } from "mongodb"
import type {
  CreditType,
  LedgerTransactionType,
  BuildAuthorizationStatus,
  PaymentStatus,
  SubscriptionStatus,
} from "./config"
import type { CommercialPlanId, EntitlementSet } from "./entitlements/types"

// ─── Credit Ledger Entry ─────────────────────────────────────────────────────

export interface CreditLedgerEntry {
  _id?: ObjectId
  id: string
  userId: string
  /**
   * First-class project attribution (Phase 1). Present whenever a trusted
   * server-side project context existed for the operation; absent for
   * account-level transactions (grants, purchases, expirations), which stay
   * fully valid without it. Historical entries pre-dating Phase 1 simply do
   * not carry the field — never fabricate it retroactively.
   */
  projectId?: string
  creditType: CreditType
  amount: number
  direction: "credit" | "debit"
  transactionType: LedgerTransactionType
  referenceType?: string
  referenceId?: string
  /** Original payment that funded this entry, when known (Phase A2). */
  paymentId?: string
  balanceBefore: number
  balanceAfter: number
  idempotencyKey: string
  pricingModelVersion: string
  costModelVersion: string
  metadata?: Record<string, unknown>
  createdAt: number
}

// ─── Build Authorization ─────────────────────────────────────────────────────

export interface BuildAuthorization {
  _id?: ObjectId
  id: string
  userId: string
  projectId: string
  buildId: string
  complexity: "simple" | "medium" | "complex"
  creditCost: number
  baselineUnits: number
  pricingModelVersion: string
  costModelVersion: string
  availableSubscriptionCredits: number
  availablePermanentCredits: number
  reservationId?: string
  status: BuildAuthorizationStatus
  subscriptionCreditsUsed: number
  permanentCreditsUsed: number
  createdAt: number
  expiresAt: number
  finalizedAt?: number
}

// ─── Payment Record ──────────────────────────────────────────────────────────

export interface PaymentRecord {
  _id?: ObjectId
  id: string
  userId: string
  /** External payment ID from Dodo */
  dodoPaymentId: string
  /** Dodo customer ID */
  dodoCustomerId?: string
  /**
   * Transaction amount as reported by Dodo. Absent when the provider did
   * not supply an authoritative amount (e.g. some payment.failed events) —
   * never fabricated as a confirmed zero.
   */
  amount?: number
  /** ISO payment currency recorded from the Dodo transaction; absent when unknown. */
  currency?: string
  status: PaymentStatus
  /** "subscription" | "permanent_credit_pack" | "one_time" */
  paymentType: string
  /** The product that was purchased */
  productId?: string
  productName?: string
  /** Atai Credits granted by this payment */
  creditsGranted?: number
  /**
   * Total credits this purchase entitles the subscriber to. Monthly: the
   * monthly allocation. Annual: the full annual allocation. Distinct from
   * `creditsGranted`, which only counts credits actually issued so far.
   */
  creditsAllocated?: number
  /** Credit type granted */
  creditType?: CreditType
  /** Associated subscription ID if subscription payment */
  subscriptionId?: string
  /** Package ID for permanent credit packs */
  packageId?: string
  /** Provider timestamp for when the payment was created (epoch ms). */
  providerCreatedAt?: number
  // ─── Phase A2 subscription grant linkage (additive, non-breaking) ─────────
  /**
   * Grant lifecycle for a subscription payment. `pending` means the payment
   * is recorded but no ledger grant has been linked yet; `needs_review`
   * means the historical grant cannot be established reliably.
   */
  grantStatus?: "pending" | "granted" | "partially_granted" | "failed" | "needs_review"
  /** When the first grant was linked to this payment. */
  grantedAt?: number
  /** Ledger entry ids for every grant issued against this payment. */
  grantLedgerEntryIds?: string[]
  /** Grant idempotency keys, mirroring the ledger entries. */
  grantIdempotencyKeys?: string[]
  /** Credit bucket ids created by those grants (for safe reversal). */
  grantBucketIds?: string[]
  /** Paid period this payment covers (epoch ms). */
  paidPeriodStart?: number
  paidPeriodEnd?: number
  /** How the payment was matched to its grant(s). */
  grantLinkMethod?: "payment_id" | "subscription_period" | "ledger_reference" | "manual_review"
  /** Actual credits reversed by refunds against this payment. */
  creditsReversed?: number
  /**
   * Credits a refund asked to reverse but could not, because the original
   * grant's buckets were already consumed or expired. This is the explicit
   * shortfall reconciliation looks for; it is never silently treated as
   * reversed.
   */
  creditsReversalShortfall?: number
  /** Outcome of the credit side of a refund. */
  reversalStatus?: "reversed" | "partially_reversed" | "nothing_to_reverse" | "unresolved"
  /** Safe reason the credit reversal needs manual review. */
  refundReviewReason?: string
  /** Ledger entry ids for the reversal(s). */
  reversalLedgerEntryIds?: string[]
  /**
   * Phase 3 refund accounting: the ORIGINAL payment a refund row reverses
   * (set on `paymentType: "refund"` rows written from refund.succeeded).
   * Historical refund rows may predate the field — reconciliation treats a
   * missing link as "incomplete record", distinct from a confirmed error.
   */
  originalPaymentId?: string
  /** Refund identifier (Dodo refund_id) — mirrors dodoPaymentId on refund rows. */
  refundId?: string
  /**
   * Cumulative confirmed-refunded amount in the payment's ORIGINAL currency
   * minor units, maintained on the original payment row as refund rows land.
   * Absent = no refund recorded against this payment (never a fabricated 0).
   */
  refundedAmountMinor?: number
  /** Refund ids already applied to this payment (atomic dedupe for `$inc`). */
  refundIds?: string[]
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

// ─── Subscription Commercial Terms ───────────────────────────────────────────

export type BillingInterval = "monthly" | "annual"

/**
 * Annual issuance rules frozen at purchase time. Annual subscribers are
 * charged once upfront but receive credits monthly; the scheduler reads these
 * rules from the pinned terms instead of today's catalog constants.
 */
export interface AnnualAllocation {
  /** Number of monthly issuances in the paid annual period. */
  months: number
  /** Credits issued per month (integer units). */
  monthlyCredits: number
  /** Total credits over the annual period (integer units). */
  totalCredits: number
  issuance: "monthly"
}

/**
 * The authoritative commercial terms a subscription purchased. Written once at
 * activation (or pinned by the backward-compatible migration) and never
 * recomputed from the live catalog. A later catalog/pricing publication must
 * not change price, credit allocation, or benefits for this subscriber.
 *
 * Monetary values are integer minor units (cents) — no floating point.
 */
export interface PurchasedTerms {
  /** Internal Atai subscription record id. */
  subscriptionId: string
  /** Dodo subscription id the terms were purchased under. */
  dodoSubscriptionId: string
  /** Dodo product id actually purchased, when known. */
  dodoProductId?: string
  /** Internal plan id (legacy id is never renamed). */
  planId: string
  /** Canonical commercial plan id resolved at purchase time. */
  commercialPlanId?: CommercialPlanId
  planName: string
  billingInterval: BillingInterval
  /** Purchased price in integer minor units (e.g. cents). */
  priceMinor: number
  /** ISO currency of `priceMinor`. */
  currency: string
  /** Monthly credit allocation purchased (integer credits). */
  monthlyCredits: number
  /** Annual issuance rules, present only for annual subscriptions. */
  annual?: AnnualAllocation
  /**
   * Frozen entitlement snapshot. This embedded copy is authoritative: it is
   * sufficient to interpret the subscription without any version document.
   * `entitlementVersion` / `pricingVersion` are audit references only.
   */
  entitlementSnapshot: EntitlementSet
  /**
   * How the snapshot was established.
   * - `purchase`: frozen from the catalog at a genuine activation/plan change.
   * - `legacy_snapshot`: copied from a snapshot the record already carried.
   * - `legacy_mapping_provisional`: no historical snapshot existed; the
   *   record's current legacy-compatible resolution was frozen for review.
   *   The record is marked `needs_review`; this is not historical evidence.
   */
  entitlementEvidence: "purchase" | "legacy_snapshot" | "legacy_mapping_provisional"
  /** Entitlement catalog version the snapshot came from. */
  entitlementVersion: string
  /** Price book version the price was taken from. */
  pricingVersion: string
  /** When the subscription was activated. */
  activatedAt: number
  /** Effective paid period start (epoch ms). */
  periodStart: number
  /** Effective paid period end (epoch ms). */
  periodEnd: number
  /** How these terms were established. */
  source: "activation" | "migration"
}

/** Lifecycle of a subscription's pinned terms. */
export type SubscriptionTermsStatus = "pinned" | "needs_review" | "unpinned"

// ─── Subscription Record ─────────────────────────────────────────────────────

export interface SubscriptionRecord {
  _id?: ObjectId
  id: string
  userId: string
  /** External subscription ID from Dodo */
  dodoSubscriptionId: string
  dodoCustomerId?: string
  planId: string
  planName: string
  priceUSD: number
  mirrorCredits: number
  status: SubscriptionStatus
  /** Current billing period start */
  currentPeriodStart: number
  /** Current billing period end */
  currentPeriodEnd: number
  /** Next renewal date */
  nextBillingDate?: number
  /** Whether cancellation is scheduled at period end */
  cancelAtPeriodEnd: boolean
  /** When cancellation was requested */
  cancelledAt?: number
  /** When the subscription actually expired */
  expiredAt?: number
  // ─── Phase 3 entitlement migration fields (additive, non-breaking) ──────────
  /** New canonical commercial plan id (explorer/starter/growth/scale/enterprise). */
  commercialPlanId?: string
  /** Original Dodo-linked plan id, retained for renewal resolution. Never rename. */
  legacyPlanId?: string
  /**
   * The Dodo product id the customer actually purchased. Preserved verbatim
   * (ADR-2) so renewal resolution keeps working — the new free Explorer uses a
   * distinct product id (`DODO_PRODUCT_EXPLORER_V2`) so legacy + new never
   * collide. Additive; not used for renewal matching logic changes.
   */
  dodoProductId?: string
  /** Billing cadence. Additive — drives annual monthly-issuance scheduling. */
  billingCycle?: "monthly" | "annual"
  /** References entitlement_versions / plan_catalog_versions. */
  entitlementVersion?: string
  /** Frozen entitlement snapshot at migration/activation time. */
  entitlementSnapshot?: Record<string, unknown>
  /** References the priced plan_catalog_versions the subscriber is locked to. */
  pricingVersion?: string
  /** True if this subscriber is grandfathered onto legacy entitlements. */
  grandfathered?: boolean
  /** Until this timestamp the subscriber keeps legacy pricing/entitlements. */
  grandfatheredUntil?: number
  /** When the migration script set the fields above. */
  migratedAt?: number
  /** Batch id of the migration that touched this record (idempotency/reconciliation). */
  migrationBatchId?: string
  // ─── Phase A1 commercial-terms pinning (additive, non-breaking) ────────────
  /**
   * Frozen commercial terms purchased by this subscriber. Authoritative for
   * renewals, credit grants and entitlement resolution. Absent on records that
   * predate pinning; the migration fills it or marks `termsStatus`.
   */
  purchasedTerms?: PurchasedTerms
  /** Whether the record's terms are pinned, explicitly under review, or absent. */
  termsStatus?: SubscriptionTermsStatus
  /** Safe reason a record requires manual migration review. */
  termsReviewReason?: string
  /** When the terms migration touched this record. */
  termsMigratedAt?: number
  /** Batch id of the terms migration (idempotency/reconciliation). */
  termsMigrationBatchId?: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

// ─── Version References (pricing / entitlement catalogs) ─────────────────────

/**
 * A published entitlement catalog version. Referenced by
 * `SubscriptionRecord.entitlementVersion` / `PurchasedTerms.entitlementVersion`.
 * Immutable once written — a new catalog publishes a NEW version document.
 */
export interface EntitlementVersionRecord {
  _id?: ObjectId
  version: string
  createdAt: number
  /** Structural entitlement templates (counts zero) frozen at this version. */
  plans: Record<string, EntitlementSet>
  notes?: string
}

/**
 * A published price book version. Referenced by
 * `SubscriptionRecord.pricingVersion` / `PurchasedTerms.pricingVersion`.
 * Amounts are integer minor units.
 */
export interface PlanCatalogVersionRecord {
  _id?: ObjectId
  version: string
  priceBookVersion: string
  createdAt: number
  currency: string
  entries: Array<{
    planId: string
    commercialPlanId?: string
    billingInterval: BillingInterval
    priceMinor: number
    monthlyCredits: number | null
  }>
  notes?: string
}

// ─── User Billing Profile (Extended) ─────────────────────────────────────────

export interface UserBillingProfile {
  /** Current total available credits */
  totalCredits: number
  /** Subscription credits available */
  subscriptionCredits: number
  /** Permanent credits available */
  permanentCredits: number
  /** Active subscription ID */
  activeSubscriptionId?: string
  /** Active plan ID */
  activePlanId?: string
}

// ─── Reconciliation Entry ────────────────────────────────────────────────────

/** Every discrepancy type the reconciliation service can emit. */
export type ReconciliationIssueType =
  | "missing_credit_grant"
  | "duplicate_credit_grant"
  | "subscription_mismatch"
  | "renewal_mismatch"
  | "refund_without_reversal"
  | "ledger_balance_mismatch"
  | "payment_without_grant"
  | "grant_without_payment"
  | "duplicate_payment_records"
  | "refund_without_payment"
  | "reversal_without_refund"
  | "duplicate_refund_records"
  | "unexpected_ledger_entry"
  | "webhook_unresolved"
  | "webhook_failed_recovery"
  | "webhook_manual_review"
  | "payment_attribution_missing"
  | "subscription_period_mismatch"
  | "incomplete_record"

export interface ReconciliationIssue {
  id: string
  type: ReconciliationIssueType
  severity: "critical" | "warning" | "info"
  /** Review priority — maps from severity by default; operators re-rank manually. */
  priority?: number
  userId?: string
  referenceId?: string
  /** Related webhook / ledger / refund identifiers where the join is authoritative. */
  relatedIds?: string[]
  /** What the authoritative records say SHOULD be true. */
  expected?: string
  /** What was actually observed. */
  observed?: string
  description: string
  detectedAt: number
  /** "open" is the default for new findings; `resolved` kept for the
   * historical admin-route consumers. Findings are computed live — this field
   * is metadata for operator notes, never a trigger to rewrite records. */
  resolution?: "open" | "under_review" | "resolved" | "needs_business_decision"
  resolved?: boolean
  resolvedAt?: number
  resolvedBy?: string
}
