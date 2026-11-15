/**
 * Atai Feedback Hub — shared types.
 *
 * Documents live in their own collections (feedback_reports,
 * feedback_comments, feedback_incidents, feedback_rewards,
 * feedback_attachments, feedback_settings) following the same conventions as
 * lib/feature-requests: string `id` keys, millisecond timestamps, link-only
 * references (never embedded user/project docs).
 */

export const FEEDBACK_CATEGORIES = [
  { id: "broken", label: "Something is broken" },
  { id: "error", label: "Unexpected error" },
  { id: "page_load", label: "Page not loading" },
  { id: "performance", label: "Performance issue" },
  { id: "incorrect", label: "Incorrect information or results" },
  { id: "security", label: "Security concern" },
  { id: "improvement", label: "Feature improvement" },
  { id: "other", label: "Other" },
] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["id"]

export const FEEDBACK_STATUSES = [
  "new",
  "reviewing",
  "verified",
  "in_progress",
  "resolved",
  "rejected",
  "duplicate",
] as const

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const FEEDBACK_SEVERITIES = ["P0", "P1", "P2", "P3", "P4"] as const
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number]

export const SEVERITY_LABEL: Record<FeedbackSeverity, string> = {
  P0: "P0 — Critical",
  P1: "P1 — High",
  P2: "P2 — Medium",
  P3: "P3 — Low",
  P4: "P4 — Suggestion",
}

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  reviewing: "Under review",
  verified: "Verified",
  in_progress: "In progress",
  resolved: "Resolved",
  rejected: "Rejected",
  duplicate: "Duplicate",
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export interface FeedbackPageContext {
  url: string
  route: string
  title: string
  section?: string
  projectId?: string
  environment: string
  release?: string
}

export interface FeedbackDeviceInfo {
  browser?: string
  browserVersion?: string
  os?: string
  deviceCategory: "mobile" | "tablet" | "desktop"
  screenWidth: number
  screenHeight: number
  viewportWidth: number
  viewportHeight: number
  language: string
  online: boolean
  userAgent: string
}

export interface FeedbackErrorEntry {
  kind: "exception" | "rejection" | "api_failure" | "resource_failure"
  name?: string
  message: string
  fingerprint?: string
  status?: number
  url?: string
  at: number
}

export interface FeedbackDiagnostics {
  page: FeedbackPageContext
  device: FeedbackDeviceInfo
  errors: FeedbackErrorEntry[]
  collectedAt: number
  collectorVersion: number
}

// ─── Attachments ─────────────────────────────────────────────────────────────

export type FeedbackAttachmentKind = "image" | "audio"

export interface FeedbackAttachmentRef {
  id: string
  kind: FeedbackAttachmentKind
  name: string
  mimeType: string
  size: number
  /** ImageKit URL for images; absent for audio (served via API). */
  url?: string
  durationSeconds?: number
}

// ─── Transcription ───────────────────────────────────────────────────────────

export interface FeedbackTranscription {
  status: "none" | "pending" | "done" | "failed"
  /** Original text as spoken/typed by the user — never discarded. */
  originalText?: string
  /** English rendering when translation succeeded or the input was English. */
  englishText?: string
  language?: string
  method: "browser_speech" | "manual" | "audio_upload"
  translatedAt?: number
  translationError?: string
}

// ─── Documents ───────────────────────────────────────────────────────────────

export interface FeedbackReportDoc {
  id: string
  /** Human-readable reference shown to users/admins, e.g. "FB-8F3K2Q". */
  reference: string
  userId: string
  category: FeedbackCategory
  /** Final description shown to admins (English when available). */
  description: string
  originalDescription?: string
  detectedLanguage?: string
  transcription: FeedbackTranscription
  attachments: FeedbackAttachmentRef[]
  diagnostics: FeedbackDiagnostics
  /** Stable fingerprint from the primary observed error, for recurrence matching. */
  fingerprint?: string
  /** Similar open reports suggested at submission time. */
  similarReportIds: string[]
  incidentId?: string
  severity: FeedbackSeverity
  /** Heuristic suggestion only — never authoritative. */
  suggestedSeverity?: FeedbackSeverity
  status: FeedbackStatus
  assigneeId?: string
  reward?: {
    amount: number
    approvedBy: string
    approvedAt: number
    note?: string
    ledgerEntryId?: string
  }
  createdAt: number
  updatedAt: number
  resolvedAt?: number
}

