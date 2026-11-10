/**
 * Pure advertising-request rules. Safe for unit tests — no Mongo, no billing.
 */

import {
  canTransitionAdRequest,
  type AdCampaignProposal,
  type AdCampaignProposalLine,
  type AdRequestStatus,
} from "@/lib/types/ads"

export const PROPOSAL_BOUNDS = {
  title: 160,
  description: 4000,
  listItem: 200,
  listItems: 16,
  audience: 800,
  creativeScope: 1500,
  duration: 160,
  frequency: 160,
  estimateNote: 800,
  date: 40,
  creditsPrice: 1_000_000,
  conditions: 4000,
  customerInstructions: 4000,
} as const

export const DEFAULT_ESTIMATE_NOTE =
  "These impression ranges are planning estimates based on the selected package and audience, not guaranteed delivery. They are not customers, clicks, or sales."

export function assertTransition(from: AdRequestStatus, to: AdRequestStatus): void {
  if (!canTransitionAdRequest(from, to)) {
    throw new Error(`Cannot move a campaign from ${from} to ${to}.`)
  }
}

export function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const n = Math.round(value)
  if (n < min || n > max) return undefined
  return n
}

export function bounded(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

export function boundedList(value: unknown, maxItems: number, maxChars: number): string[] {
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

export interface ProposalDraftInput {
  title?: unknown
  description?: unknown
  objectives?: unknown
  audience?: unknown
  platforms?: unknown
  formats?: unknown
  creativeScope?: unknown
  duration?: unknown
  frequency?: unknown
  deliverables?: unknown
  estimatedImpressionsMin?: unknown
  estimatedImpressionsMax?: unknown
  estimateNote?: unknown
  startDate?: unknown
  endDate?: unknown
  creditsPrice?: unknown
  breakdown?: unknown
  conditions?: unknown
  customerInstructions?: unknown
  packageId?: unknown
  expiresAt?: unknown
}

export function normalizeProposalDraft(input: ProposalDraftInput): Omit<
  AdCampaignProposal,
  "version" | "issuedAt" | "issuedByAdminId"
> {
  const b = PROPOSAL_BOUNDS
  const title = bounded(input.title, b.title)
  const creditsPrice = clampInt(input.creditsPrice, 1, b.creditsPrice)
  if (!title || creditsPrice == null) {
    throw new Error("A proposal needs a title and a price in Atai Credits.")
  }

  const min = clampInt(input.estimatedImpressionsMin, 0, 100_000_000)
  const max = clampInt(input.estimatedImpressionsMax, 0, 100_000_000)
  if (min != null && max != null && max < min) {
    throw new Error("Estimated impression maximum cannot be below the minimum.")
  }

  const breakdown: AdCampaignProposalLine[] = []
  if (Array.isArray(input.breakdown)) {
    for (const row of input.breakdown) {
      if (!row || typeof row !== "object") continue
      const label = bounded((row as { label?: unknown }).label, 120)
      const credits = clampInt((row as { credits?: unknown }).credits, 0, b.creditsPrice)
      if (!label || credits == null) continue
      breakdown.push({ label, credits })
      if (breakdown.length >= 20) break
    }
  }

  const expiresAt = clampInt(input.expiresAt, Date.now(), Date.now() + 1000 * 60 * 60 * 24 * 365)

  return {
    title,
    description: bounded(input.description, b.description),
    objectives: boundedList(input.objectives, b.listItems, b.listItem),
    audience: bounded(input.audience, b.audience),
    platforms: boundedList(input.platforms, b.listItems, b.listItem),
    formats: boundedList(input.formats, b.listItems, b.listItem),
    creativeScope: bounded(input.creativeScope, b.creativeScope),
    duration: bounded(input.duration, b.duration),
    frequency: bounded(input.frequency, b.frequency),
    deliverables: boundedList(input.deliverables, b.listItems, b.listItem),
    ...(min != null ? { estimatedImpressionsMin: min } : {}),
    ...(max != null ? { estimatedImpressionsMax: max } : {}),
    estimateNote: bounded(input.estimateNote, b.estimateNote) || DEFAULT_ESTIMATE_NOTE,
    startDate: bounded(input.startDate, b.date),
    endDate: bounded(input.endDate, b.date),
    creditsPrice,
    breakdown,
    conditions: bounded(input.conditions, b.conditions),
    customerInstructions: bounded(input.customerInstructions, b.customerInstructions),
    ...(typeof input.packageId === "string" && input.packageId.trim()
      ? { packageId: input.packageId.trim().slice(0, 80) }
      : {}),
    ...(expiresAt != null ? { expiresAt } : {}),
  }
}

export function proposalIsExpired(proposal: Pick<AdCampaignProposal, "expiresAt">, now = Date.now()): boolean {
  return typeof proposal.expiresAt === "number" && proposal.expiresAt > 0 && now > proposal.expiresAt
}

/** Founder-visible event actions. Internal notes never use these. */
export const FOUNDER_EVENT_ACTIONS = new Set([
  "submitted",
  "status_changed",
  "info_requested",
  "founder_replied",
  "proposal_issued",
  "proposal_accepted",
  "proposal_declined",
  "payment_succeeded",
  "payment_failed",
  "refunded",
  "cancelled",
  "rejected",
  "message",
])
