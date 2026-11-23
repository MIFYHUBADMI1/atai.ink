/**
 * Undo one migration run (A′.2).
 *
 *   npx tsx --env-file=.env.local scripts/rollback-connected-businesses-v1.ts dry-run --run-id=<id>
 *   npx tsx --env-file=.env.local scripts/rollback-connected-businesses-v1.ts apply --run-id=<id>
 *
 * Only rows stamped with the run id are removed. Businesses created by founders
 * through the product are never in scope.
 */
import { rollbackMigration } from "@/lib/connected-business/rollback"

async function main() {
  const mode = process.argv[2] === "apply" ? "apply" : "dry-run"
  const runId = process.argv.find((argument) => argument.startsWith("--run-id="))?.slice(9)
  if (!runId) {
    console.error("A run id is required: --run-id=<id>")
    process.exitCode = 1
    return
  }

  const report = await rollbackMigration({ mode, runId })
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
