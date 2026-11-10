import "server-only"

/**
 * Advertising request service (Phase 3) — "Promote My Business with Atai".
 *
 * Submission is FREE and idempotent: the client generates one idempotency key
 * per wizard instance, and a retry with the same key returns the original
 * request instead of creating a duplicate. Ownership is re-asserted against
 * the project owner on every write (same posture as campaigns/strategy).
 *
 * No credits are charged here. Charging happens only after an admin quotation
 * is explicitly approved by the founder (Phase 5), through the existing
 * credit ledger — there is no second billing system.
 */

import { ObjectId } from "mongodb"
import { store, cryptoId } from "@/lib/store/store"
import {
  adCampaignRequestsCol,
  adRequestEventsCol,
  ensureAdsIndexes,
} from "@/lib/db/ads-collections"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import type {
  AdCampaignRequestDoc,
  AdRequestEventDoc,
  AdRequestStatus,
  AdRequestSubmission,
} from "@/lib/types/ads"
import { AD_REQUEST_BOUNDS } from "./request-shared"

function bounded(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

function boundedList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const cleaned = entry.trim().slice(0, maxChars)
    if (cleaned && !out.includes(cleaned)) out.push(cleaned)
    if (out.length >= maxItems) break
  }
  return out
}

/**
 * Validate and normalize a promotion URL. Accepts bare domains (https is
 * prepended), rejects credentials, non-HTTP(S) schemes and hostless values.
 * Returns null when the value cannot be a live site URL.
 */
export function normalizePromotionUrl(raw: string): string | null {
  let value = (raw ?? "").trim()
  if (!value) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.username || url.password) return null
    if (!url.hostname || !url.hostname.includes(".")) return null
    const normalized = url.toString()
    return normalized.endsWith("/") && url.pathname === "/" ? normalized.slice(0, -1) : normalized
  } catch {
    return null
  }
}

/** Clamp an already-schema-validated submission to the service bounds. */
function normalizeSubmission(input: AdRequestSubmission): AdRequestSubmission {
  const b = AD_REQUEST_BOUNDS
  const business = input.business
  const liveUrl = normalizePromotionUrl(business.liveUrl)
  return {
    business: {
      name: bounded(business.name, b.name),
      liveUrl: liveUrl ?? "",
      description: bounded(business.description, b.description),
      industry: bounded(business.industry, b.industry),
      targetAudience: bounded(business.targetAudience, b.targetAudience),
      mainProduct: bounded(business.mainProduct, b.mainProduct),
      location: bounded(business.location, b.location),
      contact: bounded(business.contact, b.contact),
      socialLinks: boundedList(business.socialLinks, b.socialLinks, b.socialLink)
        .map((link) => normalizePromotionUrl(link))
        .filter((link): link is string => Boolean(link)),
      pricingInfo: bounded(business.pricingInfo, b.pricingInfo),
      stage: bounded(business.stage, b.stage),
    },
    promote: {
      goals: boundedList(input.promote.goals, b.goals, b.goal),
      pitch: bounded(input.promote.pitch, b.pitch),
      context: bounded(input.promote.context, b.context),
    },
    audience: {
      who: bounded(input.audience.who, b.who),
      ageRange: bounded(input.audience.ageRange, b.ageRange),
      countries: bounded(input.audience.countries, b.countries),
      regions: bounded(input.audience.regions, b.regions),
      interests: bounded(input.audience.interests, b.interests),
      customerType: bounded(input.audience.customerType, b.customerType),
      problems: bounded(input.audience.problems, b.problems),
      profile: bounded(input.audience.profile, b.profile),
    },
    preferences: {
      objective: bounded(input.preferences.objective, b.objective),
      channels: boundedList(input.preferences.channels, b.channels, b.channel),
      duration: bounded(input.preferences.duration, b.duration),
      startDate: bounded(input.preferences.startDate, b.startDate),
      frequency: bounded(input.preferences.frequency, b.frequency),
      contentFormat: bounded(input.preferences.contentFormat, b.contentFormat),
      brandVoice: bounded(input.preferences.brandVoice, b.brandVoice),
      callToAction: bounded(input.preferences.callToAction, b.callToAction),
      budgetNote: bounded(input.preferences.budgetNote, b.budgetNote),
      instructions: bounded(input.preferences.instructions, b.instructions),
    },
    assets: (Array.isArray(input.assets) ? input.assets : [])
      .slice(0, b.assets)
      .map((asset) => ({
        url: bounded(asset.url, b.assetUrl),
        label: bounded(asset.label, b.assetLabel),
        kind: asset.kind,
      }))
      .filter((asset) => /^https:\/\//i.test(asset.url)),
    creation: input.creation,
    confirmations: input.confirmations,
  }
}

/**
 * Create a request. Idempotent on `idempotencyKey`: a retry returns the
 * original doc (only to its owner). Fails closed on non-owned projects, a
 * missing/invalid live URL, or any unconfirmed Section 6 acknowledgment.
 */
export async function createAdRequest(input: {
  userId: string
  projectId: string
  idempotencyKey: string
  submission: AdRequestSubmission
}): Promise<AdCampaignRequestDoc> {
  const key = (input.idempotencyKey ?? "").trim()
  if (!key || key.length > 120) throw new AppError("VALIDATION")

  await ensureAdsIndexes()
  const col = await adCampaignRequestsCol()

  // Retry path first — no ownership re-check needed for the same owner+project.
  const existing = (await col.findOne({ idempotencyKey: key })) as AdCampaignRequestDoc | null
  if (existing) {
    if (existing.userId !== input.userId || existing.projectId !== input.projectId) {
      throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
    }
    return existing
  }

  const project = await store.getProject(input.projectId)
  if (!project || project.userId !== input.userId) {
    throw new AppError("UNAUTHORIZED_PROJECT_ACCESS")
  }

  const submission = normalizeSubmission(input.submission)
  if (!submission.business.name || !submission.business.liveUrl) {
    throw new AppError("VALIDATION")
  }
  if (!submission.promote.pitch) {
    throw new AppError("VALIDATION")
  }
  const c = submission.confirmations
  if (
    !c.urlCorrect ||
    !c.infoAccurate ||
    !c.assetsAuthorized ||
    !c.manualExecutionUnderstood ||
    !c.noGuarantees ||
    !c.noAutoApproval
  ) {
    throw new AppError("VALIDATION")
  }

  const now = Date.now()
  const doc: AdCampaignRequestDoc = {
    _id: new ObjectId(),
    id: `adreq_${cryptoId()}`,
    userId: input.userId,
    projectId: input.projectId,
    idempotencyKey: key,
    status: "submitted",
    ...submission,
    priority: "normal",
    executionMode: "manual",
    payment: {
      status: "unpaid",
      creditsCharged: 0,
      subscriptionConsumed: 0,
      permanentConsumed: 0,
    },
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
  }

  try {
    await col.insertOne(doc as never)
  } catch (error) {
    // Concurrent double-submit raced past the findOne: the unique index caught
    // it — return the winner instead of a duplicate.
    if ((error as { code?: number }).code === 11000) {
      const winner = (await col.findOne({ idempotencyKey: key })) as AdCampaignRequestDoc | null
      if (winner && winner.userId === input.userId && winner.projectId === input.projectId) {
        return winner
      }
    }
    throw error
  }

  await appendAdRequestEvent({
    requestId: doc.id,
    projectId: input.projectId,
    userId: input.userId,
    actor: "founder",
    action: "submitted",
    detail: "Request received. Atai's team will review it and prepare a proposal — nothing is published yet.",
  })
  logger.info("marketing.ads.requests", "ad request submitted", {
    projectId: input.projectId,
    requestId: doc.id,
  })
  return doc
}

/** Append one immutable timeline row. Used by every later phase too. */
export async function appendAdRequestEvent(input: {
  requestId: string
  projectId: string
  userId: string
  actor: AdRequestEventDoc["actor"]
  action: string
  detail?: string
  fromStatus?: AdRequestStatus
  toStatus?: AdRequestStatus
  visibility?: AdRequestEventDoc["visibility"]
}): Promise<AdRequestEventDoc> {
  await ensureAdsIndexes()
  const doc: AdRequestEventDoc = {
    _id: new ObjectId(),
    id: `adreqev_${cryptoId()}`,
    requestId: input.requestId,
    projectId: input.projectId,
    userId: input.userId,
    actor: input.actor,
    action: input.action,
    visibility: input.visibility ?? "founder",
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.fromStatus ? { fromStatus: input.fromStatus } : {}),
    ...(input.toStatus ? { toStatus: input.toStatus } : {}),
    createdAt: Date.now(),
  }
  await (await adRequestEventsCol()).insertOne(doc as never)
  return doc
}

