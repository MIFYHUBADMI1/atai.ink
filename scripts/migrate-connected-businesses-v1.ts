/**
 * Legacy project → connected business migration (A′.2).
 *
 *   npx tsx --env-file=.env.local scripts/migrate-connected-businesses-v1.ts dry-run
 *   npx tsx --env-file=.env.local scripts/migrate-connected-businesses-v1.ts apply --run-id=2026-11-23-a
 *
 * `apply` requires `--run-id`: it is the handle a rollback needs, so it must be
 * a value the operator chose and recorded, never a generated one.
 *
 * Scope a run with `--project=<id>` (repeatable) or `--user=<id>` (repeatable).
 * Dry run is the default and writes nothing. Apply is idempotent: a project
 * that already has a business carrying its `legacyProjectId` is skipped.
 */
import { randomUUID } from "node:crypto"

import { CliUsageError, flagValue, flagValues, limitOf, parseMode, resolveRunId } from "@/lib/connected-business/cli"
import { migrateConnectedBusinesses } from "@/lib/connected-business/migrate"
import { closeDatabase } from "@/lib/db/shutdown"

async function main() {
  const mode = parseMode(process.argv)
  let runId: string
  try {
    runId = resolveRunId({ mode, explicit: flagValue(process.argv, "run-id"), generate: randomUUID })
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }

  const report = await migrateConnectedBusinesses({
    mode,
    runId,
    projectIds: flagValues(process.argv, "project"),
    userIds: flagValues(process.argv, "user"),
    limit: limitOf(process.argv),
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

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())
