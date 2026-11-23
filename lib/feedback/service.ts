import "server-only"
import { ObjectId } from "mongodb"
import { AppError } from "@/lib/errors"
import { cryptoId } from "@/lib/store/id"
import { usersCol } from "@/lib/db/collections"
import { buildUpdate } from "@/lib/db/update"
import {
  feedbackAttachmentsCol,
  feedbackAuditCol,
  feedbackCommentsCol,
  feedbackIncidentsCol,
  feedbackReportsCol,
  feedbackRewardsCol,
  feedbackSettingsCol,
} from "@/lib/db/collections"
import { grantCredits } from "@/lib/billing/credit-service"
import type { CreditLedgerEntry } from "@/lib/billing/billing-types"
import {
  canTransitionStatus,
  categoryLabel,
  feedbackTextScore,
  fingerprintText,
  isFeedbackCategory,
  isFeedbackSeverity,
  isFeedbackStatus,
  isRewardableStatus,
  suggestSeverity,
} from "./config"
import type {
  AdminFeedbackReport,
  FeedbackAttachmentRef,
  FeedbackCategory,
  FeedbackCommentDoc,
  FeedbackDiagnostics,
  FeedbackIncidentDoc,
  FeedbackReportDoc,
  FeedbackSeverity,
  FeedbackSettingsDoc,
  FeedbackStatus,
  FeedbackTranscription,
  PublicFeedbackReport,
} from "./types"
import { FEEDBACK_CATEGORIES, STATUS_LABEL } from "./types"

const PAGE_SIZE = 20
const MAX_DESCRIPTION = 8000
const MIN_DESCRIPTION = 10
const MAX_ATTACHMENTS = 4
const MAX_INCIDENT_REPORTS = 200

// ─── Settings ────────────────────────────────────────────────────────────────

export const DEFAULT_FEEDBACK_SETTINGS: Omit<FeedbackSettingsDoc, "id" | "updatedAt"> = {
  enabled: true,
  bugReportsEnabled: true,
  cofounderShortcutEnabled: true,
  voiceEnabled: true,
  screenshotEnabled: true,
  maxAudioSeconds: 300,
  maxAudioBytes: 8 * 1024 * 1024,
  maxAttachmentBytes: 8 * 1024 * 1024,
  rewardsEnabled: true,
  rewardTiers: [
    { id: "minor_ui", label: "Minor UI issue", credits: 1000 },
    { id: "minor_bug", label: "Minor functional bug", credits: 5000 },
    { id: "workflow", label: "Reproducible workflow issue", credits: 20000 },
    { id: "production", label: "Significant production bug", credits: 60000 },
    { id: "critical", label: "Critical business-impacting issue", credits: 250000 },
    { id: "exceptional", label: "Exceptional critical discovery", credits: 1000000 },
  ],
  minReward: 100,
  maxReward: 2_000_000,
  dualApprovalOver: 100_000,
}

export async function getFeedbackSettings(): Promise<FeedbackSettingsDoc> {
  const col = await feedbackSettingsCol()
  const doc = await col.findOne({ id: "settings" })
  if (!doc) {
    return { id: "settings", ...DEFAULT_FEEDBACK_SETTINGS, updatedAt: 0 }
  }
  // Merge over defaults so newly-added keys appear on old documents.
  return {
    ...DEFAULT_FEEDBACK_SETTINGS,
    ...doc,
    rewardTiers: doc.rewardTiers?.length ? doc.rewardTiers : DEFAULT_FEEDBACK_SETTINGS.rewardTiers,
  } as FeedbackSettingsDoc
}

/** Settings safe to expose to any authenticated user (no admin internals). */
export async function publicFeedbackConfig() {
  const s = await getFeedbackSettings()
  return {
    enabled: s.enabled,
    bugReportsEnabled: s.bugReportsEnabled,
    cofounderShortcutEnabled: s.cofounderShortcutEnabled,
    voiceEnabled: s.voiceEnabled,
    screenshotEnabled: s.screenshotEnabled,
    maxAudioSeconds: s.maxAudioSeconds,
    maxAttachmentBytes: s.maxAttachmentBytes,
    categories: FEEDBACK_CATEGORIES,
    rewardsEnabled: s.rewardsEnabled,
    minReward: s.minReward,
    maxReward: s.maxReward,
  }
}

export async function adminUpdateSettings(adminId: string, patch: Partial<FeedbackSettingsDoc>) {
  const col = await feedbackSettingsCol()
  const allowed: (keyof FeedbackSettingsDoc)[] = [
    "enabled", "bugReportsEnabled", "cofounderShortcutEnabled", "voiceEnabled",
    "screenshotEnabled", "maxAudioSeconds", "maxAudioBytes", "maxAttachmentBytes",
    "rewardsEnabled", "rewardTiers", "minReward", "maxReward", "dualApprovalOver",
  ]
  const $set: Record<string, unknown> = { updatedAt: Date.now(), updatedBy: adminId }
  for (const key of allowed) {
    if (patch[key] === undefined) continue
    $set[key] = patch[key]
  }
  // Server-side guardrails — settings can tune, never weaken, hard limits.
  const maxReward = typeof $set.maxReward === "number" ? $set.maxReward : undefined
  if (maxReward !== undefined && (maxReward < 1 || maxReward > 2_000_000)) {
    throw new AppError("VALIDATION", "Maximum reward must be between 1 and 2,000,000 credits.", 400)
  }
  if (typeof $set.minReward === "number" && typeof $set.maxReward === "number" && $set.minReward > $set.maxReward) {
    throw new AppError("VALIDATION", "Minimum reward cannot exceed the maximum reward.", 400)
  }
  if (typeof $set.maxAudioSeconds === "number" && ($set.maxAudioSeconds < 15 || $set.maxAudioSeconds > 1800)) {
    throw new AppError("VALIDATION", "Max recording length must be between 15 and 1800 seconds.", 400)
  }
  await col.updateOne({ id: "settings" }, { $set, $setOnInsert: { id: "settings" } }, { upsert: true })
  await audit(null, adminId, "settings.update", "Feedback hub settings updated")
  return getFeedbackSettings()
}