/** One request within its project (caller has already ownership-checked). */
export async function getAdRequest(projectId: string, requestId: string): Promise<AdCampaignRequestDoc | null> {
  await ensureAdsIndexes()
  return (await (await adCampaignRequestsCol()).findOne({ projectId, id: requestId })) as AdCampaignRequestDoc | null
}

/** Admin lookup by business id alone — callers must gate with requireAdmin. */
export async function getAdRequestById(requestId: string): Promise<AdCampaignRequestDoc | null> {
  await ensureAdsIndexes()
  return (await (await adCampaignRequestsCol()).findOne({ id: requestId })) as AdCampaignRequestDoc | null
}

/** Founder history for one project, newest first. */
export async function listAdRequests(projectId: string, opts: { limit?: number } = {}): Promise<AdCampaignRequestDoc[]> {
  await ensureAdsIndexes()
  return (await (await adCampaignRequestsCol())
    .find({ projectId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 100))
    .toArray()) as unknown as AdCampaignRequestDoc[]
}

/** Recent requests across a user's projects — feeds the derived notification inbox. */
export async function listAdRequestsForUser(userId: string, opts: { limit?: number } = {}): Promise<AdCampaignRequestDoc[]> {
  await ensureAdsIndexes()
  return (await (await adCampaignRequestsCol())
    .find({ userId })
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 50))
    .toArray()) as unknown as AdCampaignRequestDoc[]
}

/** The request timeline, chronological (caller has already ownership-checked). */
export async function listAdRequestEvents(
  projectId: string,
  requestId: string,
  opts: { includeInternal?: boolean } = {},
): Promise<AdRequestEventDoc[]> {
  await ensureAdsIndexes()
  const filter: Record<string, unknown> = { projectId, requestId }
  if (!opts.includeInternal) filter.visibility = { $ne: "internal" }
  return (await (await adRequestEventsCol())
    .find(filter)
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray()) as unknown as AdRequestEventDoc[]
}

export async function listAdRequestEventsById(
  requestId: string,
  opts: { includeInternal?: boolean } = {},
): Promise<AdRequestEventDoc[]> {
  await ensureAdsIndexes()
  const filter: Record<string, unknown> = { requestId }
  if (!opts.includeInternal) filter.visibility = { $ne: "internal" }
  return (await (await adRequestEventsCol())
    .find(filter)
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray()) as unknown as AdRequestEventDoc[]
}
