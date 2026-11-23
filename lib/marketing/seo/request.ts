import "server-only"

import { failInsufficientCredits, handleRouteError, ok } from "@/lib/api/respond"
import { scopedIntentKey } from "@/lib/billing/operation-identity"
import { chargeSeoAuditCredits, getSeoAuditAffordability, refundSeoAuditCredits } from "./credits"
import { markSeoAuditRefund, runSeoAudit } from "./service"

/**
 * One charged SEO audit request: price → charge → crawl → refund on failure.
 *
 * Both the build route and the business route call this, so the money path
 * exists once. The caller has already resolved and authorised the target URL;
 * this function never resolves a URL itself.
 */
export async function runSeoAuditRequest(input: {
  userId: string
  projectId: string
  projectName: string
  /** Already authorised: the project's deployment URL or the proved hostname. */
  url: string
  requestId?: string
  logTag: string
}): Promise<Response> {
  const { userId, projectId } = input
  let charged = false
  let chargedAmount = 0
  let failedAuditId: string | null = null
  let intentKey: string | undefined

  try {
    // Stable operation identity when the client supplies one; otherwise the
    // per-attempt behaviour is preserved.
    intentKey = scopedIntentKey(input.requestId, { userId, operation: "seo_audit", projectId })

    const { cost, available, affordable } = await getSeoAuditAffordability(userId)
    if (!affordable) {
      return failInsufficientCredits({
        required: cost,
        available,
        message: `This audit costs ${cost} credits and you have ${available}.`,
      })
    }

    charged = await chargeSeoAuditCredits(userId, projectId, intentKey)
    if (!charged) {
      return failInsufficientCredits({
        required: cost,
        available,
        message: "You don't have enough credits for this audit.",
      })
    }
    chargedAmount = cost

    const outcome = await runSeoAudit({
      userId,
      projectId,
      url: input.url,
      creditsCharged: cost,
      projectName: input.projectName,
      onFailedAuditPersisted: (auditId) => {
        failedAuditId = auditId
      },
    })

    return ok({
      auditId: outcome.auditId,
      url: outcome.url,
      score: outcome.score,
      auditScore: outcome.auditScore,
      pagesCrawled: outcome.pagesCrawled,
      findings: outcome.findings,
      recommendations: outcome.recommendations,
      recommendationsMeta: outcome.recommendationsMeta,
      completedAt: outcome.completedAt,
      creditsCharged: cost,
    })
  } catch (e) {
    if (charged) {
      // Reverse exactly what was charged, then record the real outcome on the
      // failed history row (if it was stored) so the history is truthful.
      const refundStatus = await refundSeoAuditCredits(userId, projectId, chargedAmount, intentKey)
      if (failedAuditId) {
        await markSeoAuditRefund(projectId, failedAuditId, refundStatus, chargedAmount)
      }
    }
    return handleRouteError(input.logTag, e)
  }
}
