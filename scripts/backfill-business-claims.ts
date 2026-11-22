/**
 * Business-claim backfill (dry-run / apply).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-business-claims.ts dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-business-claims.ts apply
 *
 * Makes existing `business_domains` rows consistent with "one business, one
 * account" before the canonical unique index is built:
 *   1. every row gets `canonicalHostname` (the uniqueness key);
 *   2. unreleased rows are grouped by canonical host;
 *   3. the primary is the verified one, else the oldest;
 *   4. another exact host in the SAME project becomes an `aliasOf` row;
 *   5. another PROJECT loses the claim (`releasedAt`, `revoked`) and is listed
 *      in the report so an operator can review the collision first;
 *   6. unverified rows get a `claimExpiresAt` window.
 *
 * Run `dry-run` first: it writes nothing and prints every collision. Then
 * `apply`, then restart the app so `ensureIndexes` builds the unique index.
 */
import { businessDomainsCol } from "@/lib/db/collections"
import { canonicalBusinessHost } from "@/lib/domain/host"
import { CLAIM_RESERVATION_TTL_MS, MAX_DOMAIN_HISTORY } from "@/lib/domain/service"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"

const DUPLICATE_DETAIL = "duplicate canonical host — released during backfill"

async function main() {
  const mode = process.argv[2] === "apply" ? "apply" : "dry-run"
  const col = await businessDomainsCol()
  const now = Date.now()

  const docs = (await col.find({}).toArray()) as BusinessDomainDoc[]
  const groups = new Map<string, BusinessDomainDoc[]>()
  for (const doc of docs) {
    const key = canonicalBusinessHost(doc.hostname)
    groups.set(key, [...(groups.get(key) ?? []), doc])
  }

  const updates: string[] = []
  const collisions: string[] = []

  for (const [canonicalHostname, group] of groups) {
    const active = group.filter((doc) => doc.releasedAt === undefined)
    const primary =
      active.find((doc) => doc.verifiedAt !== undefined) ??
      [...active].sort((a, b) => a.createdAt - b.createdAt)[0] ??
      null

    for (const doc of group) {
      const set: Record<string, unknown> = {}
      if (doc.canonicalHostname !== canonicalHostname) set.canonicalHostname = canonicalHostname

      if (doc.releasedAt === undefined && doc.verifiedAt === undefined && doc.claimExpiresAt === undefined) {
        set.claimExpiresAt = Math.max(doc.tokenExpiresAt ?? 0, now + CLAIM_RESERVATION_TTL_MS)
      }

      if (doc.releasedAt === undefined && primary && doc.id !== primary.id) {
        if (doc.projectId === primary.projectId) {
          if (doc.aliasOf !== primary.id) set.aliasOf = primary.id
        } else {
          Object.assign(set, {
            status: "revoked",
            releasedAt: now,
            updatedAt: now,
            canonicalHostname,
          })
          collisions.push(
            `${canonicalHostname}: kept ${primary.projectId} (${primary.userId}); released ${doc.projectId} (${doc.userId}, status=${doc.status}, verified=${Boolean(doc.verifiedAt)})`,
          )
        }
      }

      if (Object.keys(set).length === 0) continue
      updates.push(`${doc.id} ${doc.hostname} -> ${canonicalHostname} ${Object.keys(set).join(",")}`)
      if (mode !== "apply") continue

      const unset: Record<string, string> = {}
      if (set.releasedAt !== undefined) {
        unset.token = ""
        unset.tokenHash = ""
        unset.claimExpiresAt = ""
      }
      const update = {
        $set: { ...set, updatedAt: now },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        ...(set.releasedAt !== undefined
          ? {
              $push: {
                history: {
                  $each: [{ status: "revoked" as const, at: now, detail: DUPLICATE_DETAIL }],
                  $position: 0,
                  $slice: MAX_DOMAIN_HISTORY,
                },
              },
            }
          : {}),
      }
      await col.updateOne({ id: doc.id }, update as Parameters<typeof col.updateOne>[1])
    }
  }

  console.log(`records scanned: ${docs.length}`)
  console.log(`canonical hostnames: ${groups.size}`)
  console.log(`rows ${mode === "apply" ? "updated" : "to update"}: ${updates.length}`)
  for (const line of updates.slice(0, 100)) console.log(`  ${line}`)
  if (updates.length > 100) console.log(`  ... and ${updates.length - 100} more`)

  console.log(`\ncollisions resolved by releasing a claim: ${collisions.length}`)
  for (const line of collisions) console.log(`  ${line}`)
  if (collisions.length > 0 && mode !== "apply") {
    console.log("\nReview the collisions above before running 'apply'.")
  }

  console.log(
    mode === "apply"
      ? "Applied. Re-run dry-run: it should report 0 rows to update."
      : "Dry run — nothing written. Re-run with 'apply' to persist.",
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