// ─── Audit ───────────────────────────────────────────────────────────────────

async function audit(reportId: string | null, actorId: string, action: string, detail?: string) {
  const col = await feedbackAuditCol()
  await col.insertOne({
    _id: new ObjectId(),
    id: cryptoId(),
    reportId,
    actorId,
    action,
    ...(detail ? { detail: detail.slice(0, 500) } : {}),
    createdAt: Date.now(),
  })
}

// ─── Submission ──────────────────────────────────────────────────────────────

function makeReference(): string {
  return `FB-${cryptoId().replace(/-/g, "").slice(0, 8).toUpperCase()}`
}

export interface SubmitReportInput {
  category: string
  description: string
  originalDescription?: string
  detectedLanguage?: string
  transcription?: FeedbackTranscription
  attachments?: FeedbackAttachmentRef[]
  diagnostics: FeedbackDiagnostics
  fingerprint?: string
}

export async function submitReport(userId: string, input: SubmitReportInput) {
  const settings = await getFeedbackSettings()
  if (!settings.enabled || !settings.bugReportsEnabled) {
    throw new AppError("VALIDATION", "Bug reporting is currently disabled.", 403)
  }
  if (!isFeedbackCategory(input.category)) {
    throw new AppError("VALIDATION", "Please choose what kind of issue this is.", 400)
  }
  const description = input.description.trim()
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) {
    throw new AppError("VALIDATION", `Please describe the issue (${MIN_DESCRIPTION}–${MAX_DESCRIPTION} characters).`, 400)
  }
  const attachments = (input.attachments ?? []).slice(0, MAX_ATTACHMENTS)
  for (const a of attachments) {
    if (!["image", "audio"].includes(a.kind) || !a.id || a.size <= 0 || a.size > settings.maxAttachmentBytes) {
      throw new AppError("VALIDATION", "One of the attachments is invalid.", 400)
    }
  }

  // Diagnostics must be a bounded, well-formed object — never trust the client
  // to send an arbitrary blob. Rebuild the shape field-by-field.
  const diag = sanitizeDiagnostics(input.diagnostics)
  const fingerprint = input.fingerprint && /^[a-z0-9]{1,16}$/.test(input.fingerprint)
    ? input.fingerprint
    : fingerprintText(`${input.category}|${diag.page.route}|${description.slice(0, 120)}`)

  const similar = await findSimilarReports({
    fingerprint,
    route: diag.page.route,
    description,
    excludeUserId: userId,
  })

  const now = Date.now()
  const severity = suggestSeverity({
    category: input.category,
    description,
    hasSecuritySignal: input.category === "security",
  })

  const doc: FeedbackReportDoc = {
    id: `fb_${cryptoId().replace(/-/g, "").slice(0, 16)}`,
    reference: makeReference(),
    userId,
    category: input.category,
    description,
    ...(input.originalDescription && input.originalDescription !== description
      ? { originalDescription: input.originalDescription.slice(0, MAX_DESCRIPTION) }
      : {}),
    ...(input.detectedLanguage ? { detectedLanguage: input.detectedLanguage.slice(0, 20) } : {}),
    transcription: input.transcription ?? { status: "none", method: "manual" },
    attachments,
    diagnostics: diag,
    fingerprint,
    similarReportIds: similar.map((s) => s.id),
    severity,
    suggestedSeverity: severity,
    status: "new",
    createdAt: now,
    updatedAt: now,
  }

  const col = await feedbackReportsCol()
  await col.insertOne({ ...doc, _id: new ObjectId() })

  // Link any uploaded attachments that were staged before the report existed.
  if (attachments.length) {
    const attCol = await feedbackAttachmentsCol()
    await attCol.updateMany(
      { id: { $in: attachments.map((a) => a.id) }, userId },
      { $set: { reportId: doc.id } },
    )
  }

  await audit(doc.id, userId, "report.submit", `${doc.reference} — ${categoryLabel(input.category)}`)
  return { id: doc.id, reference: doc.reference, status: doc.status, createdAt: doc.createdAt }
}

/** Rebuild the diagnostics payload field-by-field so nothing unexpected
 * (extra keys, oversized arrays) is ever persisted. */
