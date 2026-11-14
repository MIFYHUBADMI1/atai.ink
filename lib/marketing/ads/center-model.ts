/**
 * Ads & Growth Center — pure view-model logic shared by the overview,
 * analytics, requests and campaign surfaces.
 *
 * NO network, DB, or environment access: everything here is deterministic and
 * unit-tested. Honesty rules baked in:
 *  - A metric with no reports is `not_recorded` (value null) — never a fake 0.
 *  - Totals sum the LATEST report per campaign per canonical metric, so a
 *    cumulative update recorded twice never double-counts.
 *  - Day series sum what was actually recorded each day.
 *  - Unknown metric names are never dropped; they surface as "other" reports.
 *  - Estimates, platform reports, manual entries and tracking stay labeled.
 */

import type { AdPerformanceSource, AdRequestStatus } from "@/lib/types/ads"

// ─── Canonical performance metrics ──────────────────────────────────────────

export const PERF_METRIC_KEYS = [
  "impressions",
  "reach",
  "clicks",
  "visits",
  "leads",
  "registrations",
  "customers",
  "revenue",
] as const

export type PerfMetricKey = (typeof PERF_METRIC_KEYS)[number]

export const PERF_METRIC_LABELS: Record<PerfMetricKey, string> = {
  impressions: "Impressions",
  reach: "Unique reach",
  clicks: "Website clicks",
  visits: "Website visits",
  leads: "Leads",
  registrations: "Registrations",
  customers: "Paying customers",
  revenue: "Revenue attributed",
}

export const PERF_METRIC_DEFINITIONS: Record<PerfMetricKey, string> = {
  impressions: "Ad impressions recorded by Atai's team while promoting your business.",
  reach: "Unique people the promotion reached, as recorded by the team.",
  clicks: "Clicks on the promoted links, as recorded by the team.",
  visits: "Visits to your site recorded from promotion results — not a site-analytics pixel.",
  leads: "Leads the team recorded from the promotion (forms, messages, inquiries).",
  registrations: "Signups the team recorded from the promotion.",
  customers: "Paying customers the team recorded from the promotion.",
  revenue: "Money the team attributed to the promotion. Never combined with credits.",
}

/** Money metrics render as currency; everything else is a plain count. */
export const MONEY_METRICS: readonly PerfMetricKey[] = ["revenue"]

const METRIC_ALIASES: Record<PerfMetricKey, readonly string[]> = {
  impressions: ["impressions", "impression", "ad impressions", "views served"],
  reach: ["reach", "unique reach", "people reached", "unique people"],
  clicks: ["clicks", "website clicks", "link clicks", "ad clicks"],
  visits: ["visits", "website visits", "site visits", "website sessions"],
  leads: ["leads", "new leads", "leads generated", "inquiries"],
  registrations: ["registrations", "registration", "signups", "sign-ups", "sign ups", "new registrations", "accounts created"],
  customers: ["customers", "paying customers", "new customers", "conversions", "purchases"],
  revenue: ["revenue", "revenue attributed", "attributed revenue", "sales revenue"],
}

const ALIAS_LOOKUP = new Map<string, PerfMetricKey>()
for (const key of PERF_METRIC_KEYS) {
  for (const alias of METRIC_ALIASES[key]) ALIAS_LOOKUP.set(alias, key)
}

/** Normalize a free-text admin metric name; null when it maps to nothing known. */
export function normalizePerfMetric(raw: string): PerfMetricKey | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, " ")
  return ALIAS_LOOKUP.get(cleaned) ?? null
}

// ─── Reports → totals ───────────────────────────────────────────────────────

export interface PerfReport {
  id: string
  requestId: string
  metric: string
  value: number
  source: AdPerformanceSource
  reportedAt: number
  note?: string
  evidenceUrl?: string
}

export type PerfTotalState = "measured" | "measured_zero" | "not_recorded"

export interface PerfTotal {
  key: PerfMetricKey
  label: string
  definition: string
  state: PerfTotalState
  /** Sum of the latest report per campaign; null when nothing was recorded. */
  value: number | null
  /** Sources behind the latest reports (mixed when campaigns differ). */
  sources: AdPerformanceSource[]
  /** How many campaigns contributed a latest report. */
  campaigns: number
  unit: "count" | "money"
}

