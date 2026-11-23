/**
 * Read-only readiness check before migrating legacy projects (A′.9).
 *
 *   npx tsx --env-file=.env.local scripts/preflight-connected-business-migration.ts
 *
 * Writes nothing. Exits 1 when the answer is no-go, so it can gate a deploy
 * pipeline or a shell `&&` chain. Run it again immediately before every apply:
 * the answer depends on the data, and the data moves.
 */
import { preflightConnectedBusinessMigration } from "@/lib/connected-business/preflight"
import { closeDatabase } from "@/lib/db/shutdown"

async function main() {
  const report = await preflightConnectedBusinessMigration()

  console.log(`VERDICT: ${report.verdict.toUpperCase()}`)
  console.log(`Transactions available: ${report.transactions ? "yes" : "no"}`)
  console.log(`Missing indexes: ${report.missingIndexes.length ? report.missingIndexes.join(", ") : "none"}`)

  console.log("\nTOTALS:")
  for (const [key, value] of Object.entries(report.totals)) {
    console.log(`  ${key.padEnd(24)} ${value}`)
  }

  if (report.blocking.length) {
    console.log("\nBLOCKING:")
    for (const item of report.blocking) console.log(`  - ${item}`)
  }

  if (report.warnings.length) {
    console.log("\nWARNINGS:")
    for (const item of report.warnings) console.log(`  - ${item}`)
  }

  if (report.verdict !== "go") process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())