function sanitizeDiagnostics(input: FeedbackDiagnostics): FeedbackDiagnostics {
  const fallback: FeedbackDiagnostics = {
    page: { url: "/", route: "/", title: "", environment: "unknown" },
    device: {
      deviceCategory: "desktop",
      screenWidth: 0, screenHeight: 0, viewportWidth: 0, viewportHeight: 0,
      language: "en", online: true, userAgent: "",
    },
    errors: [],
    collectedAt: Date.now(),
    collectorVersion: 1,
  }
  if (!input || typeof input !== "object") return fallback
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined)
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

  const page = input.page ?? ({} as FeedbackDiagnostics["page"])
  const device = input.device ?? ({} as FeedbackDiagnostics["device"])
  const errors = Array.isArray(input.errors) ? input.errors.slice(0, 12) : []

  return {
    page: {
      url: str(page.url, 500) ?? fallback.page.url,
      route: str(page.route, 300) ?? fallback.page.route,
      title: str(page.title, 200) ?? "",
      ...(str(page.section, 100) ? { section: str(page.section, 100) } : {}),
      ...(str(page.projectId, 128) ? { projectId: str(page.projectId, 128) } : {}),
      environment: str(page.environment, 40) ?? "unknown",
      ...(str(page.release, 80) ? { release: str(page.release, 80) } : {}),
    },
    device: {
      ...(str(device.browser, 60) ? { browser: str(device.browser, 60) } : {}),
      ...(str(device.browserVersion, 20) ? { browserVersion: str(device.browserVersion, 20) } : {}),
      ...(str(device.os, 40) ? { os: str(device.os, 40) } : {}),
      deviceCategory: ["mobile", "tablet", "desktop"].includes(device.deviceCategory)
        ? device.deviceCategory
        : "desktop",
      screenWidth: num(device.screenWidth) ?? 0,
      screenHeight: num(device.screenHeight) ?? 0,
      viewportWidth: num(device.viewportWidth) ?? 0,
      viewportHeight: num(device.viewportHeight) ?? 0,
      language: str(device.language, 20) ?? "en",
      online: typeof device.online === "boolean" ? device.online : true,
      userAgent: str(device.userAgent, 300) ?? "",
    },
    errors: errors.map((e) => {
      const st = num(e?.status)
      const at = num(e?.at) ?? Date.now()
      return {
        kind: (["exception", "rejection", "api_failure", "resource_failure"].includes(e?.kind) ? e.kind : "exception") as FeedbackDiagnostics["errors"][number]["kind"],
        ...(str(e?.name, 80) ? { name: str(e?.name, 80) } : {}),
        message: str(e?.message, 500) ?? "",
        ...(str(e?.fingerprint, 20) ? { fingerprint: str(e?.fingerprint, 20) } : {}),
        ...(st !== undefined ? { status: st } : {}),
        ...(str(e?.url, 300) ? { url: str(e?.url, 300) } : {}),
        at,
      }
    }),
    collectedAt: num(input.collectedAt) ?? Date.now(),
    collectorVersion: num(input.collectorVersion) ?? 1,
  }
}

/** Similar open reports for recurrence detection — fingerprint first, then
 * route + text similarity. Never used to auto-reject anything. */
async function findSimilarReports(input: {
  fingerprint: string
  route: string
  description: string
  excludeUserId: string
}): Promise<{ id: string; reference: string; status: FeedbackStatus; createdAt: number }[]> {
  const col = await feedbackReportsCol()
  const candidates = await col
    .find({
      status: { $in: ["new", "reviewing", "verified", "in_progress"] },
      createdAt: { $gte: Date.now() - 30 * 24 * 60 * 60 * 1000 },
    })
    .project({ id: 1, reference: 1, status: 1, createdAt: 1, fingerprint: 1, description: 1, "diagnostics.page.route": 1 })
    .sort({ createdAt: -1 })
    .limit(120)
    .toArray()

  const scored = candidates
    .filter((c) => c.id && c.userId !== input.excludeUserId)
    .map((c) => {
      let score = 0
      if (c.fingerprint && c.fingerprint === input.fingerprint) score += 0.6
      const route = (c as { diagnostics?: { page?: { route?: string } } }).diagnostics?.page?.route
      if (route === input.route) score += 0.15
      score += feedbackTextScore(input.description, String(c.description ?? "")) * 0.35
      return { id: String(c.id), reference: String(c.reference), status: c.status as FeedbackStatus, createdAt: c.createdAt as number, score }
    })
    .filter((c) => c.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
  return scored.map(({ id, reference, status, createdAt }) => ({ id, reference, status, createdAt }))
}

// ─── User-facing reads ───────────────────────────────────────────────────────

function toPublic(doc: FeedbackReportDoc, responses: { id: string; body: string; createdAt: number }[]): PublicFeedbackReport {
  return {
    id: doc.id,
    reference: doc.reference,
    category: doc.category,
    categoryLabel: categoryLabel(doc.category),
    description: doc.description,
    status: doc.status,
    statusLabel: STATUS_LABEL[doc.status] ?? doc.status,
    severity: doc.severity,
    ...(doc.incidentId ? { incidentId: doc.incidentId } : {}),
    attachments: doc.attachments.map((a) => ({
      id: a.id, kind: a.kind, name: a.name, mimeType: a.mimeType, size: a.size,
      ...(a.durationSeconds ? { durationSeconds: a.durationSeconds } : {}),
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(doc.resolvedAt ? { resolvedAt: doc.resolvedAt } : {}),
    responses,
    ...(doc.reward ? { reward: { amount: doc.reward.amount, ...(doc.reward.note ? { note: doc.reward.note } : {}), approvedAt: doc.reward.approvedAt } } : {}),
  }
}

export async function listMyReports(userId: string, page = 1) {
  const col = await feedbackReportsCol()
  const p = Math.max(1, page)
  const filter = { userId }
  const [total, docs, rewardsCol_] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
    feedbackRewardsCol(),
  ])
  const rewardDocs = await rewardsCol_.find({ userId, status: "approved" }).project({ reportId: 1, amount: 1 }).toArray()
  const rewardByReport = new Map(rewardDocs.map((r) => [r.reportId, r.amount]))

  // Stats across ALL the user's reports, not just this page.
  const all = await col.find({ userId }).project({ status: 1 }).toArray()
  const stats = {
    total: all.length,
    awaitingReview: all.filter((d) => ["new", "reviewing"].includes(d.status)).length,
    verified: all.filter((d) => d.status === "verified" || d.status === "in_progress").length,
    resolved: all.filter((d) => d.status === "resolved").length,
    rejected: all.filter((d) => ["rejected", "duplicate"].includes(d.status)).length,
    totalRewards: rewardDocs.reduce((s, r) => s + (r.amount ?? 0), 0),
    rewardCount: rewardDocs.length,
  }

  return {
    page: p,
    pageSize: PAGE_SIZE,
    total,
    stats,
    items: docs.map((d) => {
      const pub = toPublic(d as FeedbackReportDoc, [])
      const amount = rewardByReport.get(d.id)
      if (amount !== undefined && pub.reward === undefined) {
        pub.reward = { amount, approvedAt: d.updatedAt }
      }
      return pub
    }),
  }
}

export async function getMyReport(userId: string, id: string): Promise<PublicFeedbackReport> {
  const col = await feedbackReportsCol()
  const doc = await col.findOne({ id, userId })
  if (!doc) throw new AppError("UNKNOWN", "We couldn't find that report.", 404)
  const comments = await feedbackCommentsCol()
  const publicComments = await comments
    .find({ reportId: id, kind: "public" })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray()
  return toPublic(doc as FeedbackReportDoc, publicComments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt })))
}

