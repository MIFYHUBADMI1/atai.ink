/**
 * Support release for a business claim (v1 operator path).
 *
 *   npx tsx --env-file=.env.local scripts/release-business-claim.ts example.com \
 *     --reason "owner lost access to the old account" --apply
 *
 * Resolves by exact host or canonical host (so `example.com` also finds a claim
 * stored as `www.example.com`), prints every claim it finds, and releases them
 * with `detail: "released by support: <reason>"`. Dry-run unless `--apply`.
 *
 * This is the recovery path for "the old account is unreachable". It never
 * deletes anything: released rows keep their audit trail, and the website
 * becomes connectable by any account.
 */
import { businessDomainsCol } from "@/lib/db/collections"
import { canonicalBusinessHost } from "@/lib/domain/host"
import { MAX_DOMAIN_HISTORY } from "@/lib/domain/service"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main() {
  const host = process.argv.slice(2).find((arg) => !arg.startsWith("--") && !arg.startsWith("--reason"))
  const reason = argValue("--reason")
  const apply = process.argv.includes("--apply")

  if (!host || !reason) {
    console.error(
      "usage: release-business-claim.ts <host> --reason \"<why>\" [--apply]\n" +
        "  --reason is required: a support release must be explainable afterwards.",
    )
    process.exit(2)
  }

  const canonicalHostname = canonicalBusinessHost(host)
  const col = await businessDomainsCol()
  const docs = (await col
    .find({
      releasedAt: { $exists: false },
      hostname: { $in: [host, canonicalHostname, `www.${canonicalHostname}`] },
    })
    .toArray()) as BusinessDomainDoc[]

  const matching = docs.filter((doc) => canonicalBusinessHost(doc.hostname) === canonicalHostname)
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

  const now = Date.now()
  for (const doc of matching) {
    await col.updateOne(
      { id: doc.id },
      {
        $set: { status: "revoked", releasedAt: now, updatedAt: now },
        $unset: { token: "", tokenHash: "", claimExpiresAt: "" },
        $push: {
          history: {
            $each: [{ status: "revoked", at: now, detail: `released by support: ${reason}` }],
            $position: 0,
            $slice: MAX_DOMAIN_HISTORY,
          },
        },
      },
    )
  }
  console.log(`\nReleased ${matching.length} claim(s) for ${canonicalHostname}. Reason recorded: ${reason}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