export type FeedbackCommentKind = "public" | "internal"

export interface FeedbackCommentDoc {
  id: string
  reportId: string
  authorId: string
  /** True when written by an admin — drives visibility for the report owner. */
  authorIsAdmin: boolean
  kind: FeedbackCommentKind
  body: string
  createdAt: number
}

export interface FeedbackIncidentDoc {
  id: string
  reference: string
  title: string
  description?: string
  severity: FeedbackSeverity
  status: "open" | "investigating" | "resolved" | "closed"
  reportIds: string[]
  createdBy: string
  assigneeId?: string
  resolution?: string
  createdAt: number
  updatedAt: number
  resolvedAt?: number
}

export interface FeedbackRewardDoc {
  id: string
  reportId: string
  userId: string
  amount: number
  approvedBy: string
  note?: string
  status: "approved" | "failed"
  ledgerEntryId?: string
  failureReason?: string
  createdAt: number
}

export interface FeedbackAttachmentDoc {
  id: string
  reportId?: string
  userId: string
  kind: FeedbackAttachmentKind
  fileName: string
  mimeType: string
  size: number
  data: Buffer
  durationSeconds?: number
  createdAt: number
  /** TTL index — recordings are diagnostic aids, not archives. */
  expiresAt: Date
}

export interface FeedbackSettingsDoc {
  id: "settings"
  enabled: boolean
  bugReportsEnabled: boolean
  cofounderShortcutEnabled: boolean
  voiceEnabled: boolean
  screenshotEnabled: boolean
  maxAudioSeconds: number
  maxAudioBytes: number
  maxAttachmentBytes: number
  rewardsEnabled: boolean
  rewardTiers: { id: string; label: string; credits: number }[]
  minReward: number
  maxReward: number
  /** Rewards above this amount require a second admin approval (when the
   * permission model supports it; enforced as a flag + audit note). */
  dualApprovalOver: number
  updatedAt: number
  updatedBy?: string
}

// ─── Public/API shapes ───────────────────────────────────────────────────────

export interface PublicFeedbackReport {
  id: string
  reference: string
  category: FeedbackCategory
  categoryLabel: string
  description: string
  status: FeedbackStatus
  statusLabel: string
  severity: FeedbackSeverity
  incidentId?: string
  attachments: { id: string; kind: FeedbackAttachmentKind; name: string; mimeType: string; size: number; durationSeconds?: number }[]
  createdAt: number
  updatedAt: number
  resolvedAt?: number
  /** User-visible admin responses only — internal notes never leave the server. */
  responses: { id: string; body: string; createdAt: number }[]
  reward?: { amount: number; note?: string; approvedAt: number }
}

export interface AdminFeedbackReport extends PublicFeedbackReport {
  userId: string
  userName?: string
  userEmail?: string
  originalDescription?: string
  detectedLanguage?: string
  transcription: FeedbackTranscription
  diagnostics: FeedbackDiagnostics
  fingerprint?: string
  similarReportIds: string[]
  similarReports?: { id: string; reference: string; status: FeedbackStatus; createdAt: number }[]
  assigneeId?: string
  createdAt: number
  internalNotes: { id: string; body: string; createdAt: number }[]
  auditHistory: { id: string; action: string; actorId: string; detail?: string; createdAt: number }[]
  rewardHistory: {
    id: string
    amount: number
    approvedBy: string
    status: "approved" | "failed"
    note?: string
    ledgerEntryId?: string
    failureReason?: string
    createdAt: number
  }[]
}