// ─── Admin reads ─────────────────────────────────────────────────────────────

export interface AdminListParams {
  q?: string
  status?: FeedbackStatus | "all" | "needs_review"
  category?: FeedbackCategory | "all"
  severity?: FeedbackSeverity | "all"
  route?: string
  incidentId?: string
  rewardStatus?: "all" | "rewarded" | "unrewarded"
  from?: number
  to?: number
  page?: number
  sort?: "newest" | "oldest" | "updated"
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function adminListReports(params: AdminListParams) {
  const col = await feedbackReportsCol()
  const page = Math.max(1, params.page ?? 1)
  const filter: Record<string, unknown> = {}

  if (params.status === "needs_review") filter.status = { $in: ["new", "reviewing"] }
  else if (params.status && params.status !== "all") {
    if (!isFeedbackStatus(params.status)) throw new AppError("VALIDATION", "Invalid status filter.", 400)
    filter.status = params.status
  }
  if (params.category && params.category !== "all") {
    if (!isFeedbackCategory(params.category)) throw new AppError("VALIDATION", "Invalid category filter.", 400)
    filter.category = params.category
  }
  if (params.severity && params.severity !== "all") {
    if (!isFeedbackSeverity(params.severity)) throw new AppError("VALIDATION", "Invalid severity filter.", 400)
    filter.severity = params.severity
  }
  if (params.incidentId) filter.incidentId = params.incidentId
  if (params.route?.trim()) filter["diagnostics.page.route"] = params.route.trim().slice(0, 200)
  if (params.from || params.to) {
    filter.createdAt = {
      ...(params.from ? { $gte: params.from } : {}),
      ...(params.to ? { $lte: params.to } : {}),
    }
  }
  if (params.rewardStatus === "rewarded") filter.reward = { $exists: true }
  if (params.rewardStatus === "unrewarded") filter.reward = { $exists: false }
  if (params.q?.trim()) {
    const rx = new RegExp(escapeRegex(params.q.trim()), "i")
    filter.$or = [{ reference: rx }, { id: rx }, { description: rx }, { userId: rx }, { fingerprint: rx }]
  }

  const sort: Record<string, 1 | -1> =
    params.sort === "oldest" ? { createdAt: 1 } : params.sort === "updated" ? { updatedAt: -1 } : { createdAt: -1 }

  const [total, docs] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter).sort(sort).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
  ])

  const userIds = [...new Set(docs.map((d) => String(d.userId)))]
  const names = await authorMap(userIds)

  return {
    page,
    pageSize: PAGE_SIZE,
    total,
    items: docs.map((d) => toAdminListItem(d as FeedbackReportDoc, names)),
  }
}

