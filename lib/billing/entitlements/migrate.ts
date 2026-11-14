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
import { buildEntitlementSet, ENTITLEMENT_VERSION } from "./catalog"
import { resolveCommercialPlan } from "./migration-map"
import type { SubscriptionRecord } from "@/lib/billing/billing-types"
import type { EntitlementSet } from "./types"

const ZERO_COUNTS = { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 }

export interface MigrationPayload {
  commercialPlanId: string
  legacyPlanId: string
  entitlementVersion: string
  entitlementSnapshot: Record<string, unknown>
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

  const resolved = resolveCommercialPlan(sub.planId, {
    hasProjects: opts.hasProjects,
    hasPermanentCredits: opts.hasPermanentCredits,
  })

  const snapshot: EntitlementSet = buildEntitlementSet(
    resolved.commercialPlanId,
    ZERO_COUNTS,
    {
      legacyPlanId: resolved.legacyPlanId,
      grandfathered: resolved.grandfathered,
      preserveLegacyBehavior: resolved.preserveLegacyBehavior,
    },
  )

  const payload: MigrationPayload = {
    commercialPlanId: resolved.commercialPlanId,
    legacyPlanId: resolved.legacyPlanId,
    entitlementVersion: ENTITLEMENT_VERSION,
    // Mongo stores plain documents; strip the typed view to a plain object.
    entitlementSnapshot: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
    pricingVersion: ENTITLEMENT_VERSION,
    grandfathered: resolved.grandfathered,
    migratedAt: opts.now ?? Date.now(),
    migrationBatchId: opts.batchId,
  }

  return { changed: true, payload }
}

export interface MigrationReport {
  mode: "dry-run" | "apply"
  batchId: string
  scanned: number
  changed: number
  skipped: number
  grandfathered: number
  errors: Array<{ id: string; error: string }>
  details: Array<{
    id: string
    legacyPlanId: string
    commercialPlanId: string
    grandfathered: boolean
    changed: boolean
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
    errors: [],
    details: [],
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

      if (changed && payload) {
        report.changed++
        if (payload.grandfathered) report.grandfathered++
        if (mode === "apply") {
          await col.updateOne({ id: sub.id }, { $set: payload as unknown as Record<string, unknown> })
        }
      } else {
        report.skipped++
      }

      report.details.push({
        id: sub.id,
        legacyPlanId: sub.planId,
        commercialPlanId: payload?.commercialPlanId ?? sub.commercialPlanId ?? "(unchanged)",
        grandfathered: payload?.grandfathered ?? !!sub.grandfathered,
        changed,
      })
    } catch (err) {
      report.errors.push({ id: sub.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return report
}
