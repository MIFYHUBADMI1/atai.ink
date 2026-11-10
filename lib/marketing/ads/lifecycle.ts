import "server-only"

/**
 * Admin and founder lifecycle operations for advertising requests.
 * Status changes are validated; quotations are snapshotted; charging is never
 * done here (see billing.ts).
 */

import {
  adCampaignRequestsCol,
  ensureAdsIndexes,
} from "@/lib/db/ads-collections"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import {
  canTransitionAdRequest,
  isAdRequestStatus,
  type AdCampaignProposal,
  type AdCampaignRequestDoc,
  type AdRequestPriority,
  type AdRequestStatus,
  AD_REQUEST_PRIORITIES,
} from "@/lib/types/ads"
import { appendAdRequestEvent, getAdRequestById, listAdRequestEvents } from "./requests"
import { normalizeProposalDraft, proposalIsExpired, type ProposalDraftInput } from "./lifecycle-rules"
import { notifyAdRequestStatus } from "./request-notifications"

export async function listAdRequestsAdmin(input: {
  status?: AdRequestStatus | "all"
  q?: string
  page?: number
  pageSize?: number
}): Promise<{ items: AdCampaignRequestDoc[]; total: number; page: number; pageSize: number }> {
  await ensureAdsIndexes()
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100)
  const page = Math.max(input.page ?? 1, 1)
  const filter: Record<string, unknown> = {}
  if (input.status && input.status !== "all") filter.status = input.status
  const q = (input.q ?? "").trim()
  if (q) {
    filter.$or = [
      { id: q },
      { projectId: q },
      { userId: q },
      { "business.name": { $regex: escapeRegex(q), $options: "i" } },
      { "business.liveUrl": { $regex: escapeRegex(q), $options: "i" } },
    ]
  }
  const col = await adCampaignRequestsCol()
  const total = await col.countDocuments(filter)
  const items = (await col
    .find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray()) as unknown as AdCampaignRequestDoc[]
  return { items, total, page, pageSize }
}

export async function adminRequestStats(): Promise<Record<string, number>> {
  await ensureAdsIndexes()
  const col = await adCampaignRequestsCol()
  const groups = await col
    .aggregate<{ _id: string; count: number; credits: number }>([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          credits: {
            $sum: {
              $cond: [{ $eq: ["$payment.status", "paid"] }, { $ifNull: ["$payment.creditsCharged", 0] }, 0],
            },
          },
        },
      },
    ])
    .toArray()
  const out: Record<string, number> = { total: 0, creditsCollected: 0 }
  for (const row of groups) {
    out[row._id] = row.count
    out.total += row.count
    out.creditsCollected += row.credits
  }
  return out
}

export async function transitionAdRequest(input: {
  requestId: string
  to: AdRequestStatus
  actor: "founder" | "admin" | "system"
  actorUserId: string
  detail?: string
  visibility?: "founder" | "internal"
  notify?: boolean
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  if (request.status === input.to) return request
  if (!canTransitionAdRequest(request.status, input.to)) {
    throw new AppError("VALIDATION", `Cannot move this campaign from ${request.status} to ${input.to}.`)
  }
  const now = Date.now()
  const updated = (await (await adCampaignRequestsCol()).findOneAndUpdate(
    { id: request.id, status: request.status },
    { $set: { status: input.to, updatedAt: now } },
    { returnDocument: "after" },
  )) as AdCampaignRequestDoc | null
  if (!updated) throw new AppError("VALIDATION", "This campaign changed while you were working. Refresh and try again.")

  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.actorUserId,
    actor: input.actor,
    action: input.to === "cancelled" ? "cancelled" : input.to === "rejected" ? "rejected" : "status_changed",
    detail: input.detail || `Status changed to ${input.to}.`,
    fromStatus: request.status,
    toStatus: input.to,
    visibility: input.visibility ?? "founder",
  })
  logger.info("marketing.ads.lifecycle", "status changed", {
    requestId: request.id,
    from: request.status,
    to: input.to,
  })
  if (input.notify !== false) {
    void notifyAdRequestStatus(updated)
  }
  return updated
}

export async function assignAdRequest(input: {
  requestId: string
  adminId: string
  adminEmail: string
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  const now = Date.now()
  const updated = (await (await adCampaignRequestsCol()).findOneAndUpdate(
    { id: request.id },
    {
      $set: {
        assignedAdminId: input.adminId,
        assignedAdminEmail: input.adminEmail,
        updatedAt: now,
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
    action: "assigned",
    detail: `Assigned to ${input.adminEmail}.`,
    visibility: "internal",
  })
  return updated
}

export async function setAdRequestPriority(input: {
  requestId: string
  adminId: string
  priority: AdRequestPriority
}): Promise<AdCampaignRequestDoc> {
  if (!AD_REQUEST_PRIORITIES.includes(input.priority)) throw new AppError("VALIDATION")
  const request = await requireRequest(input.requestId)
  const updated = (await (await adCampaignRequestsCol()).findOneAndUpdate(
    { id: request.id },
    { $set: { priority: input.priority, updatedAt: Date.now() } },
    { returnDocument: "after" },
  )) as AdCampaignRequestDoc | null
  if (!updated) throw new AppError("VALIDATION")
  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.adminId,
    actor: "admin",
    action: "priority_changed",
    detail: `Priority set to ${input.priority}.`,
    visibility: "internal",
  })
  return updated
}

export async function addAdRequestNote(input: {
  requestId: string
  actorUserId: string
  actor: "founder" | "admin"
  body: string
  visibility: "founder" | "internal"
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  const detail = input.body.trim().slice(0, 4000)
  if (!detail) throw new AppError("VALIDATION")
  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.actorUserId,
    actor: input.actor,
    action: input.visibility === "internal" ? "internal_note" : input.actor === "founder" ? "founder_replied" : "message",
    detail,
    visibility: input.visibility,
  })
  const updated = (await (await adCampaignRequestsCol()).findOneAndUpdate(
    { id: request.id },
    { $set: { updatedAt: Date.now() } },
    { returnDocument: "after" },
  )) as AdCampaignRequestDoc | null
  if (!updated) throw new AppError("VALIDATION")
  if (input.visibility === "founder") void notifyAdRequestStatus(updated)
  return updated
}