export interface PerfAggregation {
  totals: Record<PerfMetricKey, PerfTotal>
  /** Reports whose metric name maps to no canonical key — never hidden. */
  other: PerfReport[]
}

function emptyTotal(key: PerfMetricKey): PerfTotal {
  return {
    key,
    label: PERF_METRIC_LABELS[key],
    definition: PERF_METRIC_DEFINITIONS[key],
    state: "not_recorded",
    value: null,
    sources: [],
    campaigns: 0,
    unit: MONEY_METRICS.includes(key) ? "money" : "count",
  }
}

/**
 * Latest report per (campaign, canonical metric) wins; totals sum those latest
 * values across campaigns. This is the honest reading of repeated cumulative
 * updates: the newest report replaces the older one for the same campaign.
 */
export function aggregatePerformance(reports: readonly PerfReport[]): PerfAggregation {
  const totals = Object.fromEntries(PERF_METRIC_KEYS.map((key) => [key, emptyTotal(key)])) as Record<PerfMetricKey, PerfTotal>
  const latest = new Map<string, PerfReport>()
  const other: PerfReport[] = []

  for (const report of reports) {
    const key = normalizePerfMetric(report.metric)
    if (!key) {
      other.push(report)
      continue
    }
    const slot = `${report.requestId}:${key}`
    const current = latest.get(slot)
    if (!current || report.reportedAt >= current.reportedAt) latest.set(slot, report)
  }

  const sourcesByKey = new Map<PerfMetricKey, Set<AdPerformanceSource>>()
  const campaignsByKey = new Map<PerfMetricKey, Set<string>>()
  const sums = new Map<PerfMetricKey, number>()
  for (const report of latest.values()) {
    const key = normalizePerfMetric(report.metric)
    if (!key) continue
    sums.set(key, (sums.get(key) ?? 0) + report.value)
    if (!sourcesByKey.has(key)) sourcesByKey.set(key, new Set())
    sourcesByKey.get(key)!.add(report.source)
    if (!campaignsByKey.has(key)) campaignsByKey.set(key, new Set())
    campaignsByKey.get(key)!.add(report.requestId)
  }

  for (const key of PERF_METRIC_KEYS) {
    if (!sums.has(key)) continue
    const value = sums.get(key)!
    totals[key] = {
      ...emptyTotal(key),
      state: value === 0 ? "measured_zero" : "measured",
      value,
      sources: [...(sourcesByKey.get(key) ?? [])],
      campaigns: campaignsByKey.get(key)?.size ?? 0,
    }
  }

  other.sort((a, b) => b.reportedAt - a.reportedAt)
  return { totals, other }
}

// ─── Day series ─────────────────────────────────────────────────────────────

export const DAY_MS = 24 * 60 * 60 * 1000

export interface DayPoint {
  /** UTC start-of-day epoch ms. */
  day: number
  value: number
}

export function dayStart(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS
}

/**
 * Sum of the values RECORDED on each day of the window (zero-filled). This is
 * "what the team recorded that day", not a cumulative curve — the label on the
 * chart must say so.
 */
export function dailyRecordedSeries(
  reports: readonly PerfReport[],
  key: PerfMetricKey,
  window: { from: number; to: number },
): DayPoint[] {
  const first = dayStart(window.from)
  const last = dayStart(window.to)
  const buckets = new Map<number, number>()
  for (let day = first; day <= last; day += DAY_MS) buckets.set(day, 0)
  for (const report of reports) {
    if (normalizePerfMetric(report.metric) !== key) continue
    if (report.reportedAt < window.from || report.reportedAt > window.to) continue
    const day = dayStart(report.reportedAt)
    if (!buckets.has(day)) continue
    buckets.set(day, (buckets.get(day) ?? 0) + report.value)
  }
  return [...buckets.entries()].map(([day, value]) => ({ day, value }))
}

