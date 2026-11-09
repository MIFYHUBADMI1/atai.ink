import "server-only"

/**
 * Business lessons credit accounting.
 *
 * Mirrors `lib/marketing/seo/credits.ts` exactly: the EXISTING double-entry
 * credit service, charges taken only when a real generation pack is about to
 * run, refunded on failure. The core curriculum and the admin-published
 * library are free — only per-project AI lesson packs cost credits. Ledger
 * entries carry `referenceType: "project"` so project credit metrics account
 * for them with no change.
 */

import { consumeCredits, grantCredits, getAvailableCredits } from "@/lib/billing/credit-service"
import { cryptoId } from "@/lib/store/store"
import { logger } from "@/lib/logging/logger"

/**
 * Default credit cost for one personal lesson pack (three lessons: research +
 * synthesis each). Overridable via LESSONS_CREDIT_COST (integer ≥ 0; 0 makes
 * generation free and skips the ledger entirely). Kept as a local knob rather
 * than editing the shared billing settings schema, so this phase touches no
 * unrelated billing logic.
 */
export function getLessonsPackCost(): number {
  const raw = process.env.LESSONS_CREDIT_COST
  if (raw === undefined) return 40
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 40
  return parsed
}

export async function getLessonsPackAffordability(
  userId: string,
): Promise<{ cost: number; available: number; affordable: boolean }> {
  const cost = getLessonsPackCost()
  const available = await getAvailableCredits(userId)
  return { cost, available, affordable: cost <= 0 || available >= cost }
}

/**
 * Charge for one pack. Returns false when the user cannot afford it — the
 * caller must respond INSUFFICIENT_CREDITS and not run the generation.
 *
 * `intentKey` (stable operation identity, see lib/billing/operation-identity)
 * makes the ledger key deterministic (`lessons_${intentKey}`) so a retried
 * submission of the SAME operation cannot double-charge; without it the
 * charge falls back to a fresh random key.
 */
export async function chargeLessonsPackCredits(userId: string, projectId: string, intentKey?: string): Promise<boolean> {
  const amount = getLessonsPackCost()
  if (amount <= 0) {
    logger.info("credits.lessons", "charge skipped (zero cost configured)", { userId, projectId })
    return true
  }
  const available = await getAvailableCredits(userId)
  if (available < amount) {
    logger.warn("credits.lessons", "insufficient credits", { userId, amount, available })
    return false
  }
  const result = await consumeCredits({
    userId,
    amount,
    transactionType: "ai_collaboration",
    idempotencyKey: intentKey ? `lessons_${intentKey}` : cryptoId(),
    referenceType: "project",
    referenceId: projectId,
    // First-class project attribution — server-validated project from the
    // session/ownership boundary, never a client guess.
    projectId,
    metadata: { reason: "Personal business lesson pack", feature: "business_lessons" },
  })
  if (!result.success) {
    logger.warn("credits.lessons", "consume failed", { userId, amount })
    return false
  }
  logger.info("credits.lessons", "charged", { userId, projectId, amount })
  return true
}

/** Outcome of a refund attempt, returned so the route can log the truth. */
export type LessonsRefundOutcome = "refunded" | "not_charged" | "failed"

/**
 * Best-effort refund after a charged pack failed. Never throws — a failed
 * refund must not mask the original error — but reports the outcome.
 *
 * Pass the SAME intentKey used to charge so the refund key is deterministic
 * (`lessons_${intentKey}_refund`) and a retried failure path cannot
 * double-refund. `amount` defaults to the current configured cost; callers
 * that already know what was charged pass it explicitly.
 */
export async function refundLessonsPackCredits(
  userId: string,
  projectId: string,
  amount: number = getLessonsPackCost(),
  intentKey?: string,
): Promise<LessonsRefundOutcome> {
  if (amount <= 0) return "not_charged"
  try {
    await grantCredits({
      userId,
      creditType: "permanent",
      amount,
      transactionType: "other_reversal",
      idempotencyKey: intentKey ? `lessons_${intentKey}_refund` : `lessons_refund_${cryptoId()}`,
      referenceType: "project",
      referenceId: projectId,
      // Mirrors the charge.
      projectId,
      metadata: { reason: "Lesson pack failed — automatic refund", feature: "business_lessons" },
    })
    logger.info("credits.lessons", "refunded after failure", { userId, projectId, amount })
    return "refunded"
  } catch (e) {
    logger.warn("credits.lessons", "refund failed", {
      userId,
      projectId,
      message: e instanceof Error ? e.message : String(e),
    })
    return "failed"
  }
}
