import "server-only"

/**
 * Growth Overview dashboard view model for the Ads & Growth Center.
 *
 * Assembles the brief's §3 dashboard from data the platform already holds:
 *  - business context (project + deployment + plan target users),
 *  - four honest KPI cards fed by recorded promotion results (analytics),
 *  - a four-stage strategy tracker derived from observed workspace state,
 *  - the newest AI strategy recommendation (or a rule-based next step),
 *  - recent campaign plans and recent ad creatives.
 *
 * Every KPI is a real measured value, a real measured zero, or "not recorded"
 * with the reason — never a fabricated sample figure. Reading is free.
 * Ownership is the caller's responsibility (requireOwnedProject on the page).
 */

import { getGrowthOverview, type GrowthOverview } from "@/lib/marketing/growth-overview"
import { getAdsAnalytics, type AnalyticsSeries } from "@/lib/marketing/ads/analytics"
import { getAdStrategy } from "@/lib/marketing/ads/strategy"
import { ADS_STRATEGY_SLOT } from "@/lib/marketing/ads/strategy-content"
import { listAdsKitDrafts, type AdsKitDraftView } from "@/lib/marketing/studio/ads-kit"
import { adsKitSlotById } from "@/lib/marketing/studio/ads-kit-content"
import { GUIDE_CHANNELS } from "@/lib/marketing/ads/beginner-guide"
import { listCampaigns } from "@/lib/marketing/campaigns/service"
import { listAdRequests } from "@/lib/marketing/ads/requests"
import { logger } from "@/lib/logging/logger"
import type { MirrorProject } from "@/lib/types/project"
import type { UserDoc } from "@/lib/types/db"
import type { ApplicationSpecification } from "@/lib/types/specification"
import {
  ACTIVE_REQUEST_STATUSES,
  deriveStrategyStages,
  seriesHasSignal,
  type DayPoint,
  type PerfMetricKey,
  type StrategyStage,
} from "./center-model"
import type { AdPerformanceSource } from "@/lib/types/ads"
import type { CampaignStatus } from "@/lib/types/db"

export interface GrowthCenterKpi {
  id: string
  label: string
  definition: string
  state: "measured" | "measured_zero" | "not_recorded"
  value: number | null
  unit: "count" | "money"
  sources: AdPerformanceSource[]
  /** Daily recorded series; empty when nothing was recorded. */
  series: DayPoint[]
  /** Why the number is absent, shown on the empty card. */
  reason?: string
}

export interface GrowthCenterCreative {
  id: string
  title: string
  kind: string
  kitSlot?: string
  platformLabel: string
  hasMedia: boolean
  createdAt: number
}

export interface GrowthCenterCampaign {
  id: string
  name: string
  status: CampaignStatus
  channels: string[]
  startDate: number | null
  endDate: number | null
}

export interface GrowthCenterRecommendation {
  kind: "ai" | "rule"
  title: string
  body: string
  createdAt?: number
}

export interface GrowthCenterOverview {
  business: {
    name: string
    url: string | null
    live: boolean
    stateLabel: string
    description: string
    audience: string[]
  }
  kpis: GrowthCenterKpi[]
  stages: StrategyStage[]
  recommendation: GrowthCenterRecommendation | null
  campaigns: GrowthCenterCampaign[]
  creatives: GrowthCenterCreative[]
  promotion: { active: number; awaitingApproval: number; total: number }
  window: { from: number; to: number }
  /** Recorded-per-day trend series for the Campaign Performance chart. */
  trend: AnalyticsSeries[]
  analyticsRead: "ok" | "failed"
}

const CHANNEL_LABELS = new Map(GUIDE_CHANNELS.map((channel) => [channel.id as string, channel.label]))

function platformLabelFor(draft: AdsKitDraftView): string {
  if (!draft.kitSlot) return "Ad draft"
  const slot = adsKitSlotById(draft.kitSlot)
  if (!slot) return "Ad draft"
  const first = slot.channelIds[0]
  return (first && CHANNEL_LABELS.get(first)) || slot.label
}

function kpiFrom(input: {
  id: string
  label: string
  definition: string
  key: PerfMetricKey
  analytics: Awaited<ReturnType<typeof getAdsAnalytics>>
  reason: string
}): GrowthCenterKpi {
  const total = input.analytics.totals[input.key]
  const seriesEntry = input.analytics.series.find((entry) => entry.key === input.key)
  const series = seriesEntry?.points ?? []
  return {
    id: input.id,
    label: input.label,
    definition: input.definition,
    state: total.state,
    value: total.value,
    unit: total.unit,
    sources: total.sources,
    series: seriesHasSignal(series) ? series : [],
    ...(total.state === "not_recorded" ? { reason: input.reason } : {}),
  }
}

