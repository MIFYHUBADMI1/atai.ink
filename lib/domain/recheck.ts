/**
 * Scheduled re-verification of verified businesses.
 *
 * A verified claim is the strongest thing a founder can hold in Atai, and
 * until this sweep existed nothing ever looked again: a deleted tag, a site
 * that changed hands or a lapsed domain kept "verified" forever, and kept the
 * business out of every other account's reach. The check itself already knows
 * how to fail safely (`REVERIFICATION_FAILURE_GRACE`, `needsAttention`); this
 * module only decides who to check and when.
 */
import { businessDomainsCol } from "@/lib/db/collections"
import { logger } from "@/lib/logging/logger"
import { refreshConnectionStatus } from "@/lib/connected-business/service"
import { verifyDomainOwnership } from "@/lib/domain/service"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"

/** A verified domain is re-checked at most once a day, so repeated runs (or a
 * manual admin trigger) never hammer a founder's site. */
export const RECHECK_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000
/** Per-run ceiling: each check is a live fetch with a 10s timeout. */
export const RECHECK_BATCH_SIZE = 25
/** Stop starting new checks well inside the route's function budget. */
const RECHECK_TIME_BUDGET_MS = 240_000

export type RecheckReport = {
  scanned: number
  checked: number
  stillVerified: number
  needsAttention: number
  expired: number
  errors: Array<{ domainId: string; hostname: string; error: string }>
  skipped: "batch-full" | "time-budget" | null
}

/**
 * Re-check the verified domains that are due, oldest check first.
 *
 * Failures are recorded on the record (attention, then expiry) exactly as a
 * founder-triggered re-check would, and never release a claim early — the
 * grace limit is the only thing that can drop a verified business.
 */
export async function recheckVerifiedDomains(input: {
  now?: number
  limit?: number
  /** Test seam: defaults to the real verification. */
  verify?: typeof verifyDomainOwnership
  /** Test seam: defaults to the real connection refresh. */
  refresh?: typeof refreshConnectionStatus
} = {}): Promise<RecheckReport> {
  const now = input.now ?? Date.now()
  const limit = input.limit ?? RECHECK_BATCH_SIZE
  const verify = input.verify ?? verifyDomainOwnership
  const refresh = input.refresh ?? refreshConnectionStatus
  // Real clock: `now` is the query cutoff, and the budget must not inherit a
  // caller-supplied timestamp.
  const startedAt = Date.now()

  const col = await businessDomainsCol()
  const due = (await col
    .find({
      status: "verified",
      releasedAt: { $exists: false },
      verifiedAt: { $exists: true },
      $or: [{ lastCheckedAt: { $exists: false } }, { lastCheckedAt: { $lt: now - RECHECK_MIN_INTERVAL_MS } }],
    })
    .sort({ lastCheckedAt: 1 })
    .limit(limit)
    .toArray()) as BusinessDomainDoc[]

  const report: RecheckReport = {
    scanned: due.length,
    checked: 0,
    stillVerified: 0,
    needsAttention: 0,
    expired: 0,
    errors: [],
    skipped: null,
  }

  for (const doc of due) {
    if (Date.now() - startedAt > RECHECK_TIME_BUDGET_MS) {
      report.skipped = "time-budget"
      break
    }
    try {
      const outcome = await verify({
        userId: doc.userId,
        projectId: doc.projectId,
        domainId: doc.id,
        reverification: true,
        internal: true,
      })
      report.checked += 1
      const status = outcome.doc.status
      if (status === "verified") {
        if (outcome.doc.needsAttention) report.needsAttention += 1
        else report.stillVerified += 1
      } else if (status === "expired" || status === "revoked") {
        report.expired += 1
      }
      // The sweep is the only writer that can change a verified domain's status
      // without the founder on the page, so the cached connection must follow.
      if (status !== doc.status) await refresh(doc.projectId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      report.errors.push({ domainId: doc.id, hostname: doc.hostname, error: message })
      logger.warn("domain.recheck", "re-check failed to run", { domainId: doc.id, hostname: doc.hostname, error: message })
    }
  }

  logger.info("domain.recheck", "sweep finished", {
    scanned: report.scanned,
    checked: report.checked,
    needsAttention: report.needsAttention,
    expired: report.expired,
    errors: report.errors.length,
    skipped: report.skipped,
  })
  return report
}
