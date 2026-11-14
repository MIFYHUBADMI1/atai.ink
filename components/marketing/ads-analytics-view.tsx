"use client"

import { useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Eye,
  Filter,
  Info,
  MousePointerClick,
  Server,
  Target,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react"
import { GrowthDonut, GrowthTrendChart, GROWTH_CHART_COLORS, type TrendSeries } from "@/components/marketing/growth-charts"
import { AD_PERFORMANCE_SOURCE_LABELS, AD_REQUEST_STATUS_LABELS } from "@/lib/marketing/ads/request-shared"
import {
  PERF_METRIC_KEYS,
  formatPerfValue,
  type PerfMetricKey,
  type PerfTotal,
} from "@/lib/marketing/ads/center-model"
import type { AdsAnalytics, AnalyticsRange } from "@/lib/marketing/ads/analytics"
import type { AdPerformanceSource } from "@/lib/types/ads"
import { cn } from "@/lib/utils"

/**
 * Performance Analytics tab (brief §7). Every figure is a real result Atai's
 * team recorded while manually executing an approved promotion — never a
 * fabricated sample. Filters (range + campaign) are URL-driven so the view is
 * bookmarkable and re-reads honestly on change. Per-campaign results render as
 * stacked cards (the app's data-UI convention), each metric labeled by source;
 * a disclosure reveals every raw recorded entry, including unknown-metric ones.
 */

const RANGES: AnalyticsRange[] = [7, 30, 90]

const SOURCE_STYLES: Record<AdPerformanceSource, string> = {
  manual: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  platform: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  estimated: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  tracking: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
}

const KPI_ICONS: Partial<Record<PerfMetricKey, typeof TrendingUp>> = {
  impressions: Eye,
  reach: Users,
  clicks: MousePointerClick,
  visits: TrendingUp,
  leads: UserPlus,
  customers: Target,
}

function SourceBadge({ source }: { source: AdPerformanceSource }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]", SOURCE_STYLES[source])}>
      {AD_PERFORMANCE_SOURCE_LABELS[source]}
    </span>
  )
}

function TrustBadge({ state }: { state: PerfTotal["state"] }) {
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

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}>{children}</div>
}

function StatCard({ total, index }: { total: PerfTotal; index: number }) {
  const Icon = KPI_ICONS[total.key] ?? BarChart3
  const color = GROWTH_CHART_COLORS[index % GROWTH_CHART_COLORS.length]
  const showValue = total.state !== "not_recorded"
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4" style={{ color }} aria-hidden /> {total.label}
        </p>
        <TrustBadge state={total.state} />
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight">
        {showValue ? formatPerfValue(total.value ?? 0, total.unit) : "—"}
      </p>
      <p className="text-xs leading-5 text-muted-foreground">{total.definition}</p>
      {showValue && total.sources.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {total.sources.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </div>
      ) : null}
    </Card>
  )
}

