import "server-only"

/**
 * Performance Analytics for the Ads & Growth Center.
 *
 * Reads ONLY data the platform already holds:
 *  - `ad_campaign_performance` — results Atai's team recorded while manually
 *    executing approved promotions (each row carries its source: manual,
 *    platform, estimated, tracking).
 *  - `ad_campaign_requests` — the promotion campaigns themselves.
 *  - `runtime_usage` — real API request counts, kept strictly separate from
 *    promotion results (runtime requests are NOT visitors).
 *
 * Nothing is fabricated: a metric with no reports renders as "not recorded",
 * never as zero. Totals use the latest report per campaign (see center-model),
 * the day series sums what was recorded each day, and unknown metric names are
 * surfaced rather than dropped. Reading is free — no credits are charged.
 *
 * Ownership is the caller's responsibility (requireOwnedProject on the page).
 */

import { listAdRequests } from "@/lib/marketing/ads/requests"
import { listProjectPerformance } from "@/lib/marketing/ads/operations"
import { logger } from "@/lib/logging/logger"
import { clampRange, summarizeProjectUsage } from "@/lib/runtime/control/analytics"
import type { AdCampaignRequestDoc, AdPerformanceSource } from "@/lib/types/ads"
import {
  aggregatePerformance,
  buildFunnel,
  dailyRecordedSeries,
  PERF_METRIC_KEYS,
  PERF_METRIC_LABELS,
  seriesHasSignal,
  type DayPoint,
  type FunnelStage,
  type PerfAggregation,
  type PerfMetricKey,
  type PerfReport,
} from "./center-model"

export const ANALYTICS_RANGES = [7, 30, 90] as const
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return ANALYTICS_RANGES.includes(value as AnalyticsRange)
}

export interface AnalyticsCampaignRow {
  id: string
  name: string
  status: AdCampaignRequestDoc["status"]
  objective: string
  submittedAt: number
  /** Per-campaign aggregation of the windowed reports. */
  totals: PerfAggregation["totals"]
  otherCount: number
  lastReportAt: number | null
  estimatedImpressionsMin?: number
  estimatedImpressionsMax?: number
  proposalCredits: number | null
}

export interface AnalyticsSeries {
  key: PerfMetricKey
  label: string
  points: DayPoint[]
}

export interface AdsAnalytics {
  projectId: string
  generatedAt: number
  rangeDays: AnalyticsRange
  window: { from: number; to: number }
  /** When set, every aggregation is scoped to this one promotion request. */
  requestId: string | null
  campaigns: AnalyticsCampaignRow[]
  /** Every promotion request, for the campaign filter — unscoped by requestId. */
  campaignOptions: { id: string; name: string; status: AdCampaignRequestDoc["status"] }[]
  totals: PerfAggregation["totals"]
  other: PerfReport[]
  series: AnalyticsSeries[]
  funnel: FunnelStage[]
  sourceCounts: Record<AdPerformanceSource, number>
  runtimeRequests: { state: "available" | "measured_zero" | "unavailable"; value: number | null }
  performanceRead: "ok" | "failed"
  requestsRead: "ok" | "failed"
  hasAnyReports: boolean
}

const SERIES_KEYS: readonly PerfMetricKey[] = ["impressions", "clicks", "visits", "leads"]

function toReport(doc: {
  id: string
  requestId: string
  metric: string
  value: number
  source: AdPerformanceSource
  reportedAt: number
  note: string
  evidenceUrl: string
}): PerfReport {
  return {
    id: doc.id,
    requestId: doc.requestId,
    metric: doc.metric,
    value: doc.value,
    source: doc.source,
    reportedAt: doc.reportedAt,
    note: doc.note,
    evidenceUrl: doc.evidenceUrl,
  }
}

