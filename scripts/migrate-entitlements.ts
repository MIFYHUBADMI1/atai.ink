/**
 * Entitlement migration runner (Phase 3, Gate 4).
 *
 * Run from the repo root with env loaded:
 *   npx tsx --env-file=.env.local scripts/migrate-entitlements.ts dry-run
 *   npx tsx --env-file=.env.local scripts/migrate-entitlements.ts apply
 *
 * Target another env file:
 *   npx tsx --env-file=.env.production scripts/migrate-entitlements.ts dry-run
 *
 * Safe: `apply` only ADDS commercial-plan metadata, pinned `purchasedTerms`
 * reconstructed from the record's own evidence, and a frozen
 * `entitlementSnapshot` when the record already carried one. It NEVER
 * fabricates a snapshot from the live catalog, NEVER renames the stored
 * `planId`/`dodoProductId`, and does not enable enforcement. Records without
 * reliable historical evidence are marked `termsStatus: "needs_review"`.
 * Re-running is a no-op for already-migrated records unless you pass `--force`.
 */
import { migrateSubscriptionEntitlements } from "@/lib/billing/entitlements/migrate"

async function main() {
  const mode = process.argv[2] === "apply" ? "apply" : "dry-run"
  const force = process.argv.includes("--force")

  const report = await migrateSubscriptionEntitlements({ mode, force })
  const { details, ...summary } = report

  console.log("SUMMARY:")
  console.log(JSON.stringify(summary, null, 2))

  const limit = 50
  console.log("\nDETAILS:")
  for (const d of details.slice(0, limit)) {
    const terms = d.termsStatus ? `  terms=${d.termsStatus}${d.termsReviewReason ? `(${d.termsReviewReason})` : ""}` : ""
    console.log(
      `${d.changed ? "MIGRATE" : "skip   "} ${d.id}  ${d.legacyPlanId} -> ${d.commercialPlanId}${d.grandfathered ? " (grandfathered)" : ""}${terms}`,
    )
  }
  if (details.length > limit) console.log(`... and ${details.length - limit} more`)

  if (report.errors.length > 0) {
    console.log("\nERRORS:")
    for (const e of report.errors) console.log(`  ${e.id}: ${e.error}`)
  }

  if (mode === "dry-run") {
    console.log("\nDry run — nothing was written. Re-run with 'apply' to persist.")
  } else {
    console.log("\nApplied. Re-run 'dry-run' — 'changed' should now be 0 (idempotent).")
  }
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e)
  process.exit(1)
})
