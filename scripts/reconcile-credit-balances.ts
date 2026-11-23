/**
 * Phase A3 — inspect and repair credit bucket/aggregate drift.
 *
 * Run from the repo root with env loaded:
 *   npx tsx --env-file=.env.local scripts/reconcile-credit-balances.ts dry-run
 *   npx tsx --env-file=.env.local scripts/reconcile-credit-balances.ts apply \
 *     --actor=ops@atai.ink --reason="repair legacy bucket drift"
 *
 * `apply` aligns the flat aggregates to the itemised buckets and writes one
 * ledger entry per changed credit type. It never creates or edits a bucket.
 */
import {
  auditCreditIntegrity,
  repairCreditBalance,
} from "@/lib/billing/credit-reconciliation"

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

async function main() {
  const mode = process.argv[2] === "apply" ? "apply" : "dry-run"
  const userId = flag("user")
  const parsedLimit = Number(flag("limit") ?? 250)
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 250
  const actor = flag("actor")
  const reason = flag("reason")

  const audit = await auditCreditIntegrity({ userId, limit })
  const needingRepair = new Map<string, string[]>()
  for (const finding of audit.findings) {
    if (finding.type !== "bucket_sum_mismatch" && finding.type !== "total_mismatch") continue
    const types = needingRepair.get(finding.userId) ?? []
    types.push(finding.type)
    needingRepair.set(finding.userId, types)
  }

  console.log("SUMMARY:")
  console.log(
    JSON.stringify(
      {
        mode,
        scanned: audit.scanned,
        truncated: audit.truncated,
        findings: audit.findings.length,
        usersNeedingRepair: needingRepair.size,
      },
      null,
      2,
    ),
  )

  const limitDetails = 50
  console.log("\nFINDINGS:")
  for (const finding of audit.findings.slice(0, limitDetails)) {
    console.log(
      `${finding.userId}  ${finding.type}  buckets=${finding.bucketSum}  subscription=${finding.subscriptionCredits}  total=${finding.totalCredits}`,
    )
  }
  if (audit.findings.length > limitDetails) {
    console.log(`... and ${audit.findings.length - limitDetails} more`)
  }

  if (mode === "dry-run") {
    console.log("\nDry run — nothing was written. Re-run with 'apply' to repair.")
    return
  }
  if (!actor || !reason) {
    console.error("apply requires --actor=<id> and --reason=<text>")
    process.exitCode = 1
    return
  }

  for (const id of needingRepair.keys()) {
    const result = await repairCreditBalance({ userId: id, actor, reason })
    console.log(
      `REPAIRED ${id}  subscription ${result.before.subscriptionCredits}->${result.after.subscriptionCredits}  total ${result.before.totalCredits}->${result.after.totalCredits}  ledger=${result.ledgerEntryIds.length}`,
    )
  }
}

main().catch((error) => {
  console.error("CREDIT RECONCILIATION FAILED:", error)
  process.exit(1)
})
