/**
 * Support release for a business claim (operator CLI).
 *
 *   npx tsx --env-file=.env.local scripts/release-business-claim.ts example.com \
 *     --reason "owner lost access to the old account" --apply
 *
 * Dry-run unless `--apply`. Resolves by exact or canonical host, prints what it
 * found, then releases through the same service the admin page uses — so both
 * paths write the same audit entry (`released by support (<actor>): <reason>`).
 *
 * The admin page (`/admin/domains/claims`) is the normal path; this script is
 * for when the console is unreachable.
 */
import { businessDomainsCol } from "@/lib/db/collections"
import { canonicalBusinessHost } from "@/lib/domain/host"
import { releaseBusinessClaimForSupport } from "@/lib/domain/claims-admin"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main() {
  const flags = new Set(["--reason", "--actor"])
  const host = process.argv.slice(2).find((arg, index, all) => !arg.startsWith("--") && !flags.has(all[index - 1] ?? ""))
  const reason = argValue("--reason")
  const actor = argValue("--actor") ?? "cli"
  const apply = process.argv.includes("--apply")

  if (!host || !reason) {
    console.error(
      "usage: release-business-claim.ts <host> --reason \"<why>\" [--actor <id>] [--apply]\n" +
        "  --reason is required: a support release must be explainable afterwards.",
    )
    process.exit(2)
  }

  const canonicalHostname = canonicalBusinessHost(host)
  const docs = (await (await businessDomainsCol())
    .find({
      releasedAt: { $exists: false },
      hostname: { $in: [host, canonicalHostname, `www.${canonicalHostname}`] },
    })
    .toArray()) as BusinessDomainDoc[]
  const matching = docs.filter((doc) => (doc.canonicalHostname ?? canonicalBusinessHost(doc.hostname)) === canonicalHostname)

  if (matching.length === 0) {
    console.log(`No active claim for ${canonicalHostname}. Nothing to release.`)
    return
  }

  console.log(`claims for ${canonicalHostname}: ${matching.length}`)
  for (const doc of matching) {
    console.log(
      `  ${doc.id} project=${doc.projectId} user=${doc.userId} host=${doc.hostname} status=${doc.status} verified=${Boolean(doc.verifiedAt)}`,
    )
  }
  if (matching.some((doc) => doc.verifiedAt !== undefined)) {
    console.log("\nWARNING: at least one of these claims is VERIFIED. Releasing it revokes a proven ownership.")
  }
  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to release.")
    return
  }

  const result = await releaseBusinessClaimForSupport({ hostname: canonicalHostname, reason, actorId: actor })
  console.log(`\nReleased ${result.released.length} claim(s) for ${result.canonicalHostname}. Reason recorded: ${reason}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
