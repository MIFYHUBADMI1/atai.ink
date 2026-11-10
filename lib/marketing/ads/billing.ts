import "server-only"

/**
 * Charge and refund advertising quotations through the existing Atai Credits
 * ledger. No second balance. Submission is free; charging happens only after
 * the founder accepts a quotation and confirms payment.
 */

import { adCampaignRequestsCol, ensureAdsIndexes } from "@/lib/db/ads-collections"
import { consumeCredits, grantCredits } from "@/lib/billing/credit-service"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import type { AdCampaignPayment, AdCampaignRequestDoc } from "@/lib/types/ads"
import { canTransitionAdRequest } from "@/lib/types/ads"
import { appendAdRequestEvent } from "./requests"
import { proposalIsExpired } from "./lifecycle-rules"
import { notifyAdRequestStatus } from "./request-notifications"

export async function chargeAdRequest(input: {
  requestId: string
  userId: string
  idempotencyKey: string
}): Promise<AdCampaignRequestDoc> {
  await ensureAdsIndexes()
  const request = await requireOwned(input.requestId, input.userId)
  if (!request.proposal) throw new AppError("VALIDATION", "There is no quotation to pay.")
  if (proposalIsExpired(request.proposal)) {
    throw new AppError("VALIDATION", "This quotation has expired. Atai will need to issue a new one.")
  }
  if (request.payment?.status === "paid") return request
  if (request.status !== "awaiting_payment") {
    throw new AppError("VALIDATION", "Approve the quotation before paying.")
  }

  const amount = request.proposal.creditsPrice
  if (!Number.isInteger(amount) || amount < 1) throw new AppError("VALIDATION")

  const key = (input.idempotencyKey || "").trim().slice(0, 120)
  if (key.length < 8) throw new AppError("VALIDATION")
  const chargeKey = `adcamp_charge_${request.id}_${key}`

  const result = await consumeCredits({
    userId: input.userId,
    amount,
    transactionType: "ad_campaign_charge",
    idempotencyKey: chargeKey,
    referenceType: "ad_campaign",
    referenceId: request.id,
    projectId: request.projectId,
    metadata: {
      kind: "ad_campaign_charge",
      requestId: request.id,
      proposalVersion: request.proposal.version,
    },
  })

  if (!result.success) {
    await (await adCampaignRequestsCol()).updateOne(
      { id: request.id },
      {
        $set: {
          "payment.status": "failed",
          "payment.creditsCharged": amount,
          updatedAt: Date.now(),
        },
      },
    )
    await appendAdRequestEvent({
      requestId: request.id,
      projectId: request.projectId,
      userId: input.userId,
      actor: "founder",
      action: "payment_failed",
      detail: "Payment did not go through — there were not enough Atai Credits.",
      visibility: "founder",
    })
    throw new AppError("INSUFFICIENT_CREDITS")
  }

  if (!canTransitionAdRequest(request.status, "approved")) {
    throw new AppError("VALIDATION")
  }

  const payment: AdCampaignPayment = {
    status: "paid",
    creditsCharged: amount,
    subscriptionConsumed: result.subscriptionConsumed,
    permanentConsumed: result.permanentConsumed,
    chargedAt: Date.now(),
    chargeIdempotencyKey: chargeKey,
  }

  const updated = (await (await adCampaignRequestsCol()).findOneAndUpdate(
    { id: request.id, status: "awaiting_payment" },
    { $set: { payment, status: "approved", updatedAt: Date.now() } },
    { returnDocument: "after" },
  )) as AdCampaignRequestDoc | null

  if (!updated) {
    // Race: another pay already succeeded. Ledger is idempotent; return current.
    const current = await requireOwned(input.requestId, input.userId)
    if (current.payment?.status === "paid") return current
    throw new AppError("VALIDATION", "This campaign changed while you were paying. Refresh and try again.")
  }

  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.userId,
    actor: "founder",
    action: "payment_succeeded",
    detail: `Charged ${amount} Atai Credits. Campaign is approved and ready for Atai's team to schedule.`,
    fromStatus: "awaiting_payment",
    toStatus: "approved",
    visibility: "founder",
  })
  logger.info("marketing.ads.billing", "campaign charged", {
    requestId: request.id,
    amount,
    subscriptionConsumed: result.subscriptionConsumed,
    permanentConsumed: result.permanentConsumed,
  })
  void notifyAdRequestStatus(updated)
  return updated
}

