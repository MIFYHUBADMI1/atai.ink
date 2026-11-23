/**
 * Atai — Pinned subscription commercial terms (Phase A1).
 *
 * A subscription's price, credit allocation and entitlement snapshot are
 * resolved ONCE, when the subscription is activated, and stored on the
 * subscription record. Renewals, annual issuance and entitlement resolution
 * read the pinned terms — never the live catalog. Publishing a new catalog can
 * therefore never change what an existing subscriber purchased.
 *
 * This module contains the pure resolution logic so it can be tested without a
 * database. Persistence lives in `activate-subscription.ts` and `migrate.ts`.
 *
 * @module lib/billing/subscription-terms
 */

import { buildEntitlementSet, ENTITLEMENT_VERSION } from "@/lib/billing/entitlements/catalog"
import {
  resolveCommercialPlan,
  isCommercialPlanId,
  LEGACY_TO_COMMERCIAL,
} from "@/lib/billing/entitlements/migration-map"
import {
  PRICE_BOOK_VERSION,
  PRICE_BOOK_PRE_VERSIONING,
  PRICE_BOOK_CURRENCY,
  commercialPriceMinor,
  legacyPriceMinor,
  legacyUsdToMinorUnits,
} from "@/lib/billing/entitlements/price-book"
import type { CommercialPlan } from "@/lib/billing/entitlements/commercial-plans"
import type { CommercialPlanId, EntitlementSet } from "@/lib/billing/entitlements/types"
import type { SubscriptionPlan } from "@/lib/billing/config"
import type {
  BillingInterval,
  PurchasedTerms,
  SubscriptionRecord,
} from "@/lib/billing/billing-types"

export const ZERO_COUNTS = {
  businesses: 0,
  productionApps: 0,
  subdomains: 0,
  customDomainsConsumed: 0,
} as const

/** Snapshots are plain JSON documents; copy so no caller can mutate a stored one. */
function cloneSnapshot(set: EntitlementSet): EntitlementSet {
  return JSON.parse(JSON.stringify(set)) as EntitlementSet
}

/** Free plan ids never carry a monthly credit allocation. */
const FREE_PLAN_IDS = new Set(["free", "explorer"])

/** A plan id is known when it is a commercial id or a legacy catalog id. */
function isKnownPlanId(id: string | undefined): boolean {
  if (!id) return false
  return isCommercialPlanId(id) || Object.prototype.hasOwnProperty.call(LEGACY_TO_COMMERCIAL, id)
}

export interface TermsContext {
  subscriptionRecordId: string
  dodoSubscriptionId: string
  dodoProductId?: string
  activatedAt: number
  periodStart: number
  periodEnd: number
}

function annualAllocation(monthlyCredits: number): PurchasedTerms["annual"] {
  return {
    months: 12,
    monthlyCredits,
    totalCredits: monthlyCredits * 12,
    issuance: "monthly",
  }
}

function assembleTerms(
  ctx: TermsContext,
  fields: {
    planId: string
    commercialPlanId?: CommercialPlanId
    planName: string
    billingInterval: BillingInterval
    priceMinor: number
    monthlyCredits: number
    entitlementSnapshot: EntitlementSet
    entitlementEvidence: PurchasedTerms["entitlementEvidence"]
    entitlementVersion: string
    pricingVersion: string
    source: "activation" | "migration"
  },
): PurchasedTerms {
  return {
    subscriptionId: ctx.subscriptionRecordId,
    dodoSubscriptionId: ctx.dodoSubscriptionId,
    dodoProductId: ctx.dodoProductId,
    planId: fields.planId,
    commercialPlanId: fields.commercialPlanId,
    planName: fields.planName,
    billingInterval: fields.billingInterval,
    priceMinor: fields.priceMinor,
    currency: PRICE_BOOK_CURRENCY,
    monthlyCredits: fields.monthlyCredits,
    annual: fields.billingInterval === "annual" ? annualAllocation(fields.monthlyCredits) : undefined,
    entitlementSnapshot: cloneSnapshot(fields.entitlementSnapshot),
    entitlementEvidence: fields.entitlementEvidence,
    entitlementVersion: fields.entitlementVersion,
    pricingVersion: fields.pricingVersion,
    activatedAt: ctx.activatedAt,
    periodStart: ctx.periodStart,
    periodEnd: ctx.periodEnd,
    source: fields.source,
  }
}

