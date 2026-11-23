/**
 * Legacy project → connected business migration (A′.2).
 *
 *   npx tsx --env-file=.env.local scripts/migrate-connected-businesses-v1.ts dry-run
 *   npx tsx --env-file=.env.local scripts/migrate-connected-businesses-v1.ts apply --run-id=2026-11-23-a
 *
 * Scope a run with `--project=<id>` (repeatable) or `--user=<id>` (repeatable).
 * Dry run is the default and writes nothing. Apply is idempotent: a project
 * that already has a business carrying its `legacyProjectId` is skipped.
 */
import { randomUUID } from "node:crypto"

import { migrateConnectedBusinesses } from "@/lib/connected-business/migrate"

function repeated(flag: string): string[] {
  return process.argv
    .filter((argument) => argument.startsWith(`--${flag}=`))
    .map((argument) => argument.slice(flag.length + 3))
    .filter(Boolean)
}

async function main() {
  const mode = process.argv[2] === "apply" ? "apply" : "dry-run"
  const runId = process.argv.find((argument) => argument.startsWith("--run-id="))?.slice(9) || randomUUID()
  const limit = Number(process.argv.find((argument) => argument.startsWith("--limit="))?.slice(8) ?? "") || undefined

  const report = await migrateConnectedBusinesses({
    mode,
    runId,
    projectIds: repeated("project"),
    userIds: repeated("user"),
    limit,
  })

  const { items, ...summary } = report
  console.log("SUMMARY:")
  console.log(JSON.stringify(summary, null, 2))

  console.log("\nITEMS:")
  for (const item of items.slice(0, 100)) {
    console.log(
      [item.status, item.projectId, item.businessId ?? "-", item.applicationId ?? "-", item.warning ?? item.error ?? ""]
        .join("  ")
        .trimEnd(),
    )
  }
  if (items.length > 100) console.log(`... ${items.length - 100} more`)

  if (report.failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
