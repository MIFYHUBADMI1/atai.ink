import "server-only"

/**
 * Per-message credit charging for paid co-founder model tiers (the
 * /settings/ai picker). Free tiers (creditsPerMessage = 0) never touch the
 * ledger. Paid tiers charge a flat amount once per founder message via the
 * shared double-entry credit service — same discipline as the SEO audit and
 * Studio charges: consume first, refund best-effort if the turn fails.
 */

import { consumeCredits, grantCredits, getAvailableCredits } from "@/lib/billing/credit-service"
import { cryptoId } from "@/lib/store/store"
import { logger } from "@/lib/logging/logger"
import { AppError } from "@/lib/errors"
import type { CofounderModelTier } from "./models"

/**
 * Charge one co-founder message on a paid tier. Returns the ledger
 * idempotency key so the caller can refund the exact same charge if the turn
 * fails. Throws AppError("INSUFFICIENT_CREDITS") when the balance can't cover
 * it — the route maps that to a 402 the panel already understands.
 */
export async function chargeCofounderMessage(
  userId: string,
  conversationId: string,
  tier: CofounderModelTier,
): Promise<string | null> {
  const amount = tier.creditsPerMessage
  if (amount <= 0) return null

  const available = await getAvailableCredits(userId)
  if (available < amount) {
    logger.warn("credits.cofounder", "insufficient credits for model tier", {
      userId,
      tier: tier.id,
      amount,
      available,
    })
    throw new AppError("INSUFFICIENT_CREDITS")
  }

  // One billable event per message. The conversation id scopes the key so a
  // retried POST of the same turn can't double-charge; Date.now() keeps
  // distinct messages distinct.
  const idempotencyKey = `cofounder_msg_${conversationId}_${cryptoId()}`
  const result = await consumeCredits({
    userId,
    amount,
    transactionType: "ai_collaboration",
    idempotencyKey,
    referenceType: "cofounder_conversation",
    referenceId: conversationId,
    metadata: {
      reason: `AI co-founder message (${tier.name} tier)`,
      feature: "cofounder_model",
      tier: tier.id,
      model: tier.modelId,
    },
  })
  if (!result.success) {
    logger.warn("credits.cofounder", "consume failed", { userId, tier: tier.id, amount })
    throw new AppError("INSUFFICIENT_CREDITS")
  }
  logger.info("credits.cofounder", "charged", { userId, tier: tier.id, amount })
  return idempotencyKey
}

/** Best-effort refund when the agent turn fails after charging. Never throws —
 * a failed refund must not mask the original error. The refund key is derived
 * from the charge key so retries can't double-refund. */
export async function refundCofounderMessage(
  userId: string,
  conversationId: string,
  tier: CofounderModelTier,
  chargeKey: string,
): Promise<void> {
  const amount = tier.creditsPerMessage
  if (amount <= 0 || !chargeKey) return
  try {
    await grantCredits({
      userId,
      creditType: "permanent",
      amount,
      transactionType: "other_reversal",
      idempotencyKey: `${chargeKey}_refund`,
      referenceType: "cofounder_conversation",
      referenceId: conversationId,
      metadata: {
        reason: "AI co-founder turn failed — automatic refund",
        feature: "cofounder_model",
        tier: tier.id,
      },
    })
    logger.info("credits.cofounder", "refunded after failed turn", { userId, tier: tier.id, amount })
  } catch (e) {
    logger.warn("credits.cofounder", "refund failed", {
      userId,
      tier: tier.id,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