/** Terms for a purchase from the current commercial catalog. */
export function buildCommercialPurchasedTerms(
  ctx: TermsContext,
  plan: CommercialPlan,
  billingInterval: BillingInterval,
): PurchasedTerms {
  const monthlyCredits = plan.mirrorCredits
  const priceMinor =
    commercialPriceMinor(plan.commercialPlanId, billingInterval) ??
    legacyUsdToMinorUnits(
      billingInterval === "annual" ? plan.annualPriceUSD ?? plan.priceUSD : plan.priceUSD,
    )
  const snapshot = buildEntitlementSet(plan.commercialPlanId, ZERO_COUNTS, {
    legacyPlanId: plan.id,
    grandfathered: false,
    preserveLegacyBehavior: false,
  })
  return assembleTerms(ctx, {
    planId: plan.id,
    commercialPlanId: plan.commercialPlanId,
    planName: plan.name,
    billingInterval,
    priceMinor,
    monthlyCredits,
    entitlementSnapshot: snapshot,
    entitlementEvidence: "purchase",
    entitlementVersion: ENTITLEMENT_VERSION,
    pricingVersion: PRICE_BOOK_VERSION,
    source: "activation",
  })
}

export interface CatalogTermsInput {
  planId: string
  planName: string
  commercialPlanId?: CommercialPlanId
  billingInterval: BillingInterval
  priceMinor: number
  monthlyCredits: number
  entitlementSnapshot: EntitlementSet
  entitlementVersion: string
  pricingVersion: string
}

/** Terms for a purchase resolved from an active database catalog version. */
export function buildCatalogPurchasedTerms(
  ctx: TermsContext,
  input: CatalogTermsInput,
): PurchasedTerms {
  return assembleTerms(ctx, {
    planId: input.planId,
    commercialPlanId: input.commercialPlanId,
    planName: input.planName,
    billingInterval: input.billingInterval,
    priceMinor: input.priceMinor,
    monthlyCredits: input.monthlyCredits,
    entitlementSnapshot: input.entitlementSnapshot,
    entitlementEvidence: "purchase",
    entitlementVersion: input.entitlementVersion,
    pricingVersion: input.pricingVersion,
    source: "activation",
  })
}

/** Terms for a purchase from the legacy catalog (pre-existing Dodo products). */
export function buildLegacyPurchasedTerms(
  ctx: TermsContext,
  plan: SubscriptionPlan,
  billingInterval: BillingInterval,
): PurchasedTerms {
  const resolved = resolveCommercialPlan(plan.id)
  const snapshot = buildEntitlementSet(resolved.commercialPlanId, ZERO_COUNTS, {
    legacyPlanId: resolved.legacyPlanId,
    grandfathered: resolved.grandfathered,
    preserveLegacyBehavior: resolved.preserveLegacyBehavior,
  })
  return assembleTerms(ctx, {
    planId: plan.id,
    commercialPlanId: resolved.commercialPlanId,
    planName: plan.name,
    billingInterval,
    priceMinor: legacyPriceMinor(plan.id) ?? legacyUsdToMinorUnits(plan.priceUSD),
    monthlyCredits: plan.mirrorCredits,
    entitlementSnapshot: snapshot,
    entitlementEvidence: "purchase",
    entitlementVersion: ENTITLEMENT_VERSION,
    pricingVersion: PRICE_BOOK_VERSION,
    source: "activation",
  })
}

export interface RecordTermsResult {
  terms?: PurchasedTerms
  reviewReason?: string
}

/**
 * Reconstruct pinned terms from an EXISTING subscription record. The record's
 * own stored plan id, price, credits and periods are the original purchase
 * evidence; today's catalog is never consulted for the amounts. Returns a
 * review reason instead of inventing anything when that evidence is missing.
 */
