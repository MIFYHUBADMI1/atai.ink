/**
 * Undo one migration run (A′.2, guarded in A′.6).
 *
 *   npx tsx --env-file=.env.local scripts/rollback-connected-businesses-v1.ts dry-run --run-id=<id>
 *   npx tsx --env-file=.env.local scripts/rollback-connected-businesses-v1.ts apply --run-id=<id>
 *
 * Only rows stamped with the run id are removed, and only when no founder has
 * used them. If any affected business was renamed, gained a member or gained an
 * application, the run is refused and nothing is deleted.
 *
 * `--allow-in-use` is the separately authorised recovery procedure: it proceeds
 * after printing what it will orphan. Read the dry-run first.
 */
import { CliUsageError, parseMode, requireRunId } from "@/lib/connected-business/cli"
import { rollbackMigration } from "@/lib/connected-business/rollback"
import { closeDatabase } from "@/lib/db/shutdown"

async function main() {
  const mode = parseMode(process.argv)
  let runId: string
  try {
    runId = requireRunId(process.argv)
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }

  const allowInUse = process.argv.includes("--allow-in-use")
  const report = await rollbackMigration({ mode, runId, allowInUse })

  const { impact, ...summary } = report
  console.log(JSON.stringify(summary, null, 2))

  if (impact.length) {
    console.log("\nIMPACT:")
    for (const entry of impact) {
      const flags = [
        entry.modified ? "modified" : "",
        entry.foreignMemberships ? `${entry.foreignMemberships} added member(s)` : "",
        entry.foreignApplications ? `${entry.foreignApplications} added application(s)` : "",
        entry.changedChildren ? `${entry.changedChildren} changed child row(s)` : "",
      ].filter(Boolean)
      console.log(`  ${entry.businessId}  ${entry.name}  ${flags.length ? flags.join(", ") : "untouched"}`)
    }
  }

  if (report.blocked && !report.applied) {
    console.error(
      "\nRefused: these businesses have been used since the migration. Nothing was deleted.\n" +
        "Resolve the listed activity, or re-run with --allow-in-use after reading the impact above.",
    )
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())
