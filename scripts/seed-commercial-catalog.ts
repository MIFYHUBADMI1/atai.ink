/**
 * A7.0 commercial catalog seed and verification.
 *
 *   npx tsx --env-file=.env.local scripts/seed-commercial-catalog.ts
 *   npx tsx --env-file=.env.local scripts/seed-commercial-catalog.ts --apply
 *   npx tsx --env-file=.env.local scripts/seed-commercial-catalog.ts --verify
 *
 * Default is a dry run. `--apply` uses $setOnInsert only; it never rewrites an
 * existing product or version. This script never calls Dodo and never writes
 * subscriptions, payments or the credit ledger.
 */
import {
  mongoCatalogSeedStore,
  seedCommercialCatalog,
  verifyCommercialCatalogSeed,
} from "@/lib/billing/catalog/seed"

async function main() {
  const apply = process.argv.includes("--apply")
  const verify = process.argv.includes("--verify")
  const store = await mongoCatalogSeedStore()

  if (verify) {
    const report = await verifyCommercialCatalogSeed({ store })
    console.log(JSON.stringify({ verification: report }, null, 2))
    if (!report.ok) process.exitCode = 1
    return
  }

  const report = await seedCommercialCatalog({
    store,
    mode: apply ? "apply" : "dry-run",
  })
  console.log(JSON.stringify({ seed: report }, null, 2))

  if (apply) {
    const verification = await verifyCommercialCatalogSeed({ store })
    console.log(JSON.stringify({ verification }, null, 2))
    if (!verification.ok) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error("CATALOG SEED FAILED:", error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