export function buildPurchasedTermsFromRecord(
  sub: SubscriptionRecord,
  opts: { now?: number; hasProjects?: boolean; hasPermanentCredits?: boolean } = {},
): RecordTermsResult {
  if (!sub.planId) return { reviewReason: "missing_plan_id" }
  if (!sub.dodoSubscriptionId) return { reviewReason: "missing_dodo_subscription_id" }

  // Prefer the explicitly recorded commercial id. Otherwise treat `planId` as
  // the historical (legacy) id — the legacy ids share names with commercial
  // ones, and the legacy mapping is the correct historical interpretation.
  const storedCommercialId = isCommercialPlanId(sub.commercialPlanId) ? sub.commercialPlanId : undefined
  if (!storedCommercialId && !isKnownPlanId(sub.planId)) {
    return { reviewReason: `unknown_plan_id:${sub.planId}` }
  }

  const isFree = FREE_PLAN_IDS.has(sub.planId) && (sub.priceUSD ?? 0) === 0
  const monthlyCredits = sub.mirrorCredits
  if (!Number.isInteger(monthlyCredits) || monthlyCredits < 0) {
    return { reviewReason: "invalid_credit_allocation" }
  }
  if (!isFree && monthlyCredits <= 0) {
    return { reviewReason: "missing_credit_allocation" }
  }
  if (typeof sub.priceUSD !== "number" || !Number.isFinite(sub.priceUSD) || sub.priceUSD < 0) {
    return { reviewReason: "missing_purchased_price" }
  }

  const billingInterval: BillingInterval = sub.billingCycle === "annual" ? "annual" : "monthly"
  const priceMinor = legacyUsdToMinorUnits(sub.priceUSD)
  const currentPrice = storedCommercialId
    ? commercialPriceMinor(storedCommercialId, billingInterval)
    : legacyPriceMinor(sub.planId)
  const pricingVersion =
    sub.pricingVersion ??
    (currentPrice !== undefined && currentPrice === priceMinor
      ? PRICE_BOOK_VERSION
      : PRICE_BOOK_PRE_VERSIONING)

  const legacyResolved = resolveCommercialPlan(sub.planId, {
    hasProjects: opts.hasProjects,
    hasPermanentCredits: opts.hasPermanentCredits,
  })
  const commercialPlanId = storedCommercialId ?? legacyResolved.commercialPlanId
  const needsReview = sub.termsStatus === "needs_review"
  const grandfathered = sub.grandfathered === true || needsReview || legacyResolved.grandfathered
  const preserveLegacyBehavior =
    sub.grandfathered === true || needsReview || legacyResolved.preserveLegacyBehavior
  const storedSnapshot = sub.entitlementSnapshot as EntitlementSet | undefined
  // A stored snapshot is reliable historical evidence and is copied verbatim.
  // Without one, the record's current legacy-compatible resolution is frozen
  // only as a PROVISIONAL review snapshot — never presented as historical truth.
  const entitlementEvidence: PurchasedTerms["entitlementEvidence"] = storedSnapshot
    ? "legacy_snapshot"
    : "legacy_mapping_provisional"
  const entitlementSnapshot =
    storedSnapshot ??
    buildEntitlementSet(commercialPlanId, ZERO_COUNTS, {
      legacyPlanId: sub.legacyPlanId ?? legacyResolved.legacyPlanId,
      grandfathered,
      preserveLegacyBehavior,
    })

  const activatedAt = sub.createdAt || sub.currentPeriodStart || opts.now || Date.now()
  const periodStart = sub.currentPeriodStart || activatedAt
  const periodEnd = sub.currentPeriodEnd || periodStart

  return {
    terms: assembleTerms(
      {
        subscriptionRecordId: sub.id,
        dodoSubscriptionId: sub.dodoSubscriptionId,
        dodoProductId: sub.dodoProductId,
        activatedAt,
        periodStart,
        periodEnd,
      },
      {
        planId: sub.planId,
        commercialPlanId,
        planName: sub.planName || sub.planId,
        billingInterval,
        priceMinor,
        monthlyCredits,
        entitlementSnapshot,
        entitlementEvidence,
        entitlementVersion:
          entitlementSnapshot.entitlementVersion ?? sub.entitlementVersion ?? ENTITLEMENT_VERSION,
        pricingVersion,
        source: "migration",
      },
    ),
    // Reliable price/credits can still be pinned, but missing entitlement
    // evidence must be surfaced rather than silently treated as historical.
    reviewReason: storedSnapshot ? undefined : "missing_entitlement_snapshot",
  }
}

