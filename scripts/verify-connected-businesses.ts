/**
 * Read-only integrity check for the connected-business model (A′.2).
 *
 *   npx tsx --env-file=.env.local scripts/verify-connected-businesses.ts
 *
 * Exits non-zero when problems are found, so it can gate a deploy.
 */
import { verifyConnectedBusinesses } from "@/lib/connected-business/verify"

async function main() {
  const report = await verifyConnectedBusinesses()
  console.log(JSON.stringify(report, null, 2))
  if (report.problems.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
