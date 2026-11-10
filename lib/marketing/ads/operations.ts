import "server-only"

import { ObjectId } from "mongodb"
import { cryptoId } from "@/lib/store/store"
import {
  adCampaignActivitiesCol,
  adCampaignPerformanceCol,
  ensureAdsIndexes,
} from "@/lib/db/ads-collections"
import { AppError } from "@/lib/errors"
import {
  AD_ACTIVITY_STATUSES,
  AD_PERFORMANCE_SOURCES,
  type AdActivityStatus,
  type AdCampaignActivityDoc,
  type AdCampaignPerformanceDoc,
  type AdPerformanceSource,
} from "@/lib/types/ads"
import { getAdRequestById, appendAdRequestEvent } from "./requests"
import { bounded } from "./lifecycle-rules"

export async function listActivities(requestId: string): Promise<AdCampaignActivityDoc[]> {
  await ensureAdsIndexes()
  return (await (await adCampaignActivitiesCol())
    .find({ requestId })
    .sort({ createdAt: 1 })
    .limit(100)
    .toArray()) as unknown as AdCampaignActivityDoc[]
}

export async function addActivity(input: {
  requestId: string
  adminId: string
  title: string
  notes?: string
  channel?: string
}): Promise<AdCampaignActivityDoc> {
  const request = await getAdRequestById(input.requestId)
  if (!request) throw new AppError("VALIDATION", "We couldn't find that campaign request.", 404)
  const title = bounded(input.title, 160)
  if (!title) throw new AppError("VALIDATION")
  const now = Date.now()
  const doc: AdCampaignActivityDoc = {
    _id: new ObjectId(),
    id: `adact_${cryptoId()}`,
    requestId: request.id,
    projectId: request.projectId,
    title,
    notes: bounded(input.notes, 2000),
    status: "pending",
    channel: bounded(input.channel, 80),
    publicationUrl: "",
    account: "",
    createdAt: now,
    updatedAt: now,
  }
  await (await adCampaignActivitiesCol()).insertOne(doc as never)
  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.adminId,
    actor: "admin",
    action: "activity_added",
    detail: `Added execution task: ${title}`,
    visibility: "founder",
  })
  return doc
}

export async function updateActivity(input: {
  requestId: string
  activityId: string
  adminId: string
  status?: AdActivityStatus
  notes?: string
  channel?: string
  publicationUrl?: string
  account?: string
  publishedAt?: number | null
}): Promise<AdCampaignActivityDoc> {
  const request = await getAdRequestById(input.requestId)
  if (!request) throw new AppError("VALIDATION", "We couldn't find that campaign request.", 404)
  if (input.status && !AD_ACTIVITY_STATUSES.includes(input.status)) throw new AppError("VALIDATION")

  const $set: Record<string, unknown> = { updatedAt: Date.now() }
  if (input.status) {
    $set.status = input.status
    $set.completedAt = input.status === "completed" ? Date.now() : null
  }
  if (input.notes != null) $set.notes = bounded(input.notes, 2000)
  if (input.channel != null) $set.channel = bounded(input.channel, 80)
  if (input.publicationUrl != null) {
    const url = bounded(input.publicationUrl, 500)
    if (url && !/^https:\/\//i.test(url)) throw new AppError("VALIDATION", "Publication URLs must use https.")
    $set.publicationUrl = url
  }
  if (input.account != null) $set.account = bounded(input.account, 160)
  if (input.publishedAt === null) $set.publishedAt = null
  else if (typeof input.publishedAt === "number") $set.publishedAt = input.publishedAt

  const updated = (await (await adCampaignActivitiesCol()).findOneAndUpdate(
    { id: input.activityId, requestId: input.requestId },
    { $set },
    { returnDocument: "after" },
  )) as AdCampaignActivityDoc | null
  if (!updated) throw new AppError("VALIDATION", "That activity was not found.", 404)

  if (input.status === "completed") {
    await appendAdRequestEvent({
      requestId: request.id,
      projectId: request.projectId,
      userId: input.adminId,
      actor: "admin",
      action: "activity_completed",
      detail: `Completed: ${updated.title}${updated.publicationUrl ? ` (${updated.publicationUrl})` : ""}`,
      visibility: "founder",
    })
  }
  return updated
}

export async function listPerformance(requestId: string): Promise<AdCampaignPerformanceDoc[]> {
  await ensureAdsIndexes()
  return (await (await adCampaignPerformanceCol())
    .find({ requestId })
    .sort({ reportedAt: -1 })
    .limit(200)
    .toArray()) as unknown as AdCampaignPerformanceDoc[]
}

export async function addPerformance(input: {
  requestId: string
  adminId: string
  metric: string
  value: number
  source: AdPerformanceSource
  evidenceUrl?: string
  note?: string
}): Promise<AdCampaignPerformanceDoc> {
  const request = await getAdRequestById(input.requestId)
  if (!request) throw new AppError("VALIDATION", "We couldn't find that campaign request.", 404)
  if (!AD_PERFORMANCE_SOURCES.includes(input.source)) throw new AppError("VALIDATION")
  const metric = bounded(input.metric, 80)
  if (!metric) throw new AppError("VALIDATION")
  if (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value < 0) {
    throw new AppError("VALIDATION")
  }
  const evidenceUrl = bounded(input.evidenceUrl, 500)
  if (evidenceUrl && !/^https:\/\//i.test(evidenceUrl)) {
    throw new AppError("VALIDATION", "Evidence links must use https.")
  }
  const now = Date.now()
  const doc: AdCampaignPerformanceDoc = {
    _id: new ObjectId(),
    id: `adperf_${cryptoId()}`,
    requestId: request.id,
    projectId: request.projectId,
    metric,
    value: input.value,
    source: input.source,
    evidenceUrl,
    note: bounded(input.note, 800),
    reportedAt: now,
    reportedByAdminId: input.adminId,
  }
  await (await adCampaignPerformanceCol()).insertOne(doc as never)
  await appendAdRequestEvent({
    requestId: request.id,
    projectId: request.projectId,
    userId: input.adminId,
    actor: "admin",
    action: "performance_recorded",
    detail: `Recorded ${metric}: ${input.value} (${input.source}). This is ${input.source === "estimated" ? "an estimate, not an actual result" : "as reported — not independently verified by Atai"}.`,
    visibility: "founder",
  })
  return doc
}
