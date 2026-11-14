import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Circle,
  ExternalLink,
  Globe,
  Lightbulb,
  Loader2,
  Megaphone,
  MousePointerClick,
  Rocket,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react"
import { GrowthSparkline, GrowthTrendChart, GROWTH_CHART_COLORS, type TrendSeries } from "@/components/marketing/growth-charts"
import { CreativeThumb } from "@/components/marketing/creative-thumb"
import { AD_PERFORMANCE_SOURCE_LABELS, AD_REQUEST_STATUS_LABELS } from "@/lib/marketing/ads/request-shared"
import { formatPerfValue, type StrategyStage } from "@/lib/marketing/ads/center-model"
import type { GrowthCenterOverview, GrowthCenterKpi } from "@/lib/marketing/ads/growth-center"
import { cn } from "@/lib/utils"

/**
 * Growth Overview — the Ads & Growth Center landing dashboard (brief §3).
 *
 * A pure presentational server component: it renders the assembled
 * `GrowthCenterOverview` view model and nothing else. Every number is a real
 * recorded measurement or an honest "not recorded" empty state — the brief's
 * illustrative sample figures are deliberately NOT fabricated here. Charts only
 * draw when real recorded series exist. Design language mirrors the Competition
 * dashboard (rounded-2xl cards, semantic primary accents, underline-free stat
 * cards, lucide icon tiles).
 */

const KPI_ICONS = [TrendingUp, MousePointerClick, UserPlus, Target] as const

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}>{children}</div>
}

function TrustBadge({ state }: { state: GrowthCenterKpi["state"] }) {
  const label = state === "measured" ? "measured" : state === "measured_zero" ? "measured · zero" : "not recorded"
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        state === "not_recorded" ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {label}
    </span>
  )
}

function KpiCard({ kpi, index }: { kpi: GrowthCenterKpi; index: number }) {
  const Icon = KPI_ICONS[index % KPI_ICONS.length]
  const color = GROWTH_CHART_COLORS[index % GROWTH_CHART_COLORS.length]
  const showValue = kpi.state !== "not_recorded"
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4" style={{ color }} aria-hidden />
          {kpi.label}
        </p>
        <TrustBadge state={kpi.state} />
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-2xl font-bold tabular-nums tracking-tight">
          {showValue ? formatPerfValue(kpi.value ?? 0, kpi.unit) : "—"}
        </p>
        {kpi.series.length > 0 ? (
          <GrowthSparkline values={kpi.series.map((point) => point.value)} color={color} />
        ) : (
          <div className="h-12 w-28" aria-hidden />
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{showValue ? kpi.definition : kpi.reason ?? kpi.definition}</p>
      {showValue && kpi.sources.length > 0 ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Source: {kpi.sources.map((source) => AD_PERFORMANCE_SOURCE_LABELS[source]).join(", ")}
        </p>
      ) : null}
    </Card>
  )
}

const STAGE_ICON: Record<StrategyStage["state"], React.ReactNode> = {
  complete: <Check className="size-3.5" aria-hidden />,
  in_progress: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
  upcoming: <Circle className="size-3.5" aria-hidden />,
}