function toAdminListItem(doc: FeedbackReportDoc, names: Map<string, { name: string; email: string }>) {
  const u = names.get(doc.userId)
  return {
    id: doc.id,
    reference: doc.reference,
    userId: doc.userId,
    userName: u?.name,
    userEmail: u?.email,
    category: doc.category,
    categoryLabel: categoryLabel(doc.category),
    description: doc.description.slice(0, 240),
    status: doc.status,
    severity: doc.severity,
    fingerprint: doc.fingerprint,
    route: doc.diagnostics?.page?.route,
    section: doc.diagnostics?.page?.section,
    projectId: doc.diagnostics?.page?.projectId,
    incidentId: doc.incidentId,
    hasReward: Boolean(doc.reward),
    rewardAmount: doc.reward?.amount,
    attachmentCount: doc.attachments?.length ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

async function authorMap(ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; email: string }>()
  const users = await usersCol()
  const docs = await users
    .find({ id: { $in: [...new Set(ids)] } })
    .project({ id: 1, name: 1, email: 1 })
    .toArray()
  return new Map(docs.map((u) => [String(u.id), { name: String(u.name || "Founder"), email: String(u.email || "") }]))
}

export async function adminFeedbackStats() {
  const col = await feedbackReportsCol()
  const rewards = await feedbackRewardsCol()
  const [
    total, newCount, reviewing, verified, inProgress, resolved, rejected, duplicates,
    p0, rewardedCreditsAgg, categoryAgg, routeAgg, incidentCount,
  ] = await Promise.all([
    col.countDocuments({}),
    col.countDocuments({ status: "new" }),
    col.countDocuments({ status: "reviewing" }),
    col.countDocuments({ status: "verified" }),
    col.countDocuments({ status: "in_progress" }),
    col.countDocuments({ status: "resolved" }),
    col.countDocuments({ status: "rejected" }),
    col.countDocuments({ status: "duplicate" }),
    col.countDocuments({ severity: "P0" }),
    rewards.aggregate([{ $match: { status: "approved" } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]).toArray(),
    col.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]).toArray(),
    col.aggregate([{ $group: { _id: "$diagnostics.page.route", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]).toArray(),
    feedbackIncidentsCol().then((c) => c.countDocuments({ status: { $ne: "closed" } })),
  ])
  const rewardAgg = rewardedCreditsAgg[0] as { total?: number; count?: number } | undefined
  return {
    total,
    new: newCount,
    reviewing,
    verified,
    inProgress,
    resolved,
    rejected,
    duplicates,
    critical: p0,
    openIncidents: incidentCount,
    creditsAwarded: rewardAgg?.total ?? 0,
    rewardsIssued: rewardAgg?.count ?? 0,
    byCategory: categoryAgg.map((r) => ({ category: String(r._id), count: Number(r.count) })),
    topRoutes: routeAgg.map((r) => ({ route: String(r._id ?? "/"), count: Number(r.count) })),
  }
}

export async function adminGetReport(id: string): Promise<AdminFeedbackReport> {
  const col = await feedbackReportsCol()
  const doc = await col.findOne({ id })
  if (!doc) throw new AppError("UNKNOWN", "We couldn't find that report.", 404)
  const report = doc as FeedbackReportDoc

  const [commentsCol, auditCol, rewardsCol2, reportsCol2] = await Promise.all([
    feedbackCommentsCol(), feedbackAuditCol(), feedbackRewardsCol(), feedbackReportsCol(),
  ])
  const [allComments, auditDocs, rewards, similarDocs] = await Promise.all([
    commentsCol.find({ reportId: id }).sort({ createdAt: 1 }).limit(200).toArray(),
    auditCol.find({ reportId: id }).sort({ createdAt: -1 }).limit(100).toArray(),
    rewardsCol2.find({ reportId: id }).sort({ createdAt: -1 }).toArray(),
    report.similarReportIds.length
      ? reportsCol2.find({ id: { $in: report.similarReportIds } }).project({ id: 1, reference: 1, status: 1, createdAt: 1 }).toArray()
      : Promise.resolve([]),
  ])
  const comments = allComments.filter((c) => c.kind === "public")
  const notes = allComments.filter((c) => c.kind === "internal")

  const names = await authorMap([report.userId, ...allComments.map((c) => c.authorId), ...auditDocs.map((a) => a.actorId)])
  const user = names.get(report.userId)

  const base = toPublic(report, comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt })))
  return {
    ...base,
    userId: report.userId,
    ...(user?.name ? { userName: user.name } : {}),
    ...(user?.email ? { userEmail: user.email } : {}),
    ...(report.originalDescription ? { originalDescription: report.originalDescription } : {}),
    ...(report.detectedLanguage ? { detectedLanguage: report.detectedLanguage } : {}),
    transcription: report.transcription,
    diagnostics: report.diagnostics,
    ...(report.fingerprint ? { fingerprint: report.fingerprint } : {}),
    similarReportIds: report.similarReportIds,
    similarReports: similarDocs.map((s) => ({ id: String(s.id), reference: String(s.reference), status: s.status as FeedbackStatus, createdAt: s.createdAt as number })),
    ...(report.assigneeId ? { assigneeId: report.assigneeId } : {}),
    internalNotes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt })),
    auditHistory: auditDocs.map((a) => ({ id: a.id, action: a.action, actorId: a.actorId, ...(a.detail ? { detail: a.detail } : {}), createdAt: a.createdAt })),
    rewardHistory: rewards.map((r) => ({
      id: r.id, amount: r.amount, approvedBy: r.approvedBy, status: r.status,
      ...(r.note ? { note: r.note } : {}),
      ...(r.ledgerEntryId ? { ledgerEntryId: r.ledgerEntryId } : {}),
      ...(r.failureReason ? { failureReason: r.failureReason } : {}),
      createdAt: r.createdAt,
    })),
  }
}

// ─── Admin mutations ─────────────────────────────────────────────────────────

export async function adminPatchReport(
  id: string,
  adminId: string,
  patch: {
    status?: string
    severity?: string
    assigneeId?: string | null
    incidentId?: string | null
    internalNote?: string
    publicResponse?: string
    reason?: string
  },
) {
  const col = await feedbackReportsCol()
  const doc = await col.findOne({ id })
  if (!doc) throw new AppError("UNKNOWN", "We couldn't find that report.", 404)
  const report = doc as FeedbackReportDoc
  const now = Date.now()
  const $set: Record<string, unknown> = { updatedAt: now }
  const actions: string[] = []

  if (patch.status !== undefined) {
    if (!isFeedbackStatus(patch.status)) throw new AppError("VALIDATION", "Invalid status.", 400)
    const to = patch.status
    if (to !== report.status) {
      if (!canTransitionStatus(report.status, to)) {
        throw new AppError("VALIDATION", `Cannot move a report from "${report.status}" to "${to}".`, 400)
      }
      if ((to === "rejected" || to === "duplicate") && !patch.reason?.trim() && !patch.publicResponse?.trim()) {
        throw new AppError("VALIDATION", "Add a short reason for this decision.", 400)
      }
      $set.status = to
      if (to === "resolved") $set.resolvedAt = now
      actions.push(`status:${report.status}→${to}`)
      await audit(id, adminId, "report.status", `${report.reference}: ${report.status} → ${to}${patch.reason ? ` (${patch.reason.slice(0, 120)})` : ""}`)
    }
  }

  if (patch.severity !== undefined) {
    if (!isFeedbackSeverity(patch.severity)) throw new AppError("VALIDATION", "Invalid severity.", 400)
    if (patch.severity !== report.severity) {
      $set.severity = patch.severity
      actions.push(`severity:${report.severity}→${patch.severity}`)
      await audit(id, adminId, "report.severity", `${report.reference}: ${report.severity} → ${patch.severity}`)
    }
  }

  if (patch.assigneeId !== undefined) {
    $set.assigneeId = patch.assigneeId?.trim() || null
    actions.push("assignee")
    await audit(id, adminId, "report.assign", `${report.reference} assigned`)
  }

  if (patch.incidentId !== undefined) {
    if (patch.incidentId) {
      const inc = await (await feedbackIncidentsCol()).findOne({ id: patch.incidentId })
      if (!inc) throw new AppError("VALIDATION", "Incident not found.", 400)
    }
    $set.incidentId = patch.incidentId || null
    actions.push("incident")
    await audit(id, adminId, "report.incident", `${report.reference} incident link updated`)
  }

  if (actions.length) {
    await col.updateOne({ id }, { $set })
  }

  const comments = await feedbackCommentsCol()
  const now2 = Date.now()
  if (patch.internalNote?.trim()) {
    await comments.insertOne({
      _id: new ObjectId(),
      id: cryptoId(),
      reportId: id,
      authorId: adminId,
      authorIsAdmin: true,
      kind: "internal",
      body: patch.internalNote.trim().slice(0, 4000),
      createdAt: now2,
    } as FeedbackCommentDoc & { _id: ObjectId })
    await audit(id, adminId, "report.note", "Internal note added")
  }
  if (patch.publicResponse?.trim()) {
    await comments.insertOne({
      _id: new ObjectId(),
      id: cryptoId(),
      reportId: id,
      authorId: adminId,
      authorIsAdmin: true,
      kind: "public",
      body: patch.publicResponse.trim().slice(0, 4000),
      createdAt: now2,
    } as FeedbackCommentDoc & { _id: ObjectId })
    await audit(id, adminId, "report.response", "User-visible response added")
  }

  return adminGetReport(id)
}

