/**
 * Atai — Legacy → commercial entitlement migration (Phase 3, Gate 4).
 *
 * Idempotent, reconciliation-friendly migration that maps every existing
 * SubscriptionRecord to the new commercial model WITHOUT renaming the stored
 * `planId`/`dodoProductId` (ADR-2). It only *adds* the new fields
 * (commercialPlanId, entitlementSnapshot, entitlementVersion, pricingVersion,
 * grandfathered flags, migratedAt, migrationBatchId) and freezes a snapshot.
 *
 * Run order: `dry-run` → review the report → `apply`. Re-running `apply` is a
 * no-op for already-migrated records unless `force: true`.
 *
 * @module lib/billing/entitlements/migrate
 */

import { subscriptionRecordsCol, projectsCol } from "@/lib/db/collections"
import { ENTITLEMENT_VERSION } from "./catalog"
import { resolveCommercialPlan, isCommercialPlanId } from "./migration-map"
import { ensureCatalogVersionRecords } from "./versions"
import { PRICE_BOOK_PRE_VERSIONING } from "./price-book"
import { buildPurchasedTermsFromRecord } from "@/lib/billing/subscription-terms"
import type { PurchasedTerms, SubscriptionRecord, SubscriptionTermsStatus } from "@/lib/billing/billing-types"

export interface MigrationPayload {
  commercialPlanId: string
  legacyPlanId: string
  entitlementVersion: string
  /**
   * Only written when the record already carried a snapshot. A snapshot is
   * never fabricated from the live catalog; the terms migration records a
   * provisional review snapshot separately and flags the record.
   */
  entitlementSnapshot?: Record<string, unknown>
  pricingVersion: string
  grandfathered: boolean
  grandfatheredUntil?: number
  migratedAt: number
  migrationBatchId: string
}

export interface ComputeOpts {
  hasProjects?: boolean
  hasPermanentCredits?: boolean
  batchId: string
  now?: number
  /** Re-migrate even if a batch id is already present. */
  force?: boolean
}

/**
 * Pure: given a subscription record, decide whether it needs migration and
 * produce the additive payload. Does not touch the database. Idempotent — a
 * record already carrying a batch id (and a commercialPlanId) is "unchanged"
 * unless `force` is set.
 */
export function computeMigrationForRecord(
  sub: SubscriptionRecord,
  opts: ComputeOpts,
): { changed: boolean; payload?: MigrationPayload } {
  const alreadyMigrated = !!sub.migrationBatchId && sub.commercialPlanId != null && !opts.force
  if (alreadyMigrated) return { changed: false }
  // A record with pinned commercial terms already carries the authoritative
  // snapshot. Never rebuild/overwrite it from the live catalog.
  if (sub.purchasedTerms && !opts.force) return { changed: false }

  // A stored commercial id is authoritative. Only a record without one is
  // interpreted through the legacy id map (the two catalogs share names, and
  // the legacy `explorer` id means the old paid plan, not the free one).
  const resolved = isCommercialPlanId(sub.commercialPlanId)
    ? {
        commercialPlanId: sub.commercialPlanId,
        legacyPlanId: sub.planId,
        grandfathered: sub.grandfathered === true,
        preserveLegacyBehavior: sub.grandfathered === true,
      }
    : resolveCommercialPlan(sub.planId, {
        hasProjects: opts.hasProjects,
        hasPermanentCredits: opts.hasPermanentCredits,
      })

  const storedSnapshot = sub.entitlementSnapshot as Record<string, unknown> | undefined

  const payload: MigrationPayload = {
    commercialPlanId: resolved.commercialPlanId,
    legacyPlanId: resolved.legacyPlanId,
    entitlementVersion: ENTITLEMENT_VERSION,
    ...(storedSnapshot
      ? {
          // Preserve an existing historical snapshot verbatim. Never rebuild it
          // from the live catalog.
          entitlementSnapshot: JSON.parse(JSON.stringify(storedSnapshot)) as Record<string, unknown>,
        }
      : {}),
    pricingVersion: PRICE_BOOK_PRE_VERSIONING,
    grandfathered: resolved.grandfathered,
    migratedAt: opts.now ?? Date.now(),
    migrationBatchId: opts.batchId,
  }

  return { changed: true, payload }
}

export interface TermsMigrationPayload {
  purchasedTerms?: PurchasedTerms
  termsStatus: SubscriptionTermsStatus
  termsReviewReason?: string
  termsMigratedAt: number
  termsMigrationBatchId: string
}

/**
 * Pure: decide whether a subscription needs its commercial terms pinned.
 *
 * Where the record carries reliable original purchase evidence (a known plan
 * id plus its stored price and credit allocation), the terms are frozen from
 * that evidence — never from today's catalog. Where the evidence is missing,
 * the record is marked `needs_review` and nothing is fabricated.
 *
 * Idempotent: once a record carries a terms batch id and a status, re-running
 * is a no-op unless `force` is set.
 */