export async function getGrowthCenterOverview(input: {
  user: Pick<UserDoc, "id"> & { onboarding?: UserDoc["onboarding"]; featurePreferences?: UserDoc["featurePreferences"] }
  project: MirrorProject
}): Promise<GrowthCenterOverview> {
  const { user, project } = input
  const spec = project.specification as ApplicationSpecification | undefined

  const [growth, analytics, strategy, campaigns, requests, creatives] = await Promise.all([
    getGrowthOverview({ user, project }).catch(() => null),
    getAdsAnalytics({ projectId: project.id, rangeDays: 30 }).catch((e) => {
      logger.warn("marketing.growthCenter", "analytics read failed", {
        projectId: project.id,
        message: e instanceof Error ? e.message : String(e),
      })
      return null
    }),
    getAdStrategy(project.id).catch(() => null),
    listCampaigns(project.id, { limit: 5 }).catch(() => []),
    listAdRequests(project.id, { limit: 100 }).catch(() => []),
    listAdsKitDrafts(project.id, { limit: 6 }).catch(() => []),
  ])

  const audience = (spec?.targetUsers ?? []).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
  const liveUrl = growth?.site.url ?? (project.deployment?.status === "success" ? project.deployment?.productionUrl ?? null : null)

  const kpis: GrowthCenterKpi[] = analytics
    ? [
        kpiFrom({
          id: "reach",
          label: "Campaign reach",
          definition: "Impressions recorded by Atai's team while promoting your business.",
          key: analytics.totals.impressions.state !== "not_recorded" ? "impressions" : "reach",
          analytics,
          reason: "No promotion results recorded yet. Reach appears here once Atai's team records impressions from a live campaign.",
        }),
        kpiFrom({
          id: "visits",
          label: "Website visits",
          definition: "Visits recorded from promotion results — not a site-analytics pixel.",
          key: "visits",
          analytics,
          reason: "Atai does not run a visitor-analytics pixel yet. Visits appear here when the team records them from a promotion.",
        }),
        kpiFrom({
          id: "leads",
          label: "New leads",
          definition: "Leads the team recorded from your promotions (forms, messages, inquiries).",
          key: "leads",
          analytics,
          reason: "No leads recorded yet. They appear here as the team logs results from a live campaign.",
        }),
        kpiFrom({
          id: "conversions",
          label: "Conversions",
          definition: "Paying customers the team recorded from your promotions.",
          key: "customers",
          analytics,
          reason: "No conversions recorded yet. Recorded customers appear here — never estimated from unrelated signals.",
        }),
      ]
    : []

  const activeRequests = requests.filter((request) => ACTIVE_REQUEST_STATUSES.includes(request.status)).length
  const awaitingApproval = requests.filter((request) => request.status === "awaiting_approval" || request.status === "awaiting_payment").length
  const finishedRequests = requests.filter((request) => request.status === "completed").length

  const stages = deriveStrategyStages({
    hasAudience: Boolean(strategy?.icp?.trim()) || audience.length > 0,
    hasChannels: (strategy?.channels?.length ?? 0) > 0,
    hasStrategy: Boolean(strategy),
    creativeCount: creatives.length,
    activeCampaigns: campaigns.filter((campaign) => campaign.status === "active" || campaign.status === "paused").length,
    activeRequests,
    finishedCampaigns: campaigns.filter((campaign) => campaign.status === "completed").length,
    finishedRequests,
  })

  let recommendation: GrowthCenterRecommendation | null = null
  const latestRecommendation = creatives.find((draft) => draft.kitSlot === ADS_STRATEGY_SLOT)
  if (latestRecommendation) {
    recommendation = {
      kind: "ai",
      title: latestRecommendation.title,
      body: latestRecommendation.body,
      createdAt: latestRecommendation.createdAt,
    }
  } else if (growth && growth.measurement === "runtime" && growth.nextSteps.length > 0) {
    recommendation = { kind: "rule", title: growth.nextSteps[0].title, body: growth.nextSteps[0].detail }
  }

  return {
    business: {
      name: project.name,
      url: liveUrl ?? null,
      live: growth?.site.state === "live" || project.deployment?.status === "success",
      stateLabel: growth?.projectStateLabel ?? project.state,
      description: (spec?.description ?? project.idea ?? "").trim(),
      audience,
    },
    kpis,
    stages,
    recommendation,
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      channels: campaign.channels,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
    })),
    creatives: creatives.slice(0, 3).map((draft) => ({
      id: draft.id,
      title: draft.title,
      kind: draft.kind,
      ...(draft.kitSlot ? { kitSlot: draft.kitSlot } : {}),
      platformLabel: platformLabelFor(draft),
      hasMedia: draft.hasMedia,
      createdAt: draft.createdAt,
    })),
    promotion: { active: activeRequests, awaitingApproval, total: requests.length },
    window: analytics?.window ?? { from: Date.now() - 30 * 24 * 60 * 60 * 1000, to: Date.now() },
    trend: analytics?.series ?? [],
    analyticsRead: analytics ? analytics.performanceRead : "failed",
  }
}

export type { GrowthOverview }