export async function requestMoreInfo(input: {
  requestId: string
  adminId: string
  body: string
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  const detail = input.body.trim().slice(0, 4000)
  if (!detail) throw new AppError("VALIDATION")
  const moved =
    request.status === "needs_info"
      ? request
      : await transitionAdRequest({
          requestId: request.id,
          to: "needs_info",
          actor: "admin",
          actorUserId: input.adminId,
          detail: "Atai asked for more information.",
          notify: false,
        })
  await appendAdRequestEvent({
    requestId: moved.id,
    projectId: moved.projectId,
    userId: input.adminId,
    actor: "admin",
    action: "info_requested",
    detail,
    visibility: "founder",
  })
  void notifyAdRequestStatus(moved)
  return moved
}

export async function issueProposal(input: {
  requestId: string
  adminId: string
  draft: ProposalDraftInput
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  const draft = normalizeProposalDraft(input.draft)
  const proposal: AdCampaignProposal = {
    ...draft,
    version: (request.proposal?.version ?? 0) + 1,
    issuedAt: Date.now(),
    issuedByAdminId: input.adminId,
  }
  const nextStatus: AdRequestStatus =
    request.status === "awaiting_approval" || request.status === "proposal_prepared"
      ? "awaiting_approval"
      : "awaiting_approval"
  if (request.status !== "awaiting_approval" && !canTransitionAdRequest(request.status, nextStatus)) {
    throw new AppError("VALIDATION", "This request is not ready for a quotation yet.")
  }
  const updated = (await (await adCampaignRequestsCol()).findOneAndUpdate(
    { id: request.id, status: request.status },
    {
      $set: {
        proposal,
        status: nextStatus,
        updatedAt: Date.now(),
      },
    },
    { returnDocument: "after" },
  )) as AdCampaignRequestDoc | null
  if (!updated) throw new AppError("VALIDATION", "This campaign changed while you were working. Refresh and try again.")
  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.adminId,
    actor: "admin",
    action: "proposal_issued",
    detail: `Quotation v${proposal.version}: ${proposal.creditsPrice} Atai Credits. Estimates are not guaranteed.`,
    fromStatus: request.status,
    toStatus: nextStatus,
    visibility: "founder",
  })
  void notifyAdRequestStatus(updated)
  return updated
}

export async function acceptProposal(input: {
  requestId: string
  userId: string
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  if (request.userId !== input.userId) throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  if (!request.proposal) throw new AppError("VALIDATION", "There is no quotation to approve yet.")
  if (proposalIsExpired(request.proposal)) {
    throw new AppError("VALIDATION", "This quotation has expired. Atai will need to issue a new one.")
  }
  return transitionAdRequest({
    requestId: request.id,
    to: "awaiting_payment",
    actor: "founder",
    actorUserId: input.userId,
    detail: `Quotation v${request.proposal.version} accepted. Payment has not been taken yet.`,
  })
}

export async function declineProposal(input: {
  requestId: string
  userId: string
  reason?: string
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  if (request.userId !== input.userId) throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  return transitionAdRequest({
    requestId: request.id,
    to: "under_review",
    actor: "founder",
    actorUserId: input.userId,
    detail: input.reason?.trim()
      ? `Quotation declined: ${input.reason.trim().slice(0, 1000)}`
      : "Quotation declined. Atai can issue a revised proposal.",
  })
}

export async function cancelAdRequest(input: {
  requestId: string
  userId: string
  actor: "founder" | "admin"
  reason?: string
}): Promise<AdCampaignRequestDoc> {
  const request = await requireRequest(input.requestId)
  if (input.actor === "founder" && request.userId !== input.userId) {
    throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  }
  return transitionAdRequest({
    requestId: request.id,
    to: "cancelled",
    actor: input.actor,
    actorUserId: input.userId,
    detail: input.reason?.trim() ? input.reason.trim().slice(0, 1000) : "Campaign cancelled.",
  })
}

export { isAdRequestStatus, listAdRequestEvents }

async function requireRequest(requestId: string): Promise<AdCampaignRequestDoc> {
  const request = await getAdRequestById(requestId)
  if (!request) throw new AppError("VALIDATION", "We couldn't find that campaign request.", 404)
  return request
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
