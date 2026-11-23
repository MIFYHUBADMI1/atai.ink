/**
 * Atai — Published catalog version records (Phase A1).
 *
 * `SubscriptionRecord.entitlementVersion` / `.pricingVersion` and
 * `PurchasedTerms.entitlementVersion` / `.pricingVersion` are references. This
 * module makes those references resolvable by seeding one immutable document
 * per version in `entitlement_versions` and `plan_catalog_versions`.
 *
 * Seeding is idempotent (`$setOnInsert` on the unique version key): re-running
 * it never rewrites a published version. A catalog change must publish a NEW
 * version string instead of mutating an existing document.
 *
 * @module lib/billing/entitlements/versions
 */

import { entitlementVersionsCol, planCatalogVersionsCol } from "@/lib/db/collections"
import { buildEntitlementSet, ENTITLEMENT_VERSION, PROVISIONAL_MONTHLY_CREDITS } from "./catalog"
import {
  COMMERCIAL_PRICE_BOOK_MINOR,
  LEGACY_PRICE_BOOK_MINOR,
  PRICE_BOOK_CURRENCY,
  PRICE_BOOK_PRE_VERSIONING,
  PRICE_BOOK_VERSION,
} from "./price-book"
import { LEGACY_SUBSCRIPTION_PLANS } from "@/lib/billing/config"
import { logger } from "@/lib/logging/logger"
import type { CommercialPlanId, EntitlementSet } from "./types"
import type { BillingInterval, PlanCatalogVersionRecord } from "@/lib/billing/billing-types"

const ZERO_COUNTS = { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 }
const COMMERCIAL_IDS: CommercialPlanId[] = ["explorer", "starter", "growth", "scale", "enterprise"]

function entitlementPlanTemplates(): Record<string, EntitlementSet> {
  const plans: Record<string, EntitlementSet> = {}
  for (const id of COMMERCIAL_IDS) {
    plans[id] = buildEntitlementSet(id, ZERO_COUNTS)
  }
  return plans
}

function priceBookEntries(): PlanCatalogVersionRecord["entries"] {
  const entries: PlanCatalogVersionRecord["entries"] = []
  for (const [planId, prices] of Object.entries(COMMERCIAL_PRICE_BOOK_MINOR)) {
    for (const interval of ["monthly", "annual"] as BillingInterval[]) {
      const priceMinor = prices[interval]
      if (priceMinor === null) continue
      entries.push({
        planId,
        commercialPlanId: planId,
        billingInterval: interval,
        priceMinor,
        monthlyCredits: PROVISIONAL_MONTHLY_CREDITS[planId as CommercialPlanId] ?? null,
      })
    }
  }
  for (const plan of LEGACY_SUBSCRIPTION_PLANS) {
    const priceMinor = LEGACY_PRICE_BOOK_MINOR[plan.id]
    if (priceMinor === undefined) continue
    entries.push({
      planId: plan.id,
      billingInterval: "monthly",
      priceMinor,
      monthlyCredits: plan.mirrorCredits,
    })
  }
  return entries
}

/**
 * Ensure the current entitlement catalog version and price book versions are
 * published. Safe to call on every activation and from the migration runner.
 */
export async function ensureCatalogVersionRecords(now: number = Date.now()): Promise<void> {
  const entitlementVersions = await entitlementVersionsCol()
  await entitlementVersions.updateOne(
    { version: ENTITLEMENT_VERSION },
    {
      $setOnInsert: {
        version: ENTITLEMENT_VERSION,
        createdAt: now,
        plans: entitlementPlanTemplates(),
      },
    },
    { upsert: true },
  )

  const planCatalogVersions = await planCatalogVersionsCol()
  await planCatalogVersions.updateOne(
    { version: PRICE_BOOK_VERSION },
    {
      $setOnInsert: {
        version: PRICE_BOOK_VERSION,
        priceBookVersion: PRICE_BOOK_VERSION,
        createdAt: now,
        currency: PRICE_BOOK_CURRENCY,
        entries: priceBookEntries(),
      },
    },
    { upsert: true },
  )
  await planCatalogVersions.updateOne(
    { version: PRICE_BOOK_PRE_VERSIONING },
    {
      $setOnInsert: {
        version: PRICE_BOOK_PRE_VERSIONING,
        priceBookVersion: PRICE_BOOK_PRE_VERSIONING,
        createdAt: now,
        currency: PRICE_BOOK_CURRENCY,
        entries: [],
        notes:
          "Prices reconstructed from subscription records that predate the price book; amounts are taken from each record's stored priceUSD, never from the live catalog.",
      },
    },
    { upsert: true },
  )
  // Historical records written by the Phase 3 migration used the entitlement
  // version string as their pricing reference. Seed it so that reference is
  // resolvable rather than dangling (M-07).
  await planCatalogVersions.updateOne(
    { version: ENTITLEMENT_VERSION },
    {
      $setOnInsert: {
        version: ENTITLEMENT_VERSION,
        priceBookVersion: ENTITLEMENT_VERSION,
        createdAt: now,
        currency: PRICE_BOOK_CURRENCY,
        entries: [],
        notes:
          "Legacy pricing reference written before the price book existed. No versioned amounts are attached; resolve each record's price from its own stored fields.",
      },
    },
    { upsert: true },
  )
}

/** Best-effort wrapper for activation: a version-seed failure must not block a paid purchase. */
export async function ensureCatalogVersionRecordsSafe(): Promise<void> {
  try {
    await ensureCatalogVersionRecords()
  } catch (err) {
    // Version documents are audit references only. The subscription's embedded
    // `purchasedTerms.entitlementSnapshot` is independently sufficient to
    // interpret its entitlements, so a missing version document can never
    // change what the subscriber purchased. The migration `apply` retries the
    // seed; this log is the signal to run it.
    logger.warn("billing.versions", "catalog version seeding failed; embedded snapshots remain authoritative", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