// ─── Rewards ─────────────────────────────────────────────────────────────────

export interface RewardApprovalInput {
  amount?: number
  tierId?: string
  note?: string
}

/**
 * Approve a permanent-credit reward for a report. The credit itself is granted
 * through the authoritative ledger (grantCredits) with a deterministic
 * idempotency key, and the feedback_rewards unique index on reportId makes a
 * second approval impossible even under concurrency.
 */
export async function approveReportReward(
  reportId: string,
  adminId: string,
  input: RewardApprovalInput,
): Promise<{ rewardId: string; amount: number; ledgerEntryId?: string }> {
  const settings = await getFeedbackSettings()
  if (!settings.rewardsEnabled) {
    throw new AppError("VALIDATION", "Contributor rewards are currently disabled.", 403)
  }

  const reports = await feedbackReportsCol()
  const report = await reports.findOne({ id: reportId })
  if (!report) throw new AppError("UNKNOWN", "We couldn't find that report.", 404)
  const r = report as FeedbackReportDoc

  // An admin may never approve a reward on their own report.
  if (r.userId === adminId) {
    throw new AppError("UNAUTHORIZED", "You cannot approve a reward for your own report.", 403)
  }
  if (!isRewardableStatus(r.status)) {
    throw new AppError("VALIDATION", "Rewards can only be approved for verified, in-progress, or resolved reports.", 400)
  }
  if (r.reward) {
    throw new AppError("VALIDATION", "This report already has an approved reward.", 409)
  }

  // Resolve amount: explicit amount wins, else tier lookup. Never trust client
  // beyond bounds — clamp validation is server-side against settings.
  let amount: number
  if (typeof input.amount === "number") {
    amount = Math.round(input.amount)
  } else if (input.tierId) {
    const tier = settings.rewardTiers.find((t) => t.id === input.tierId)
    if (!tier) throw new AppError("VALIDATION", "Unknown reward tier.", 400)
    amount = tier.credits
  } else {
    throw new AppError("VALIDATION", "Choose a reward tier or enter an amount.", 400)
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError("VALIDATION", "Reward amount must be a positive whole number of credits.", 400)
  }
  if (amount < settings.minReward || amount > settings.maxReward) {
    throw new AppError(
      "VALIDATION",
      `Reward must be between ${settings.minReward.toLocaleString()} and ${settings.maxReward.toLocaleString()} credits.`,
      400,
    )
  }
  if (amount > 2_000_000) {
    throw new AppError("VALIDATION", "Rewards cannot exceed 2,000,000 credits per report.", 400)
  }
  // Exceptional rewards require an explicit note explaining the award.
  if (amount > settings.dualApprovalOver && !input.note?.trim()) {
    throw new AppError("VALIDATION", "Exceptional rewards require a written justification.", 400)
  }

  const rewards = await feedbackRewardsCol()
  const rewardDoc = {
    _id: new ObjectId(),
    id: cryptoId(),
    reportId,
    userId: r.userId,
    amount,
    approvedBy: adminId,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1000) } : {}),
    status: "approved" as const,
    createdAt: Date.now(),
  }

  try {
    await rewards.insertOne(rewardDoc)
  } catch (e) {
    // E11000 on the unique reportId index — another approval won the race.
    if (e instanceof Error && /E11000|duplicate key/i.test(e.message)) {
      throw new AppError("VALIDATION", "This report already has a reward record.", 409)
    }
    throw e
  }

  // Grant through the authoritative permanent-credit ledger. The idempotency
  // key is derived from the report id so a retry can never double-pay.
  try {
    const grant = await grantCredits({
      userId: r.userId,
      creditType: "permanent",
      amount,
      transactionType: "feedback_reward",
      idempotencyKey: `feedback_reward_${reportId}`,
      referenceType: "feedback_report",
      referenceId: reportId,
      metadata: {
        reportReference: r.reference,
        approvedBy: adminId,
        reason: input.note?.trim() || `Bug bounty reward for ${r.reference}`,
      },
    })
    const ledgerEntryId = (grant.ledgerEntry as CreditLedgerEntry | undefined)?.id
    await rewards.updateOne({ id: rewardDoc.id }, { $set: { ledgerEntryId } })
    await reports.updateOne(
      { id: reportId },
      {
        $set: {
          reward: { amount, approvedBy: adminId, approvedAt: Date.now(), ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}) },
          updatedAt: Date.now(),
        },
      },
    )
    await audit(reportId, adminId, "reward.approve", `${r.reference}: +${amount.toLocaleString()} permanent credits`)
    return { rewardId: rewardDoc.id, amount, ledgerEntryId }
  } catch (e) {
    await rewards.updateOne(
      { id: rewardDoc.id },
      { $set: { status: "failed", failureReason: e instanceof Error ? e.message.slice(0, 300) : "grant failed" } },
    )
    await audit(reportId, adminId, "reward.failed", `${r.reference}: reward grant failed`)
    throw e
  }
}