export function AdsAnalyticsView({
  analytics,
  projectId,
}: {
  analytics: AdsAnalytics
  projectId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [showRaw, setShowRaw] = useState(false)

  const hrefFor = (next: { range?: AnalyticsRange; campaign?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", "analytics")
    if (next.range !== undefined) params.set("range", String(next.range))
    if (next.campaign !== undefined) {
      if (next.campaign) params.set("campaign", next.campaign)
      else params.delete("campaign")
    }
    return `${pathname}?${params.toString()}`
  }

  const trendSeries: TrendSeries[] = useMemo(
    () =>
      analytics.series.map((entry, i) => ({
        key: entry.key,
        label: entry.label,
        color: GROWTH_CHART_COLORS[i % GROWTH_CHART_COLORS.length],
        points: entry.points,
      })),
    [analytics.series],
  )

  const sourceSlices = (Object.keys(analytics.sourceCounts) as AdPerformanceSource[])
    .map((source) => ({ name: AD_PERFORMANCE_SOURCE_LABELS[source], value: analytics.sourceCounts[source] }))
    .filter((slice) => slice.value > 0)
  const totalReports = sourceSlices.reduce((sum, slice) => sum + slice.value, 0)

  const measuredFunnel = analytics.funnel.filter((stage) => stage.state !== "not_recorded")
  const maxFunnel = measuredFunnel.reduce((max, stage) => Math.max(max, stage.value ?? 0), 0)

  const rawEntries = useMemo(() => {
    const canonical = analytics.campaigns.flatMap((campaign) =>
      PERF_METRIC_KEYS.map((key) => ({ campaign, total: campaign.totals[key] })).filter((row) => row.total.state !== "not_recorded"),
    )
    return { canonical, other: analytics.other }
  }, [analytics.campaigns, analytics.other])

  const selectedCampaign = analytics.campaignOptions.find((option) => option.id === analytics.requestId) ?? null

  return (
    <div className="flex flex-col gap-6">
      {/* Filters */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <BarChart3 className="size-5 text-primary" aria-hidden /> Performance analytics
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Results Atai&apos;s team recorded while promoting your business by hand — labeled by source. Nothing here
              is a live analytics pixel, and Atai never invents traffic, leads, or sales.
            </p>
          </div>
          <span className="shrink-0 self-start rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Reading is free
          </span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Window</span>
            <div role="group" aria-label="Date range" className="inline-flex rounded-xl border border-border bg-background p-0.5">
              {RANGES.map((range) => {
                const active = analytics.rangeDays === range
                return (
                  <button
                    key={range}
                    type="button"
                    aria-pressed={active}
                    onClick={() => router.push(hrefFor({ range }), { scroll: false })}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {range} days
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Filter className="size-3" aria-hidden /> Campaign
            </span>
            <div className="relative">
              <select
                value={analytics.requestId ?? ""}
                onChange={(e) => router.push(hrefFor({ campaign: e.target.value || null }), { scroll: false })}
                className="w-full appearance-none rounded-xl border border-border bg-background py-2 pl-3 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-56"
              >
                <option value="">All promotion campaigns</option>
                {analytics.campaignOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {AD_REQUEST_STATUS_LABELS[option.status]}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            </div>
          </label>

          {selectedCampaign ? (
            <button
              type="button"
              onClick={() => router.push(hrefFor({ campaign: null }), { scroll: false })}
              className="self-start rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted sm:self-end"
            >
              Clear filter
            </button>
          ) : null}
        </div>
      </Card>

      {analytics.performanceRead === "failed" ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          Recorded results could not be read right now. Nothing is shown as zero — refresh to try again.
        </p>
      ) : null}
      {analytics.requestsRead === "failed" ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          Promotion campaigns could not be read right now, so the per-campaign breakdown may be incomplete.
        </p>
      ) : null}

      {/* KPI grid — every canonical metric, honest empty states */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PERF_METRIC_KEYS.map((key, i) => (
          <StatCard key={key} total={analytics.totals[key]} index={i} />
        ))}
      </div>

      {/* Trend */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <TrendingUp className="size-4 text-primary" aria-hidden /> Recorded each day
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {formatDate(analytics.window.from)} – {formatDate(analytics.window.to)}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          What the team recorded on each day of the window — not a cumulative curve or a live pixel.
        </p>
        {trendSeries.length > 0 ? (
          <div className="mt-4">
            <GrowthTrendChart series={trendSeries} height={280} />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <TrendingUp className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">No results recorded in this window</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              {analytics.requestId
                ? "This campaign has no recorded results in the selected window. Widen the range or clear the filter."
                : "Results appear here as Atai's team records them during a manual promotion."}
            </p>
          </div>
        )}
      </Card>

      {/* Funnel + source donut */}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Target className="size-4 text-primary" aria-hidden /> Conversion funnel
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Each stage is a recorded total. Conversion is shown only between two measured stages — never guessed.
          </p>
          {measuredFunnel.length > 0 ? (
            <ol className="mt-4 flex flex-col gap-3">
              {analytics.funnel.map((stage, i) => {
                const measured = stage.state !== "not_recorded"
                const width = measured && maxFunnel > 0 ? Math.max(4, ((stage.value ?? 0) / maxFunnel) * 100) : 0
                return (
                  <li key={stage.key} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{stage.label}</span>
                      <span className="flex items-center gap-2">
                        {stage.conversionFromPrev !== null ? (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {(stage.conversionFromPrev * 100).toFixed(1)}% of prev
                          </span>
                        ) : null}
                        <span className="tabular-nums font-semibold">
                          {measured ? formatPerfValue(stage.value ?? 0, "count") : "—"}
                        </span>
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      {measured ? (
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${width}%`, backgroundColor: GROWTH_CHART_COLORS[i % GROWTH_CHART_COLORS.length] }}
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    {!measured ? <span className="text-[11px] text-muted-foreground">Not recorded</span> : null}
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <Target className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium">No funnel to show yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                The funnel builds from recorded impressions, clicks, visits, registrations and customers.
              </p>
            </div>
          )}
        </Card>

        <Card className="flex flex-col items-center">
          <h3 className="self-start text-base font-semibold tracking-tight">Results by source</h3>
          <p className="mt-1 self-start text-xs leading-5 text-muted-foreground">
            How the recorded results were sourced — estimates are never mixed in as actuals.
          </p>
          <div className="mt-4">
            <GrowthDonut slices={sourceSlices} centerLabel="recorded entries" centerValue={String(totalReports)} />
          </div>
          {sourceSlices.length > 0 ? (
            <ul className="mt-4 flex w-full flex-col gap-1.5">
              {sourceSlices.map((slice, i) => (
                <li key={slice.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: GROWTH_CHART_COLORS[i % GROWTH_CHART_COLORS.length] }} aria-hidden />
                    {slice.name}
                  </span>
                  <span className="tabular-nums font-medium">{slice.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">No entries recorded in this window.</p>
          )}
        </Card>
      </div>

      {/* Per-campaign results — stacked cards */}
      <section aria-labelledby="analytics-campaigns-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="analytics-campaigns-heading" className="text-base font-semibold tracking-tight">
            Results by campaign
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {analytics.campaigns.length} campaign{analytics.campaigns.length === 1 ? "" : "s"}
          </span>
        </div>
        {analytics.campaigns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center">
            <BarChart3 className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">No promotion campaigns yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Request Atai promotion to start a manual campaign. Recorded results will break down here per campaign.
            </p>
            <a
              href={`/project/${projectId}/ads?tab=promote`}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-card px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              Request promotion <ArrowRight className="size-4" aria-hidden />
            </a>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {analytics.campaigns.map((campaign) => {
              const measuredKeys = PERF_METRIC_KEYS.filter((key) => campaign.totals[key].state !== "not_recorded")
              const sources = new Set<AdPerformanceSource>()
              for (const key of measuredKeys) for (const source of campaign.totals[key].sources) sources.add(source)
              return (
                <li key={campaign.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold tracking-tight">{campaign.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{AD_REQUEST_STATUS_LABELS[campaign.status]}</span>
                        {campaign.objective ? <span className="min-w-0 break-words">{campaign.objective}</span> : null}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {campaign.lastReportAt ? `Last result ${formatDate(campaign.lastReportAt)}` : "No results yet"}
                    </span>
                  </div>

                  {measuredKeys.length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {measuredKeys.map((key) => {
                        const total = campaign.totals[key]
                        return (
                          <div key={key} className="rounded-xl border border-border bg-background px-3 py-2">
                            <p className="text-[11px] text-muted-foreground">{total.label}</p>
                            <p className="mt-0.5 tabular-nums text-base font-semibold">{formatPerfValue(total.value ?? 0, total.unit)}</p>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
                      No results recorded for this campaign in the selected window.
                      {campaign.estimatedImpressionsMin !== undefined && campaign.estimatedImpressionsMax !== undefined ? (
                        <>
                          {" "}The proposal estimated {campaign.estimatedImpressionsMin.toLocaleString("en-US")}–
                          {campaign.estimatedImpressionsMax.toLocaleString("en-US")} impressions — an estimate, not a result.
                        </>
                      ) : null}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {[...sources].map((source) => (
                      <SourceBadge key={source} source={source} />
                    ))}
                    {campaign.otherCount > 0 ? (
                      <span className="font-mono text-[10px] text-muted-foreground">+{campaign.otherCount} other entries</span>
                    ) : null}
                    <a
                      href={`/project/${projectId}/ads?tab=requests&request=${encodeURIComponent(campaign.id)}`}
                      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Track campaign <ArrowRight className="size-3" aria-hidden />
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Raw recorded entries disclosure */}
      {analytics.hasAnyReports ? (
        <Card>
          <button
            type="button"
            onClick={() => setShowRaw((value) => !value)}
            aria-expanded={showRaw}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Info className="size-4 text-primary" aria-hidden /> Every recorded entry
            </span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showRaw && "rotate-180")} aria-hidden />
          </button>
          {showRaw ? (
            <div className="mt-4 flex flex-col gap-4">
              {rawEntries.canonical.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                  {rawEntries.canonical.map(({ campaign, total }) => (
                    <li key={`${campaign.id}:${total.key}`} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 break-words">
                        <span className="font-medium">{total.label}</span>
                        <span className="text-muted-foreground"> · {campaign.name}</span>
                      </span>
                      <span className="tabular-nums font-semibold">{formatPerfValue(total.value ?? 0, total.unit)}</span>
                      {total.sources.map((source) => (
                        <SourceBadge key={source} source={source} />
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
              {rawEntries.other.length > 0 ? (
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Other recorded entries (unrecognized metric names — kept, not dropped)
                  </p>
                  <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                    {rawEntries.other.map((report) => (
                      <li key={report.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 break-words font-medium">{report.metric}</span>
                          <span className="tabular-nums font-semibold">{report.value.toLocaleString("en-US")}</span>
                          <SourceBadge source={report.source} />
                          <span className="font-mono text-[10px] text-muted-foreground">{formatDate(report.reportedAt)}</span>
                        </div>
                        {report.note ? <p className="text-xs leading-5 text-muted-foreground">{report.note}</p> : null}
                        {report.evidenceUrl ? (
                          <a href={report.evidenceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-primary hover:underline">
                            {report.evidenceUrl}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Expand to see each measured total and every other entry the team recorded, with its source and date.
            </p>
          )}
        </Card>
      ) : null}

      {/* Runtime requests — kept strictly separate from promotion results */}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Server className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Runtime API requests</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Calls your live app handled in this window. This is infrastructure usage — <strong>not</strong> visitors,
              leads, or promotion results, and never combined with them.
            </p>
          </div>
        </div>
        <p className="shrink-0 text-2xl font-bold tabular-nums tracking-tight">
          {analytics.runtimeRequests.state === "unavailable" ? "—" : (analytics.runtimeRequests.value ?? 0).toLocaleString("en-US")}
        </p>
      </Card>

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Every number above was recorded by Atai&apos;s team during a manual promotion and labeled by source. Atai does
        not run a live analytics pixel, auto-publish, or guarantee impressions, reach, customers, or sales.
      </p>
    </div>
  )
}