export function computePinnedTermsForRecord(
  sub: SubscriptionRecord,
  opts: { batchId: string; now?: number; force?: boolean; hasProjects?: boolean; hasPermanentCredits?: boolean },
): { changed: boolean; payload?: TermsMigrationPayload } {
  if (sub.purchasedTerms) return { changed: false }
  if (!opts.force && sub.termsMigrationBatchId && sub.termsStatus) return { changed: false }

  const now = opts.now ?? Date.now()
  const { terms, reviewReason } = buildPurchasedTermsFromRecord(sub, {
    now,
    hasProjects: opts.hasProjects,
    hasPermanentCredits: opts.hasPermanentCredits,
  })

  if (terms) {
    return {
      changed: true,
      payload: {
        purchasedTerms: terms,
        // Price/credits are reliable, but a missing entitlement snapshot must
        // stay visible for review even though the terms are frozen.
        termsStatus: reviewReason ? "needs_review" : "pinned",
        termsReviewReason: reviewReason,
        termsMigratedAt: now,
        termsMigrationBatchId: opts.batchId,
      },
    }
  }

  return {
    changed: true,
    payload: {
      termsStatus: "needs_review",
      termsReviewReason: reviewReason ?? "insufficient_purchase_evidence",
      termsMigratedAt: now,
      termsMigrationBatchId: opts.batchId,
    },
  }
}

export interface MigrationReport {
  mode: "dry-run" | "apply"
  batchId: string
  scanned: number
  changed: number
  skipped: number
  grandfathered: number
  termsPinned: number
  termsNeedsReview: number
  errors: Array<{ id: string; error: string }>
  details: Array<{
    id: string
    legacyPlanId: string
    commercialPlanId: string
    grandfathered: boolean
    changed: boolean
    termsStatus?: SubscriptionTermsStatus
    termsReviewReason?: string
  }>
}

export interface MigrateOpts {
  mode?: "dry-run" | "apply"
  batchId?: string
  force?: boolean
}

/**
 * Scan all subscription records and apply (or simulate) the migration. Safe to
 * run repeatedly; `apply` is idempotent per record.
 */
export async function migrateSubscriptionEntitlements(opts: MigrateOpts = {}): Promise<MigrationReport> {
  const mode = opts.mode ?? "dry-run"
  const batchId = opts.batchId ?? `mig_${Date.now()}`
  const col = await subscriptionRecordsCol()
  const subs = await col.find({}).toArray()

  const report: MigrationReport = {
    mode,
    batchId,
    scanned: 0,
    changed: 0,
    skipped: 0,
    grandfathered: 0,
    termsPinned: 0,
    termsNeedsReview: 0,
    errors: [],
    details: [],
  }

  if (mode === "apply") {
    // Publish the version documents the pinned terms reference (idempotent).
    await ensureCatalogVersionRecords()
  }

  for (const sub of subs) {
    report.scanned++
    try {
      // Determine legacy context: any project owned, or any permanent credits.
      const projCol = await projectsCol()
      const hasProjects = (await projCol.countDocuments({ userId: sub.userId })) > 0
      const hasPermanentCredits = (sub.mirrorCredits ?? 0) > 0

      const { changed, payload } = computeMigrationForRecord(sub, {
        hasProjects,
        hasPermanentCredits,
        batchId,
        force: opts.force,
      })

      // Terms pinning is a separate, independently idempotent pass so records
      // already migrated for entitlements still get their commercial terms.
      const terms = computePinnedTermsForRecord(sub, {
        batchId,
        force: opts.force,
        hasProjects,
        hasPermanentCredits,
      })

      const recordChanged = changed || terms.changed
      if (recordChanged) report.changed++
      else report.skipped++
      if (payload?.grandfathered) report.grandfathered++
      if (terms.payload?.termsStatus === "pinned") report.termsPinned++
      if (terms.payload?.termsStatus === "needs_review") report.termsNeedsReview++

      if (mode === "apply") {
        if (changed && payload) {
          await col.updateOne({ id: sub.id }, { $set: payload as unknown as Record<string, unknown> })
        }
        if (terms.changed && terms.payload) {
          await col.updateOne(
            { id: sub.id },
            { $set: terms.payload as unknown as Record<string, unknown> },
          )
        }
      }

      report.details.push({
        id: sub.id,
        legacyPlanId: sub.planId,
        commercialPlanId: payload?.commercialPlanId ?? sub.commercialPlanId ?? "(unchanged)",
        grandfathered: payload?.grandfathered ?? !!sub.grandfathered,
        changed: recordChanged,
        termsStatus: terms.payload?.termsStatus ?? sub.termsStatus,
        termsReviewReason: terms.payload?.termsReviewReason ?? sub.termsReviewReason,
      })
    } catch (err) {
      report.errors.push({ id: sub.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return report
}