/** True when a series carries at least one non-zero point worth drawing. */
export function seriesHasSignal(points: readonly DayPoint[]): boolean {
  return points.some((point) => point.value !== 0)
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

export const FUNNEL_KEYS: readonly PerfMetricKey[] = ["impressions", "clicks", "visits", "registrations", "customers"]

export interface FunnelStage {
  key: PerfMetricKey
  label: string
  state: PerfTotalState
  value: number | null
  /** Share of the previous measured stage, when both sides are measured. */
  conversionFromPrev: number | null
}

export function buildFunnel(totals: Record<PerfMetricKey, PerfTotal>): FunnelStage[] {
  const stages: FunnelStage[] = []
  let prevMeasured: number | null = null
  for (const key of FUNNEL_KEYS) {
    const total = totals[key]
    const measured = total.state !== "not_recorded"
    const value = measured ? (total.value ?? 0) : null
    const conversion =
      measured && prevMeasured !== null && prevMeasured > 0 ? Math.min(1, (value ?? 0) / prevMeasured) : null
    stages.push({ key, label: PERF_METRIC_LABELS[key], state: total.state, value, conversionFromPrev: conversion })
    if (measured) prevMeasured = value
  }
  return stages
}

// ─── Growth strategy tracker ────────────────────────────────────────────────

export type StrategyStageState = "complete" | "in_progress" | "upcoming"

export interface StrategyStage {
  id: "audience" | "channels" | "materials" | "launch"
  title: string
  detail: string
  state: StrategyStageState
}

/** Four observed-state stages — suggestions, never claims of executed work. */
export function deriveStrategyStages(input: {
  hasAudience: boolean
  hasChannels: boolean
  hasStrategy: boolean
  creativeCount: number
  activeCampaigns: number
  activeRequests: number
  finishedCampaigns: number
  finishedRequests: number
}): StrategyStage[] {
  const materials: StrategyStageState =
    input.creativeCount > 0 ? "complete" : input.hasStrategy ? "in_progress" : "upcoming"
  const launch: StrategyStageState =
    input.finishedCampaigns + input.finishedRequests > 0
      ? "complete"
      : input.activeCampaigns + input.activeRequests > 0
        ? "in_progress"
        : "upcoming"
  return [
    {
      id: "audience",
      title: "Define your audience",
      detail: input.hasAudience
        ? "Your ideal customer is written down — every draft starts from it."
        : "Describe who you are reaching in your strategy or plan.",
      state: input.hasAudience ? "complete" : "upcoming",
    },
    {
      id: "channels",
      title: "Choose marketing channels",
      detail: input.hasChannels
        ? "Preferred channels are saved in your strategy."
        : "Pick the channels where your customers actually are.",
      state: input.hasChannels ? "complete" : "upcoming",
    },
    {
      id: "materials",
      title: "Create advertising materials",
      detail:
        input.creativeCount > 0
          ? `${input.creativeCount} ad draft${input.creativeCount === 1 ? "" : "s"} in your library.`
          : "Draft copy and creatives on the Ad bench or in the Studio.",
      state: materials,
    },
    {
      id: "launch",
      title: "Launch and measure",
      detail:
        launch === "complete"
          ? "A campaign or promotion has finished — recorded results live in Analytics."
          : launch === "in_progress"
            ? "A campaign or promotion is running. Results appear as the team records them."
            : "Start a campaign plan or request Atai promotion when you are ready.",
      state: launch,
    },
  ]
}

// ─── Request lifecycle ──────────────────────────────────────────────────────

export const LIFECYCLE_STAGES = [
  { id: "submitted", label: "Request submitted" },
  { id: "under_review", label: "Under review" },
  { id: "proposal_prepared", label: "Proposal prepared" },
  { id: "awaiting_approval", label: "Awaiting your approval" },
  { id: "payment_confirmed", label: "Payment confirmed" },
  { id: "scheduled", label: "Campaign scheduled" },
  { id: "in_progress", label: "Promotion in progress" },
  { id: "completed", label: "Campaign completed" },
] as const

export type LifecycleSide = "none" | "needs_info" | "paused" | "rejected" | "cancelled" | "refunded"

export interface LifecyclePosition {
  /** Index of the current stage; LIFECYCLE_STAGES.length means all complete; -1 = terminal side state. */
  index: number
  side: LifecycleSide
}

export function lifecyclePosition(status: AdRequestStatus): LifecyclePosition {
  switch (status) {
    case "submitted":
      return { index: 0, side: "none" }
    case "under_review":
      return { index: 1, side: "none" }
    case "needs_info":
      return { index: 1, side: "needs_info" }
    case "proposal_prepared":
      return { index: 2, side: "none" }
    case "awaiting_approval":
      return { index: 3, side: "none" }
    case "awaiting_payment":
      return { index: 4, side: "none" }
    case "approved":
      return { index: 5, side: "none" }
    case "scheduled":
      return { index: 5, side: "none" }
    case "in_progress":
      return { index: 6, side: "none" }
    case "paused":
      return { index: 6, side: "paused" }
    case "completed":
      return { index: LIFECYCLE_STAGES.length, side: "none" }
    case "rejected":
      return { index: -1, side: "rejected" }
    case "cancelled":
      return { index: -1, side: "cancelled" }
    case "refunded":
      return { index: -1, side: "refunded" }
  }
}

/** Statuses that count as "running" for the overview tracker. */
export const ACTIVE_REQUEST_STATUSES: readonly AdRequestStatus[] = ["approved", "scheduled", "in_progress", "paused"]
export const FINISHED_REQUEST_STATUSES: readonly AdRequestStatus[] = ["completed"]

export type RequestStatusGroup = "needs_action" | "in_review" | "running" | "completed" | "closed"

/** Coarse grouping for badges and the requests filter — derived only from status. */
export function requestStatusGroup(status: AdRequestStatus): RequestStatusGroup {
  switch (status) {
    case "awaiting_approval":
    case "awaiting_payment":
    case "needs_info":
      return "needs_action"
    case "submitted":
    case "under_review":
    case "proposal_prepared":
      return "in_review"
    case "approved":
    case "scheduled":
    case "in_progress":
    case "paused":
      return "running"
    case "completed":
      return "completed"
    case "rejected":
    case "cancelled":
    case "refunded":
      return "closed"
  }
}

export const REQUEST_GROUP_LABELS: Record<RequestStatusGroup, string> = {
  needs_action: "Needs your action",
  in_review: "In review",
  running: "Running",
  completed: "Completed",
  closed: "Closed",
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export type CampaignChannelLike = "email" | "social" | "content" | "seo" | "referral" | "other"
export type CampaignStatusLike = "draft" | "active" | "paused" | "completed" | "cancelled"

export interface CampaignSummary {
  total: number
  active: number
  pending: number
  completed: number
}

export function summarizeCampaigns(campaigns: readonly { status: CampaignStatusLike }[]): CampaignSummary {
  let active = 0
  let pending = 0
  let completed = 0
  for (const campaign of campaigns) {
    if (campaign.status === "active") active += 1
    else if (campaign.status === "draft" || campaign.status === "paused") pending += 1
    else if (campaign.status === "completed") completed += 1
  }
  return { total: campaigns.length, active, pending, completed }
}

const SOCIAL_HINTS = ["facebook", "instagram", "tiktok", "twitter", "x (", "linkedin", "youtube", "social", "threads", "pinterest"]

/** Map free-text strategy channels onto the campaign plan's channel enum. */
export function mapStrategyChannels(channels: readonly string[]): CampaignChannelLike[] {
  const out: CampaignChannelLike[] = []
  for (const raw of channels) {
    const value = raw.trim().toLowerCase()
    if (!value) continue
    let mapped: CampaignChannelLike = "other"
    if (SOCIAL_HINTS.some((hint) => value.includes(hint))) mapped = "social"
    else if (value.includes("email") || value.includes("newsletter")) mapped = "email"
    else if (value.includes("seo") || value.includes("search")) mapped = "seo"
    else if (value.includes("content") || value.includes("blog")) mapped = "content"
    else if (value.includes("referral")) mapped = "referral"
    if (!out.includes(mapped)) out.push(mapped)
    if (out.length >= 6) break
  }
  return out
}

/** A campaign plan name derived from the founder's own strategy words. */
export function campaignNameFromStrategy(input: { objectives: readonly string[]; positioning: string }): string {
  const objective = input.objectives.find((line) => line.trim().length >= 3)?.trim()
  const base = objective || input.positioning.trim() || "Growth campaign from my strategy"
  const collapsed = base.replace(/\s+/g, " ")
  const named = collapsed.length >= 3 ? collapsed : "Growth campaign from my strategy"
  return named.length > 120 ? `${named.slice(0, 119).trimEnd()}…` : named
}

// ─── Formatting helpers (deterministic, locale-stable) ─────────────────────

export function formatPerfValue(value: number, unit: "count" | "money"): string {
  if (unit === "money") {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
  }
  return value.toLocaleString("en-US")
}

export function formatDayLabel(day: number): string {
  return new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}
