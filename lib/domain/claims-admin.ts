/**
 * Support view of business claims.
 *
 * The rule "one business belongs to one account" needs a fast, auditable
 * exception path: an owner who lost access to the account that holds their
 * site. This is the shared implementation behind the admin page and
 * `scripts/release-business-claim.ts`, so both write the same history entry.
 */
import { businessDomainsCol, projectsCol, usersCol } from "@/lib/db/collections"
import { canonicalBusinessHost } from "@/lib/domain/host"
import { MAX_DOMAIN_HISTORY } from "@/lib/domain/service"
import { logger } from "@/lib/logging/logger"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"

export type BusinessClaimRow = {
  canonicalHostname: string
  hostnames: string[]
  state: "verified" | "pending"
  projectId: string
  projectName: string | null
  ownerId: string
  ownerEmail: string | null
  verifiedAt: number | null
  claimExpiresAt: number | null
  lastCheckedAt: number | null
  needsAttention: boolean
  createdAt: number
}

/** Every active claim, one row per business (aliases folded into the primary). */
export async function listBusinessClaims(input: { limit?: number } = {}): Promise<BusinessClaimRow[]> {
  const limit = input.limit ?? 200
  const docs = (await (await businessDomainsCol())
    .find({ releasedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()) as BusinessDomainDoc[]

  const groups = new Map<string, BusinessDomainDoc[]>()
  for (const doc of docs) {
    const key = doc.canonicalHostname ?? canonicalBusinessHost(doc.hostname)
    groups.set(key, [...(groups.get(key) ?? []), doc])
  }

  const rows: BusinessClaimRow[] = []
  for (const [canonicalHostname, group] of groups) {
    // A primary claim is the authority; aliases only add their exact hosts.
    const primary = group.find((doc) => !doc.aliasOf) ?? group[0]
    rows.push({
      canonicalHostname,
      hostnames: group.map((doc) => doc.hostname),
      state: primary.verifiedAt !== undefined ? "verified" : "pending",
      projectId: primary.projectId,
      projectName: null,
      ownerId: primary.userId,
      ownerEmail: null,
      verifiedAt: primary.verifiedAt ?? null,
      claimExpiresAt: primary.verifiedAt !== undefined ? null : primary.claimExpiresAt ?? null,
      lastCheckedAt: primary.lastCheckedAt ?? null,
      needsAttention: Boolean(primary.needsAttention),
      createdAt: primary.createdAt,
    })
  }

  const projectIds = [...new Set(rows.map((row) => row.projectId))]
  const ownerIds = [...new Set(rows.map((row) => row.ownerId))]
  const [projects, users] = await Promise.all([
    projectIds.length
      ? (await (await projectsCol()).find({ id: { $in: projectIds } }, { projection: { id: 1, name: 1 } }).toArray())
      : Promise.resolve([]),
    ownerIds.length
      ? (await (await usersCol()).find({ id: { $in: ownerIds } }, { projection: { id: 1, email: 1 } }).toArray())
      : Promise.resolve([]),
  ])
  const projectNames = new Map(projects.map((p) => [String(p.id), typeof p.name === "string" ? p.name : null]))
  const emails = new Map(users.map((u) => [String(u.id), typeof u.email === "string" ? u.email : null]))
  for (const row of rows) {
    row.projectName = projectNames.get(row.projectId) ?? null
    row.ownerEmail = emails.get(row.ownerId) ?? null
  }

  return rows.sort((a, b) => Number(b.state === "verified") - Number(a.state === "verified") || b.createdAt - a.createdAt)
}

export type SupportReleaseResult = {
  canonicalHostname: string
  released: Array<{ id: string; hostname: string; projectId: string; userId: string; verified: boolean }>
}

/** Release every active claim on a business. Nothing is deleted; the audit trail stays. */
export async function releaseBusinessClaimForSupport(input: {
  hostname: string
  reason: string
  actorId: string
}): Promise<SupportReleaseResult> {
  const canonicalHostname = canonicalBusinessHost(input.hostname.trim())
  const reason = input.reason.trim()
  if (!canonicalHostname) throw new Error("A hostname is required.")
  if (!reason) throw new Error("A reason is required: a support release must be explainable afterwards.")

  const col = await businessDomainsCol()
  const docs = (await col
    .find({
      releasedAt: { $exists: false },
      hostname: { $in: [canonicalHostname, `www.${canonicalHostname}`] },
    })
    .toArray()) as BusinessDomainDoc[]

  const matching = docs.filter((doc) => (doc.canonicalHostname ?? canonicalBusinessHost(doc.hostname)) === canonicalHostname)
  const now = Date.now()
  const released: SupportReleaseResult["released"] = []
  for (const doc of matching) {
    await col.updateOne(
      { id: doc.id },
      {
        $set: { status: "revoked", releasedAt: now, updatedAt: now },
        $unset: { token: "", tokenHash: "", claimExpiresAt: "" },
        $push: {
          history: {
            $each: [
              {
                status: "revoked",
                at: now,
                detail: `released by support (${input.actorId}): ${reason}`,
              },
            ],
            $position: 0,
            $slice: MAX_DOMAIN_HISTORY,
          },
        },
      },
    )
    released.push({
      id: doc.id,
      hostname: doc.hostname,
      projectId: doc.projectId,
      userId: doc.userId,
      verified: doc.verifiedAt !== undefined,
    })
  }

  if (released.length > 0) {
    logger.info("business.claim", "released by support", {
      canonicalHostname,
      actorId: input.actorId,
      released: released.length,
      verified: released.filter((doc) => doc.verified).length,
    })
  }
  return { canonicalHostname, released }
}