function StageTracker({ stages, projectId }: { stages: StrategyStage[]; projectId: string }) {
  const stageHref: Record<StrategyStage["id"], string> = {
    audience: `/project/${projectId}/ads?tab=strategy`,
    channels: `/project/${projectId}/ads?tab=strategy`,
    materials: `/project/${projectId}/ads?tab=bench`,
    launch: `/project/${projectId}/campaigns`,
  }
  return (
    <ol className="flex flex-col gap-3">
      {stages.map((stage, i) => (
        <li key={stage.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border",
                stage.state === "complete"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : stage.state === "in_progress"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground",
              )}
            >
              {STAGE_ICON[stage.state]}
            </span>
            {i < stages.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" aria-hidden /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={stageHref[stage.id]} className="text-sm font-medium hover:text-primary hover:underline">
                {stage.title}
              </Link>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  stage.state === "complete"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : stage.state === "in_progress"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {stage.state === "complete" ? "Completed" : stage.state === "in_progress" ? "In progress" : "Upcoming"}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{stage.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
}

function campaignDuration(start: number | null, end: number | null): string {
  if (!start || !end) return "No dates set"
  const days = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)))
  return `${days} day${days === 1 ? "" : "s"}`
}

export function GrowthCenterOverviewView({
  overview,
  projectId,
  campaignsEnabled,
}: {
  overview: GrowthCenterOverview
  projectId: string
  campaignsEnabled: boolean
}) {
  const { business, kpis, stages, recommendation, campaigns, creatives, promotion, trend } = overview

  const trendSeries: TrendSeries[] = trend.slice(0, 4).map((entry, i) => ({
    key: entry.key,
    label: entry.label,
    color: GROWTH_CHART_COLORS[i % GROWTH_CHART_COLORS.length],
    points: entry.points,
  }))

  return (
    <div className="flex flex-col gap-6">
      {/* Business context */}
      <Card className="border-primary/15 bg-primary/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Rocket className="size-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="break-words text-lg font-semibold tracking-tight">{business.name}</h2>
                {business.live ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden /> Live
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                    {business.stateLabel}
                  </span>
                )}
              </div>
              {business.url ? (
                <a
                  href={business.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 break-all text-sm text-primary hover:underline"
                >
                  <Globe className="size-3.5 shrink-0" aria-hidden /> {business.url}
                </a>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Not deployed yet — deploy to get a shareable URL.</p>
              )}
              {business.audience.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {business.audience.slice(0, 4).map((entry) => (
                    <span key={entry} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {business.url ? (
              <a
                href={business.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
              >
                <ExternalLink className="size-4" aria-hidden /> View live application
              </a>
            ) : null}
            <Link
              href={`/project/${projectId}/ads?tab=promote`}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Megaphone className="size-4" aria-hidden /> Request promotion
            </Link>
          </div>
        </div>
      </Card>

      {/* KPI cards */}
      {overview.analyticsRead === "failed" ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          Promotion results could not be read right now. Nothing is shown as zero — refresh to try again.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.length > 0 ? (
          kpis.map((kpi, i) => <KpiCard key={kpi.id} kpi={kpi} index={i} />)
        ) : (
          <p className="col-span-full rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
            Growth metrics are unavailable right now. They appear here once promotion results can be read.
          </p>
        )}
      </div>

      {/* Two-column body */}
      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Growth strategy */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <Target className="size-4 text-primary" aria-hidden /> Your growth strategy
              </h3>
              <Link
                href={`/project/${projectId}/ads?tab=strategy`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View strategy <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Derived from your workspace state — a guide, not a claim that anything was executed.
            </p>
            <div className="mt-4">
              <StageTracker stages={stages} projectId={projectId} />
            </div>
            {recommendation ? (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  {recommendation.kind === "ai" ? <Sparkles className="size-3.5" aria-hidden /> : <Lightbulb className="size-3.5" aria-hidden />}
                  {recommendation.kind === "ai" ? "Atai recommends (AI draft)" : "Suggested next step"}
                </p>
                <p className="mt-1.5 text-sm font-medium">{recommendation.title}</p>
                <div className="scrollbar-thin mt-1 max-h-40 overflow-y-auto pr-1">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{recommendation.body}</p>
                </div>
              </div>
            ) : null}
          </Card>

          {/* Campaign performance */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <TrendingUp className="size-4 text-primary" aria-hidden /> Campaign performance
              </h3>
              <Link
                href={`/project/${projectId}/ads?tab=analytics`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Full analytics <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              What Atai&apos;s team recorded each day over the last 30 days — not a live analytics pixel.
            </p>
            {trendSeries.length > 0 ? (
              <div className="mt-4">
                <GrowthTrendChart series={trendSeries} />
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <TrendingUp className="mx-auto size-6 text-muted-foreground" aria-hidden />
                <p className="mt-2 text-sm font-medium">No campaign results recorded yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  Results appear here as Atai&apos;s team records them during a manual promotion. Atai never invents
                  traffic, leads, or sales.
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {/* Promote service card */}
          <Card className="border-primary/20 bg-gradient-to-b from-primary/10 to-card">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Megaphone className="size-5" aria-hidden />
            </span>
            <h3 className="mt-3 text-base font-semibold tracking-tight">Promote your business with Atai</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Let Atai&apos;s team help your application reach more potential customers.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {[
                "Professional campaign review",
                "Custom advertising strategy and quotation",
                "Manual promotional execution by Atai's team",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm leading-5">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden /> {feature}
                </li>
              ))}
            </ul>
            <Link
              href={`/project/${projectId}/ads?tab=promote`}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Submit campaign request <ArrowRight className="size-4" aria-hidden />
            </Link>
            <p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">
              Submitting is free. You approve a quotation before any credits are charged.
            </p>
            {promotion.total > 0 ? (
              <Link
                href={`/project/${projectId}/ads?tab=requests`}
                className="mt-3 flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-xs transition-colors hover:bg-muted"
              >
                <span className="text-muted-foreground">
                  {promotion.active} active · {promotion.awaitingApproval} awaiting you
                </span>
                <span className="font-medium text-primary">Track requests →</span>
              </Link>
            ) : null}
          </Card>

          {/* Recent campaigns */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold tracking-tight">Recent campaigns</h3>
              {campaignsEnabled ? (
                <Link href={`/project/${projectId}/campaigns`} className="text-xs font-medium text-primary hover:underline">
                  View all
                </Link>
              ) : null}
            </div>
            {!campaignsEnabled ? (
              <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
                Campaign planning is switched off. Turn it on in{" "}
                <Link href="/settings/features" className="text-primary underline underline-offset-2">
                  settings
                </Link>
                .
              </p>
            ) : campaigns.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
                No campaigns yet. Plans only — nothing is scheduled, posted, or executed.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {campaigns.slice(0, 3).map((campaign) => (
                  <li key={campaign.id}>
                    <Link
                      href={`/project/${projectId}/campaigns`}
                      className="flex items-center justify-between gap-2 py-2.5 text-sm transition-colors hover:text-primary"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{campaign.name}</span>
                        <span className="text-xs text-muted-foreground">{campaignDuration(campaign.startDate, campaign.endDate)}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Recent advertising materials */}
      <section aria-labelledby="growth-creatives-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="growth-creatives-heading" className="text-base font-semibold tracking-tight">
            Recent advertising materials
          </h3>
          <Link
            href={`/project/${projectId}/studio?tab=library`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open assets library <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
        {creatives.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center">
            <Sparkles className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">No creatives yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Draft platform copy and image creatives on the Ad bench — every piece lands in your Studio library.
            </p>
            <Link
              href={`/project/${projectId}/ads?tab=bench`}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-card px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              Open the Ad bench <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creatives.map((creative) => (
              <CreativeThumb
                key={creative.id}
                projectId={projectId}
                contentId={creative.id}
                title={creative.title}
                platformLabel={creative.platformLabel}
                kind={creative.kind}
                hasMedia={creative.hasMedia}
              />
            ))}
          </div>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Atai drafts and (on request) manually promotes — it never auto-publishes, and it never promises impressions,
        reach, customers, or sales. Recorded results are labeled by source in Analytics.
      </p>
    </div>
  )
}