export async function getAdsAnalytics(input: {
  projectId: string
  rangeDays?: AnalyticsRange
  requestId?: string | null
}): Promise<AdsAnalytics> {
  const rangeDays = input.rangeDays ?? 30
  const now = Date.now()
  const window = clampRange(now - rangeDays * 24 * 60 * 60 * 1000, now)
  const requestId = input.requestId ?? null

  let requests: AdCampaignRequestDoc[] = []
  let requestsRead: "ok" | "failed" = "ok"
  try {
    requests = await listAdRequests(input.projectId, { limit: 100 })
  } catch (e) {
    requestsRead = "failed"
    logger.warn("marketing.adsAnalytics", "request read failed", {
      projectId: input.projectId,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  let docs: Awaited<ReturnType<typeof listProjectPerformance>> = []
  let performanceRead: "ok" | "failed" = "ok"
  try {
    docs = await listProjectPerformance(input.projectId, {
      ...(requestId ? { requestId } : {}),
      from: window.from,
      to: window.to,
      limit: 1000,
    })
  } catch (e) {
    performanceRead = "failed"
    logger.warn("marketing.adsAnalytics", "performance read failed", {
      projectId: input.projectId,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  const reports = docs.map(toReport)
  const aggregation = aggregatePerformance(reports)

  const sourceCounts: Record<AdPerformanceSource, number> = { manual: 0, platform: 0, estimated: 0, tracking: 0 }
  for (const report of reports) sourceCounts[report.source] += 1

  const campaigns: AnalyticsCampaignRow[] = requests
    .filter((request) => !requestId || request.id === requestId)
    .map((request) => {
      const own = reports.filter((report) => report.requestId === request.id)
      const ownAggregation = aggregatePerformance(own)
      const lastReportAt = own.length > 0 ? Math.max(...own.map((r) => r.reportedAt)) : null
      return {
        id: request.id,
        name: request.business.name,
        status: request.status,
        objective: request.preferences.objective || request.promote.goals[0] || "",
        submittedAt: request.submittedAt,
        totals: ownAggregation.totals,
        otherCount: ownAggregation.other.length,
        lastReportAt,
        ...(request.proposal?.estimatedImpressionsMin !== undefined
          ? { estimatedImpressionsMin: request.proposal.estimatedImpressionsMin }
          : {}),
        ...(request.proposal?.estimatedImpressionsMax !== undefined
          ? { estimatedImpressionsMax: request.proposal.estimatedImpressionsMax }
          : {}),
        proposalCredits: request.proposal?.creditsPrice ?? null,
      }
    })

  const series: AnalyticsSeries[] = SERIES_KEYS.map((key) => ({
    key,
    label: PERF_METRIC_LABELS[key],
    points: dailyRecordedSeries(reports, key, window),
  })).filter((entry) => seriesHasSignal(entry.points))

  // Any canonical metric with signal beyond the four charted ones still gets a
  // series so nothing measured is hidden from the trend card.
  for (const key of PERF_METRIC_KEYS) {
    if (SERIES_KEYS.includes(key)) continue
    const points = dailyRecordedSeries(reports, key, window)
    if (seriesHasSignal(points)) series.push({ key, label: PERF_METRIC_LABELS[key], points })
  }

  let runtimeRequests: AdsAnalytics["runtimeRequests"] = { state: "unavailable", value: null }
  try {
    const summary = await summarizeProjectUsage(input.projectId, window)
    runtimeRequests = {
      state: summary.requests === 0 ? "measured_zero" : "available",
      value: summary.requests,
    }
  } catch (e) {
    logger.warn("marketing.adsAnalytics", "runtime usage read failed", {
      projectId: input.projectId,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  return {
    projectId: input.projectId,
    generatedAt: now,
    rangeDays,
    window,
    requestId,
    campaigns,
    campaignOptions: requests.map((request) => ({
      id: request.id,
      name: request.business.name,
      status: request.status,
    })),
    totals: aggregation.totals,
    other: aggregation.other,
    series,
    funnel: buildFunnel(aggregation.totals),
    sourceCounts,
    runtimeRequests,
    performanceRead,
    requestsRead,
    hasAnyReports: reports.length > 0,
  }
}