export async function refundAdRequest(input: {
  requestId: string
  adminId: string
  reason?: string
}): Promise<AdCampaignRequestDoc> {
  await ensureAdsIndexes()
  const request = await getRequired(input.requestId)
  if (request.payment?.status !== "paid") {
    throw new AppError("VALIDATION", "There is no paid quotation to refund.")
  }
  if (!canTransitionAdRequest(request.status, "refunded")) {
    throw new AppError("VALIDATION", "This campaign cannot be refunded from its current status.")
  }

  const refundKey = request.payment.refundIdempotencyKey ?? `adcamp_refund_${request.id}`
  const sub = request.payment.subscriptionConsumed ?? 0
  const perm = request.payment.permanentConsumed ?? 0

  if (sub > 0) {
    const granted = await grantCredits({
      userId: request.userId,
      creditType: "subscription",
      amount: sub,
      transactionType: "ad_campaign_refund",
      idempotencyKey: `${refundKey}_sub`,
      referenceType: "ad_campaign",
      referenceId: request.id,
      projectId: request.projectId,
      metadata: { kind: "ad_campaign_refund", requestId: request.id, bucket: "subscription" },
    })
    if (!granted.success) throw new AppError("UNKNOWN", "The refund could not be recorded.")
  }
  if (perm > 0 || (sub === 0 && perm === 0 && request.payment.creditsCharged > 0)) {
    const amount = perm > 0 ? perm : request.payment.creditsCharged
    const granted = await grantCredits({
      userId: request.userId,
      creditType: "permanent",
      amount,
      transactionType: "ad_campaign_refund",
      idempotencyKey: `${refundKey}_perm`,
      referenceType: "ad_campaign",
      referenceId: request.id,
      projectId: request.projectId,
      metadata: { kind: "ad_campaign_refund", requestId: request.id, bucket: "permanent" },
    })
    if (!granted.success) throw new AppError("UNKNOWN", "The refund could not be recorded.")
  }

  const updated = (await (await adCampaignRequestsCol()).findOneAndUpdate(
    { id: request.id },
    {
      $set: {
        status: "refunded",
        "payment.status": "refunded",
        "payment.refundedAt": Date.now(),
        "payment.refundIdempotencyKey": refundKey,
        updatedAt: Date.now(),
      },
    },
    { returnDocument: "after" },
  )) as AdCampaignRequestDoc | null
  if (!updated) throw new AppError("VALIDATION")

  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.adminId,
    actor: "admin",
    action: "refunded",
    detail: input.reason?.trim()
      ? `Refunded ${request.payment.creditsCharged} Atai Credits. ${input.reason.trim().slice(0, 800)}`
      : `Refunded ${request.payment.creditsCharged} Atai Credits through the Atai Credits ledger.`,
    fromStatus: request.status,
    toStatus: "refunded",
    visibility: "founder",
  })
  void notifyAdRequestStatus(updated)
  return updated
}

async function requireOwned(requestId: string, userId: string): Promise<AdCampaignRequestDoc> {
  const request = await getRequired(requestId)
  if (request.userId !== userId) throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  return request
}

async function getRequired(requestId: string): Promise<AdCampaignRequestDoc> {
  const { getAdRequestById } = await import("./requests")
  const request = await getAdRequestById(requestId)
  if (!request) throw new AppError("VALIDATION", "We couldn't find that campaign request.", 404)
  return request
}