export async function listReportRewards(reportId: string) {
  const rewards = await feedbackRewardsCol()
  return rewards.find({ reportId }).sort({ createdAt: -1 }).toArray()
}

// ─── Incidents ───────────────────────────────────────────────────────────────

function incidentReference(): string {
  return `INC-${cryptoId().replace(/-/g, "").slice(0, 8).toUpperCase()}`
}

export async function listIncidents(status?: string) {
  const col = await feedbackIncidentsCol()
  const filter: Record<string, unknown> =
    status && ["open", "investigating", "resolved", "closed"].includes(status) ? { status } : {}
  const docs = await col.find(filter).sort({ updatedAt: -1 }).limit(100).toArray()
  return docs.map((d) => ({
    id: d.id,
    reference: d.reference,
    title: d.title,
    severity: d.severity,
    status: d.status,
    reportCount: d.reportIds?.length ?? 0,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }))
}

export async function createIncident(adminId: string, input: { title: string; description?: string; severity: FeedbackSeverity; reportIds?: string[] }) {
  const title = input.title.trim()
  if (title.length < 4 || title.length > 200) throw new AppError("VALIDATION", "Give the incident a short title.", 400)
  if (!isFeedbackSeverity(input.severity)) throw new AppError("VALIDATION", "Invalid severity.", 400)
  const reportIds = (input.reportIds ?? []).slice(0, MAX_INCIDENT_REPORTS)
  if (reportIds.length) {
    const reports = await feedbackReportsCol()
    const found = await reports.countDocuments({ id: { $in: reportIds } })
    if (found !== reportIds.length) throw new AppError("VALIDATION", "One or more reports were not found.", 400)
    await reports.updateMany({ id: { $in: reportIds } }, buildUpdate({ incidentId: undefined, updatedAt: Date.now() }))
  }
  const now = Date.now()
  const doc: FeedbackIncidentDoc = {
    id: `inc_${cryptoId().replace(/-/g, "").slice(0, 16)}`,
    reference: incidentReference(),
    title,
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, 2000) } : {}),
    severity: input.severity,
    status: "open",
    reportIds,
    createdBy: adminId,
    createdAt: now,
    updatedAt: now,
  }
  const col = await feedbackIncidentsCol()
  await col.insertOne({ ...doc, _id: new ObjectId() })
  if (reportIds.length) {
    const reports = await feedbackReportsCol()
    await reports.updateMany({ id: { $in: reportIds } }, { $set: { incidentId: doc.id, updatedAt: now } })
  }
  await audit(null, adminId, "incident.create", `${doc.reference}: ${title}`)
  return doc
}

export async function patchIncident(id: string, adminId: string, patch: { status?: string; title?: string; severity?: string; resolution?: string; reportIds?: string[]; assigneeId?: string }) {
  const col = await feedbackIncidentsCol()
  const doc = await col.findOne({ id })
  if (!doc) throw new AppError("UNKNOWN", "We couldn't find that incident.", 404)
  const now = Date.now()
  const $set: Record<string, unknown> = { updatedAt: now }
  const $unset: Record<string, ""> = {}
  if (patch.status) {
    if (!["open", "investigating", "resolved", "closed"].includes(patch.status)) throw new AppError("VALIDATION", "Invalid incident status.", 400)
    $set.status = patch.status
    if (patch.status === "resolved" || patch.status === "closed") $set.resolvedAt = now
  }
  if (patch.title?.trim()) $set.title = patch.title.trim().slice(0, 200)
  if (patch.severity) {
    if (!isFeedbackSeverity(patch.severity)) throw new AppError("VALIDATION", "Invalid severity.", 400)
    $set.severity = patch.severity
  }
  // An empty value CLEARS the field — it must be removed, not written as null.
  if (patch.resolution !== undefined) {
    const resolution = patch.resolution?.trim().slice(0, 2000)
    if (resolution) $set.resolution = resolution
    else $unset.resolution = ""
  }
  if (patch.assigneeId !== undefined) {
    const assigneeId = patch.assigneeId?.trim()
    if (assigneeId) $set.assigneeId = assigneeId
    else $unset.assigneeId = ""
  }

  let added: string[] = []
  let removed: string[] = []
  if (patch.reportIds) {
    const next = [...new Set(patch.reportIds)].slice(0, MAX_INCIDENT_REPORTS)
    const prev = new Set((doc.reportIds ?? []) as string[])
    const nextSet = new Set(next)
    added = next.filter((r) => !prev.has(r))
    removed = [...prev].filter((r) => !nextSet.has(r))
    $set.reportIds = next
    const reports = await feedbackReportsCol()
    if (added.length) await reports.updateMany({ id: { $in: added } }, { $set: { incidentId: id, updatedAt: now } })
    if (removed.length) await reports.updateMany({ id: { $in: removed }, incidentId: id }, { $unset: { incidentId: "" }, $set: { updatedAt: now } })
  }

  await col.updateOne({ id }, { $set, ...(Object.keys($unset).length > 0 ? { $unset } : {}) })
  await audit(null, adminId, "incident.update", `${doc.reference} updated`)
  return col.findOne({ id })
}

