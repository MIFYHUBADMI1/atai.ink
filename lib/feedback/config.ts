import type { FeedbackCategory, FeedbackSeverity, FeedbackStatus } from "./types"
import { FEEDBACK_CATEGORIES, FEEDBACK_SEVERITIES, FEEDBACK_STATUSES } from "./types"

export function isFeedbackCategory(value: string): value is FeedbackCategory {
  return FEEDBACK_CATEGORIES.some((c) => c.id === value)
}

export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(value)
}

export function isFeedbackSeverity(value: string): value is FeedbackSeverity {
  return (FEEDBACK_SEVERITIES as readonly string[]).includes(value)
}

export function categoryLabel(id: string): string {
  return FEEDBACK_CATEGORIES.find((c) => c.id === id)?.label ?? "Other"
}

/**
 * Allowed status transitions. "duplicate" and "rejected" are terminal-ish
 * (a duplicate may be re-opened by an admin who disagrees); "verified" is the
 * gate for reward approval — verification and reward approval stay separate
 * decisions per the contributor programme rules.
 */
export const FEEDBACK_STATUS_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  new: ["reviewing", "verified", "rejected", "duplicate"],
  reviewing: ["verified", "in_progress", "rejected", "duplicate", "new"],
  verified: ["in_progress", "resolved", "rejected"],
  in_progress: ["resolved", "verified", "rejected"],
  resolved: ["in_progress", "reviewing"],
  rejected: ["reviewing", "new"],
  duplicate: ["reviewing", "new"],
}

export function canTransitionStatus(from: FeedbackStatus, to: FeedbackStatus): boolean {
  return FEEDBACK_STATUS_TRANSITIONS[from].includes(to)
}

/** Statuses from which a reward may be approved. */
export const REWARDABLE_STATUSES: readonly FeedbackStatus[] = ["verified", "in_progress", "resolved"]

export function isRewardableStatus(status: FeedbackStatus): boolean {
  return REWARDABLE_STATUSES.includes(status)
}

/**
 * Heuristic provisional severity suggestion. This is ONLY a triage hint shown
 * to admins — it never marks a report verified and never triggers rewards.
 */
export function suggestSeverity(input: {
  category: FeedbackCategory
  description: string
  hasSecuritySignal?: boolean
}): FeedbackSeverity {
  if (input.hasSecuritySignal || input.category === "security") return "P0"
  const text = input.description.toLowerCase()
  const outage = /(outage|down|crash|cannot log ?in|can'?t log ?in|payment|charged|lost data|data loss|exposed|breach|leak)/.test(text)
  if (outage) return "P1"
  if (input.category === "page_load" || input.category === "error") return "P2"
  if (input.category === "performance") return "P3"
  if (input.category === "improvement") return "P4"
  return "P3"
}

/** Token overlap for similar-report suggestions (mirrors feature-requests). */
export function feedbackTextScore(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap += 1
  return overlap / Math.max(ta.size, tb.size)
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  )
}

/** djb2-style hash → stable short fingerprint for error grouping. */
export function fingerprintText(value: string): string {
  let h = 5381
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h + value.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