export interface RenewalAllocation {
  userId: string
  planId: string
  commercialPlanId?: CommercialPlanId
  billingInterval: BillingInterval
  monthlyCredits: number
  dodoProductId?: string
  source: "pinned_terms" | "legacy_record" | "catalog"
}

export interface CatalogAllocation {
  planId: string
  planName: string
  commercialPlanId?: CommercialPlanId
  billingCycle: BillingInterval
  monthlyCredits: number
  dodoProductId?: string
}

export type RenewalResolution =
  | { ok: true; allocation: RenewalAllocation }
  | { ok: false; reason: string }

/**
 * Decide the credit allocation for a renewal.
 *
 * Priority: the subscription's pinned terms, then its own stored legacy
 * allocation, then the resolved purchased product. The live catalog is only a
 * last resort when there is no subscription record at all (e.g. a renewal
 * delivered before activation). A record with no usable allocation is a
 * reconciliation finding — never silently re-priced from today's catalog.
 */
export function resolveRenewalAllocation(params: {
  subscription: SubscriptionRecord | null
  catalogAllocation?: CatalogAllocation
}): RenewalResolution {
  const { subscription: sub, catalogAllocation } = params

  if (sub) {
    const pinned = sub.purchasedTerms
    if (pinned && Number.isInteger(pinned.monthlyCredits) && pinned.monthlyCredits > 0) {
      return {
        ok: true,
        allocation: {
          userId: sub.userId,
          planId: pinned.planId,
          commercialPlanId: pinned.commercialPlanId,
          billingInterval: pinned.billingInterval,
          monthlyCredits: pinned.monthlyCredits,
          dodoProductId: pinned.dodoProductId,
          source: "pinned_terms",
        },
      }
    }

    const storedCredits = sub.mirrorCredits
    if (isKnownPlanId(sub.planId) && Number.isInteger(storedCredits) && storedCredits > 0) {
      return {
        ok: true,
        allocation: {
          userId: sub.userId,
          planId: sub.planId,
          commercialPlanId: isCommercialPlanId(sub.commercialPlanId)
            ? sub.commercialPlanId
            : isCommercialPlanId(sub.planId)
              ? sub.planId
              : undefined,
          billingInterval: sub.billingCycle === "annual" ? "annual" : "monthly",
          monthlyCredits: storedCredits,
          dodoProductId: sub.dodoProductId,
          source: "legacy_record",
        },
      }
    }

    return { ok: false, reason: "subscription_terms_missing" }
  }

  if (catalogAllocation && Number.isInteger(catalogAllocation.monthlyCredits) && catalogAllocation.monthlyCredits > 0) {
    return {
      ok: true,
      allocation: {
        userId: "",
        planId: catalogAllocation.planId,
        commercialPlanId: catalogAllocation.commercialPlanId,
        billingInterval: catalogAllocation.billingCycle,
        monthlyCredits: catalogAllocation.monthlyCredits,
        dodoProductId: catalogAllocation.dodoProductId,
        source: "catalog",
      },
    }
  }

  return { ok: false, reason: "unresolvable_subscription_terms" }
}

/**
 * Monthly credit allocation for an annual subscription's scheduled issuance.
 * Reads pinned terms first, then the record's stored allocation. Returns
 * undefined when neither exists — the sweep must report that, not guess.
 */
export function annualMonthlyAllocation(sub: SubscriptionRecord): number | undefined {
  // The pinned annual rules win over the general monthly allocation.
  const annual = sub.purchasedTerms?.annual?.monthlyCredits
  if (typeof annual === "number" && Number.isInteger(annual) && annual > 0) return annual
  const pinned = sub.purchasedTerms?.monthlyCredits
  if (typeof pinned === "number" && Number.isInteger(pinned) && pinned > 0) return pinned
  if (Number.isInteger(sub.mirrorCredits) && sub.mirrorCredits > 0) return sub.mirrorCredits
  return undefined
}

/** Frozen entitlement snapshot from pinned terms or the legacy snapshot field. */
export function pinnedEntitlementSnapshot(sub: SubscriptionRecord): EntitlementSet | undefined {
  return sub.purchasedTerms?.entitlementSnapshot ?? (sub.entitlementSnapshot as EntitlementSet | undefined)
}