// ─── Attachments ─────────────────────────────────────────────────────────────

const ALLOWED_AUDIO_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"])
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

export async function stageAttachment(userId: string, input: {
  kind: "image" | "audio"
  fileName: string
  mimeType: string
  data: Buffer
  durationSeconds?: number
}) {
  const settings = await getFeedbackSettings()
  if (!settings.enabled) throw new AppError("VALIDATION", "Feedback is currently disabled.", 403)
  if (input.data.byteLength <= 0) throw new AppError("VALIDATION", "Empty file.", 400)
  if (input.data.byteLength > settings.maxAttachmentBytes) {
    throw new AppError("VALIDATION", `Files must be under ${Math.floor(settings.maxAttachmentBytes / 1024 / 1024)}MB.`, 413)
  }
  // Strip codec parameters — MediaRecorder reports e.g. "audio/webm;codecs=opus".
  const mime = input.mimeType.toLowerCase().split(";")[0].trim()
  if (input.kind === "audio") {
    if (!settings.voiceEnabled) throw new AppError("VALIDATION", "Voice reports are disabled.", 403)
    if (!ALLOWED_AUDIO_MIME.has(mime)) throw new AppError("VALIDATION", "Unsupported audio format.", 400)
    if (input.durationSeconds && input.durationSeconds > settings.maxAudioSeconds + 5) {
      throw new AppError("VALIDATION", `Recordings are limited to ${settings.maxAudioSeconds} seconds.`, 400)
    }
  } else {
    if (!settings.screenshotEnabled) throw new AppError("VALIDATION", "Image attachments are disabled.", 403)
    if (!ALLOWED_IMAGE_MIME.has(mime)) throw new AppError("VALIDATION", "Unsupported image format.", 400)
    // Magic-byte check — the declared MIME alone proves nothing.
    const isPng = input.data[0] === 0x89 && input.data[1] === 0x50
    const isJpeg = input.data[0] === 0xff && input.data[1] === 0xd8
    const isWebp = input.data.toString("ascii", 0, 4) === "RIFF" && input.data.toString("ascii", 8, 12) === "WEBP"
    const isGif = input.data.toString("ascii", 0, 4) === "GIF8"
    const okMagic = (mime === "image/png" && isPng) || (mime === "image/jpeg" && isJpeg) || (mime === "image/webp" && isWebp) || (mime === "image/gif" && isGif)
    if (!okMagic) throw new AppError("VALIDATION", "The file contents don't match an allowed image type.", 400)
  }

  const col = await feedbackAttachmentsCol()
  const id = `fba_${cryptoId().replace(/-/g, "").slice(0, 16)}`
  const ref: FeedbackAttachmentRef = {
    id,
    kind: input.kind,
    name: (input.fileName || "attachment").slice(0, 200),
    mimeType: mime,
    size: input.data.byteLength,
    ...(input.durationSeconds ? { durationSeconds: Math.round(input.durationSeconds) } : {}),
  }
  await col.insertOne({
    _id: new ObjectId(),
    id,
    userId,
    kind: input.kind,
    fileName: ref.name,
    mimeType: mime,
    size: input.data.byteLength,
    data: input.data,
    ...(input.durationSeconds ? { durationSeconds: Math.round(input.durationSeconds) } : {}),
    createdAt: Date.now(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })
  return ref
}

/** Fetch an attachment the requester is allowed to see: owner or admin. */
export async function getAttachmentForViewer(attachmentId: string, viewerId: string, isAdmin: boolean) {
  const col = await feedbackAttachmentsCol()
  const doc = await col.findOne({ id: attachmentId })
  if (!doc) throw new AppError("UNKNOWN", "Attachment not found.", 404)
  if (!isAdmin && doc.userId !== viewerId) throw new AppError("UNAUTHORIZED", "You don't have access to this file.", 403)
  return doc
}

// ─── Translation ─────────────────────────────────────────────────────────────

/**
 * Translate/convert report text into clear English using the shared OpenRouter
 * model. Returns null on any provider failure so callers can degrade gracefully
 * — the original text is always preserved by the caller regardless.
 */
export async function translateToEnglish(text: string): Promise<{ english: string; language?: string } | null> {
  try {
    const { generateText } = await import("ai")
    const { openRouterChatModel } = await import("@/lib/analysis/model")
    const model = openRouterChatModel(process.env.FEEDBACK_TRANSLATE_MODEL || "openai/gpt-4o-mini")
    const result = await generateText({
      model,
      prompt: [
        "You are a translation engine for a software bug-reporting system.",
        "Translate the user's message into clear, natural English suitable for an engineering ticket.",
        "Preserve meaning, technical terms, error messages, and names exactly. Do not summarise, add commentary, or ask questions.",
        "If the message is already English, return it unchanged.",
        "Reply with ONLY a JSON object: {\"language\":\"<iso-639-1 code of the source>\",\"english\":\"<translated text>\"}",
        "",
        "MESSAGE:",
        text.slice(0, 6000),
      ].join("\n"),
      maxOutputTokens: 1200,
    })
    const raw = result.text.trim()
    const jsonMatch = /\{[\s\S]*\}/.exec(raw)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as { language?: string; english?: string }
    if (!parsed.english?.trim()) return null
    return { english: parsed.english.trim().slice(0, MAX_DESCRIPTION), language: parsed.language?.slice(0, 10) }
  } catch {
    return null
  }
}
