/**
 * Phase A2 — reconcile historical subscription payments with their real
 * credit grants (M-14).
 *
 * Run from the repo root with env loaded:
 *   npx tsx --env-file=.env.local scripts/reconcile-subscription-payments.ts dry-run
 *   npx tsx --env-file=.env.local scripts/reconcile-subscription-payments.ts apply
 *
 * `apply` only links a payment when exactly one real ledger grant can be
 * attributed to it. Ambiguous or missing evidence is marked
 * `grantStatus: "needs_review"` with a safe reason; no amount is invented.
 * Re-running is a no-op for already-reconciled payments.
 */
import { reconcileSubscriptionPayments } from "@/lib/billing/payment-reconciliation"

async function main() {
  const mode = process.argv[2] === "apply" ? "apply" : "dry-run"
  const report = await reconcileSubscriptionPayments({ mode })
  const { details, ...summary } = report

  console.log("SUMMARY:")
  console.log(JSON.stringify(summary, null, 2))

  const limit = 50
  console.log("\nDETAILS:")
  for (const d of details.slice(0, limit)) {
    console.log(
      `${d.action.toUpperCase().padEnd(6)} ${d.paymentId}${d.credits ? `  credits=${d.credits}` : ""}${d.reason ? `  reason=${d.reason}` : ""}`,
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
    console.log("\nApplied. Re-run 'dry-run' — 'linked' + 'needsReview' should now be 0 (idempotent).")
  }
}

main().catch((e) => {
  console.error("RECONCILIATION FAILED:", e)
  process.exit(1)
})
