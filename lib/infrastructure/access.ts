import "server-only"
import type { InfrastructureSubscription } from "@/lib/types/project"

/**
 * Infrastructure access policy.
 *
 * Infrastructure plans are fixed-duration, credit-funded entitlements. There is
 * no recurring provider billing for them today, so access is decided by the
 * paid-through timestamp (`expiresAt`) and the lifecycle status — never by the
 * plan label alone.
 *
 * Historical records with no trustworthy expiry are deliberately allowed
 * through and flagged for review. They must not be silently expired or
 * repriced while an operator establishes the purchased terms.
 */

export type InfrastructureAccessReason =
  | "no_subscription"
  | "testing"
  | "enterprise_manual"
  | "needs_review"
  | "expired"
  | "active"

export interface InfrastructureAccessState {
  allowed: boolean
  needsReview: boolean
  reason: InfrastructureAccessReason
  planId?: string
  paidThroughAt?: number
}

export const INFRASTRUCTURE_EXPIRED_CODE = "INFRASTRUCTURE_EXPIRED"
export const INFRASTRUCTURE_EXPIRED_MESSAGE =
  "Your paid infrastructure period has ended. Renew an infrastructure plan to continue."

export interface InfrastructureDenial {
  code: typeof INFRASTRUCTURE_EXPIRED_CODE
  message: string
}

/** Returns a denial for expired paid infrastructure, or null when allowed. */
export function infrastructureDenial(
  infrastructure: InfrastructureSubscription | null | undefined,
  now: number = Date.now(),
): InfrastructureDenial | null {
  const access = evaluateInfrastructureAccess(infrastructure, now)
  if (access.allowed) return null
  return { code: INFRASTRUCTURE_EXPIRED_CODE, message: INFRASTRUCTURE_EXPIRED_MESSAGE }
}

export function evaluateInfrastructureAccess(
  infrastructure: InfrastructureSubscription | null | undefined,
  now: number = Date.now(),
): InfrastructureAccessState {
  if (!infrastructure) {
    return { allowed: true, needsReview: false, reason: "no_subscription" }
  }

  const planId = infrastructure.planId
  const paidThroughAt =
    typeof infrastructure.expiresAt === "number" && Number.isFinite(infrastructure.expiresAt)
      ? infrastructure.expiresAt
      : undefined

  if (
    infrastructure.needsReview ||
    infrastructure.status === "needs_review" ||
    paidThroughAt === undefined
  ) {
    return { allowed: true, needsReview: true, reason: "needs_review", planId, paidThroughAt }
  }

  // Custom/enterprise plans are manually managed and have no automatic expiry.
  if (planId === "enterprise") {
    return { allowed: true, needsReview: true, reason: "enterprise_manual", planId, paidThroughAt }
  }

  if (planId === "testing") {
    return { allowed: true, needsReview: false, reason: "testing", planId, paidThroughAt }
  }

  if (infrastructure.status === "expired" || infrastructure.status === "past_due") {
    return { allowed: false, needsReview: false, reason: "expired", planId, paidThroughAt }
  }

  if (paidThroughAt <= now) {
    return { allowed: false, needsReview: false, reason: "expired", planId, paidThroughAt }
  }

  return { allowed: true, needsReview: false, reason: "active", planId, paidThroughAt }
}
