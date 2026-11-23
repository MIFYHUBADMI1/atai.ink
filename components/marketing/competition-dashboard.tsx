"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Banknote,
  CalendarDays,
  Check,
  ExternalLink,
  Globe,
  HelpCircle,
  History as HistoryIcon,
  Layers,
  Lightbulb,
  Loader2,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Star,
  Target,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Users,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { CofounderMarkdown } from "@/components/cofounder/markdown"
import { CompetitorIntelligenceList } from "@/components/project-resources/competitor-intelligence-list"
import {
  CompetitorCards,
  CountDonut,
  ExecutiveSummary,
  MarketIntelligence,
  OpportunitiesPanel,
  ReportComparisons,
  SourcesEvidence,
  StructuredReportBody,
} from "@/components/marketing/competition-report-view"
import { postJson } from "@/lib/client/api"
import type { ResourceCompetitorIntelligence } from "@/lib/resources/competitor-schema"
import { cn } from "@/lib/utils"
import {
  buildLandscapeModel,
  buildScanSeries,
  competitivenessLabel,
  extractGrowthSignal,
  formatDay,
  formatStamp,
  growthFromFigures,
  parseCompetitionBody,
  reportCategoryDistribution,
  totalRunCost,
  type CompetitionSnapshotItem,
  type CompetitionSourceView,
} from "@/lib/marketing/competition-view-model"

const TABS = ["Overview", "Competitors", "Compare", "Opportunities & Strategy", "History"] as const
type Tab = (typeof TABS)[number]

const CHART_COLORS = ["#7c5cfa", "#38a1f7", "#10b981", "#f59e0b", "#94a3b8", "#cbd5e1"]
const KIND_COLORS: Record<CompetitionSourceView["kind"], string> = {
  web: "#38a1f7",
  news: "#7c5cfa",
  research: "#10b981",
  data_tool: "#f59e0b",
}
const SOURCE_GROUPS: Array<{ kind: CompetitionSourceView["kind"]; label: string }> = [
  { kind: "web", label: "Web pages" },
  { kind: "news", label: "News" },
  { kind: "research", label: "Research & reports" },
  { kind: "data_tool", label: "Data tools & providers" },
]
const KIND_BADGE: Record<CompetitionSourceView["kind"], string> = {
  web: "Web",
  news: "News",
  research: "Research",
  data_tool: "Data tool",
}

function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const mounted = useMounted()
  const data = useMemo(() => {
    const series = values.length === 1 ? [values[0], values[0]] : values
    return series.map((value, i) => ({ i, value }))
  }, [values])
  if (!mounted || data.length < 2) return <div className="h-12 w-28" aria-hidden />
  return (
    <div className="h-12 w-28" dir="ltr" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.12}
            dot={{ r: 2, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function KindBars({ sources }: { sources: CompetitionSourceView[] }) {
  const mounted = useMounted()
  const data = useMemo(
    () =>
      SOURCE_GROUPS.map((g) => ({
        label: g.label,
        value: sources.filter((s) => s.kind === g.kind).length,
        fill: KIND_COLORS[g.kind],
      })),
    [sources],
  )
  if (!mounted || sources.length === 0) return <div className="h-14 w-20" aria-hidden />
  return (
    <div className="h-14 w-20" dir="ltr" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Tooltip
            cursor={{ fill: "var(--accent)", fillOpacity: 0.3 }}
            contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "var(--foreground)" }}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={12} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.label} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function LandscapeDonut({
  slices,
  metric,
  centerCount,
}: {
  slices: Array<{ name: string; mentions: number; share: number }>
  metric: "share" | "mentions"
  centerCount: number
}) {
  const mounted = useMounted()
  const data = useMemo(() => {
    const rows = slices
      .map((s) => ({ name: s.name, value: metric === "share" ? s.share : s.mentions }))
      .filter((row) => row.value > 0)
    return rows.length > 0 ? rows : [{ name: "No data yet", value: 1 }]
  }, [slices, metric])
  const empty = data.length === 1 && data[0].name === "No data yet"
  if (!mounted) return <div className="size-44" aria-hidden />
  return (
    <div className="relative size-44 shrink-0" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="96%"
            paddingAngle={empty ? 0 : 2}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={empty ? "var(--muted)" : CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          {!empty && (
            <Tooltip
              contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "var(--foreground)" }}
              formatter={(value: unknown, name: unknown) => [
                metric === "share" ? `${value}% (est.)` : `${value} mentions`,
                String(name),
              ]}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{centerCount}</span>
        <span className="text-[11px] text-muted-foreground">Competitors</span>
      </div>
    </div>
  )
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}>{children}</div>
}

function OutlineButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-card px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export function CompetitionDashboard({
  projectId,
  snapshot: initialSnapshot,
  history: initialHistory = [],
  currentContextHash,
  creditsAvailable: initialCredits,
  textReady,
  researchReady,
  hasPlan,
  researchEnabled,
  entitlementDenied,
  positioning,
  valueProposition,
  targetUsers,
  intelligence,
}: {
  projectId: string
  snapshot: CompetitionSnapshotItem | null
  history?: CompetitionSnapshotItem[]
  currentContextHash?: string
  creditsAvailable: number | null
  textReady: boolean
  researchReady: boolean
  hasPlan: boolean
  researchEnabled: boolean
  entitlementDenied?: string | null
  positioning: string
  valueProposition: string
  targetUsers: string[]
  intelligence: ResourceCompetitorIntelligence | null
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [history, setHistory] = useState(initialHistory)
  const [creditsAvailable, setCreditsAvailable] = useState(initialCredits)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmFresh, setConfirmFresh] = useState(false)
  const [tab, setTab] = useState<Tab>("Overview")
  const fullResearchRef = useRef<HTMLDetailsElement>(null)

  async function generate() {
    if (generating) return
    setGenerating(true)
    setError(null)
    setConfirmFresh(false)
    try {
      const item = await postJson<CompetitionSnapshotItem>(
        `/api/projects/${encodeURIComponent(projectId)}/market/competition-snapshot`,
        {},
      )
      if (snapshot) setHistory((current) => [snapshot, ...current])
      setSnapshot(item)
      if (item.creditsCharged > 0 || item.research?.researchCreditsCharged) {
        setCreditsAvailable((current) =>
          current === null
            ? null
            : Math.max(0, current - item.creditsCharged - (item.research?.researchCreditsCharged ?? 0)),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The snapshot didn't generate. Please try again.")
    } finally {
      setGenerating(false)
    }
  }

  const parse = useMemo(() => parseCompetitionBody(snapshot?.body ?? ""), [snapshot?.body])
  const report = snapshot?.competitionReport
  const research = snapshot?.research
  const sources = research?.sources ?? []
  const competitorCount = report
    ? report.competitors.filter((c) => c.category !== "not_competitor").length
    : parse.competitors.length
  const sourceCount = research?.sources.length
  const pricingEvidenceCount = report ? report.competitors.filter((c) => c.pricing).length + report.pricingComparison.length : null
  const opportunityCount = report?.opportunities.length ?? parse.opportunities.length
  const landscape = useMemo(() => buildLandscapeModel(parse.competitors, sources), [parse.competitors, sources])
  const categorySlices = useMemo(() => (report ? reportCategoryDistribution(report) : []), [report])
  const series = useMemo(() => buildScanSeries([snapshot, ...history].filter((s): s is CompetitionSnapshotItem => Boolean(s))), [snapshot, history])
  const reportGrowth = useMemo(() => (report ? growthFromFigures(report) : null), [report])
  const growth = useMemo(() => (report ? null : extractGrowthSignal(parse.market)), [report, parse.market])
  const landscapeLabel = competitivenessLabel(competitorCount)
  const stale = Boolean(snapshot) && (!snapshot?.contextHash || (currentContextHash && snapshot?.contextHash !== currentContextHash))
  const blockedReason = entitlementDenied
    ? entitlementDenied
    : !researchEnabled
    ? "Live research is switched off on this deployment."
    : !hasPlan
      ? "The snapshot builds on your plan — create one first."
      : !researchReady
        ? "Live web research isn't configured on this deployment yet."
        : !textReady
          ? "Text generation isn't configured on this deployment yet."
          : null

  const prevScan = series.length > 1 ? series[series.length - 2] : null
  const delta = prevScan ? competitorCount - prevScan.competitors : null
  const topOpportunity = report?.opportunities[0]?.text ?? parse.opportunities[0] ?? null
  const keyFinding = report
    ? reportGrowth
      ? `${reportGrowth.label}: ${reportGrowth.direction === "up" ? "+" : "−"}${reportGrowth.percent}% — ${reportGrowth.geographyLabel} (${reportGrowth.geographyScope})`
      : (report.keyFindings[0]?.text ?? null)
    : growth
      ? `Sources report ${growth.direction === "up" ? "+" : "−"}${growth.percent}% ${growth.direction === "up" ? "growth" : "decline"} — ${growth.context}`
      : (topOpportunity ?? parse.market?.split(/\n/)[0] ?? null)

  const insights = report
    ? [
        `${competitorCount} competitor${competitorCount === 1 ? "" : "s"} classified from ${sources.length} live sources — categories and confidence on the Competitors tab.`,
        topOpportunity ?? "Differentiation opportunities appear here once research finds them.",
        reportGrowth
          ? `${reportGrowth.label} — ${reportGrowth.geographyLabel} (${reportGrowth.geographyScope}), as reported by its source.`
          : (report.limitations[0] ?? "Market size and growth are not established by the current sources."),
      ]
    : [
        research
          ? `The market is ${landscapeLabel.label.toLowerCase()} with ${competitorCount} strong player${competitorCount === 1 ? "" : "s"} identified in your live sources.`
          : "This draft is plan-only — run live research to identify real competitors.",
        topOpportunity ?? "Differentiation opportunities appear here once research finds them.",
        growth
          ? `Market signals: ${growth.context}`
          : (parse.market ? parse.market.split("\n")[0] : "Market size and growth are not established by the current sources."),
      ]

  function openFullResearch() {
    if (fullResearchRef.current) {
      fullResearchRef.current.open = true
      fullResearchRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  const runButton = (
    <OutlineButton onClick={() => (snapshot ? setConfirmFresh(true) : void generate())} disabled={Boolean(blockedReason) || generating}>
      {generating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
      {generating ? "Researching…" : "Run live research"}
    </OutlineButton>
  )

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pb-16">
      <header data-atai-tour="competition-dashboard" className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BarChart3 className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Competition</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Understand your competitive landscape and find opportunities to stand out.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          {runButton}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", snapshot ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
            {snapshot
              ? `Last updated: ${formatStamp(research?.collectedAt ?? snapshot.createdAt)}`
              : "No research run yet"}
          </p>
        </div>
      </header>

      {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}

      {confirmFresh && !generating && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
          Search the live web again? This snapshot stays in your library.
          <button
            type="button"
            onClick={() => void generate()}
            className="rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Yes, research again
          </button>
          <button
            type="button"
            onClick={() => setConfirmFresh(false)}
            className="rounded-full border border-border px-3 py-1 font-medium hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          Searching the live web — pages, news, research, data tools — then drafting from what it finds. This usually
          takes under a minute…
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}

      {stale && (
        <p className="flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {snapshot?.contextHash
            ? "The planning context has changed since this draft. Generate a new draft to reflect it."
            : "This older draft has no recorded plan version; its freshness is unknown."}
        </p>
      )}

      <div role="tablist" aria-label="Competition sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      <section role="tabpanel" hidden={tab !== "Overview"} className={tab === "Overview" ? "flex flex-col gap-5" : "hidden"}>
        {report && (
          <ExecutiveSummary
            report={report}
            research={research}
            createdAt={snapshot?.createdAt ?? 0}
            totalCost={snapshot ? totalRunCost(snapshot) : 0}
          />
        )}
        <div className="grid gap-6 rounded-2xl border border-primary/15 bg-primary/5 p-5 sm:p-6 lg:grid-cols-2 lg:gap-8">
          <div className="flex items-start gap-4">
            <Target className="mt-0.5 size-8 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold tracking-tight">Your plan&apos;s positioning</h2>
              {positioning ? (
                <div className="mt-2 min-w-0 text-sm leading-6 text-foreground/90">
                  <CofounderMarkdown>{positioning}</CofounderMarkdown>
                </div>
              ) : (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Add your market positioning in the plan editor and this page fills in.
                </p>
              )}
              <Link
                href={`/project/${projectId}/plan`}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5"
              >
                Go to Plan <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
          <div className="flex items-start gap-4 lg:border-l lg:border-primary/15 lg:pl-8">
            <Users className="mt-0.5 size-7 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold tracking-tight">Who you are competing for</h2>
              {targetUsers.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-6 text-foreground/90">
                  {targetUsers.map((u, i) => (
                    <li key={`${i}-${u}`} className="flex gap-2 break-words">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      {u}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Target customers from your plan appear here once the plan names them.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Trophy className="size-4 shrink-0 text-amber-500" aria-hidden /> Key Competitors Identified
              </p>
              <p className="mt-2 text-2xl font-bold">{competitorCount}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {delta !== null && delta !== 0 ? (
                  <>
                    {delta > 0 ? (
                      <ArrowUpRight className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    ) : (
                      <ArrowDownRight className="size-3.5 text-red-600 dark:text-red-400" aria-hidden />
                    )}
                    <span className={delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                      {delta > 0 ? `+${delta}` : delta} vs last scan
                    </span>
                  </>
                ) : delta === 0 ? (
                  "no change vs last scan"
                ) : (
                  "first scan"
                )}
              </p>
            </div>
            <Sparkline values={series.map((p) => p.competitors)} color="#38a1f7" />
          </Card>
          <Card className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ExternalLink className="size-4 shrink-0 text-blue-500" aria-hidden /> Live Sources Retrieved
              </p>
              <p className="mt-2 text-2xl font-bold">{sourceCount ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {research ? `retrieved ${formatDay(research.collectedAt)}` : "No live run yet"}
              </p>
            </div>
            <KindBars sources={sources} />
          </Card>
          <Card className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Banknote className="size-4 shrink-0 text-emerald-500" aria-hidden /> Pricing Evidence
              </p>
              <p className="mt-2 text-2xl font-bold">{pricingEvidenceCount ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pricingEvidenceCount === null
                  ? "Available after a structured research run"
                  : pricingEvidenceCount > 0
                    ? "pricing facts or comparison rows found"
                    : "no prices stated in the sources"}
              </p>
            </div>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Banknote className="size-5" aria-hidden />
            </span>
          </Card>
          <Card className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Lightbulb className="size-4 shrink-0 text-emerald-500" aria-hidden /> Opportunities Identified
              </p>
              <p className="mt-2 text-2xl font-bold">{opportunityCount}</p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {topOpportunity ? "AI suggestions — verify before acting" : "Run live research to surface opportunities"}
              </p>
            </div>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Lightbulb className="size-5" aria-hidden />
            </span>
          </Card>
          <Card className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <PieChartIcon className="size-4 shrink-0 text-blue-500" aria-hidden /> Market Landscape
              </p>
              <p className="mt-2 text-lg font-bold leading-6">{landscapeLabel.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{landscapeLabel.sub}</p>
            </div>
            <KindBars sources={sources} />
          </Card>
          <Card className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Star className="size-4 shrink-0 text-amber-400" aria-hidden /> Top Opportunity
              </p>
              <p className="mt-2 break-words text-lg font-bold leading-6">{topOpportunity ?? "Not identified yet"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {topOpportunity ? "From your live-research snapshot" : "Run live research to surface opportunities"}
              </p>
            </div>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Lightbulb className="size-5" aria-hidden />
            </span>
          </Card>
          <Card className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <TrendingUp className="size-4 shrink-0 text-emerald-500" aria-hidden /> Market Trend
              </p>
              <p className="mt-2 text-lg font-bold leading-6">
                {reportGrowth || growth ? ((reportGrowth ?? growth)?.direction === "up" ? "Growing" : "Contracting") : "Not Established"}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {reportGrowth ? (
                  <span className="break-words text-emerald-600 dark:text-emerald-400">
                    {reportGrowth.direction === "up" ? "+" : "−"}{reportGrowth.percent}% · {reportGrowth.geographyLabel} ({reportGrowth.geographyScope})
                  </span>
                ) : growth ? (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {growth.direction === "up" ? "+" : "−"}{growth.percent}% as reported in sources
                  </span>
                ) : (
                  "No growth figure in your sources"
                )}
              </p>
            </div>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold tracking-tight">Competitive Landscape</h2>
              <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {report ? "Competitor categories" : "Source mentions"}
              </span>
            </div>
            <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-center">
              <div className="flex flex-col items-center gap-6 sm:flex-row">
                {report ? (
                  <CountDonut slices={categorySlices} centerCount={competitorCount} centerLabel="Competitors" />
                ) : (
                  <LandscapeDonut slices={landscape.slices} metric="mentions" centerCount={competitorCount} />
                )}
                {report ? (
                  categorySlices.length > 0 ? (
                    <ul className="flex min-w-0 flex-col gap-2.5">
                      {categorySlices.map((s, i) => (
                        <li key={s.key} className="flex items-center gap-2 text-sm">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
                          <span className="min-w-0 flex-1 break-words text-foreground/90">{s.label}</span>
                          <span className="font-bold">{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="max-w-48 text-sm leading-6 text-muted-foreground">
                      No classified competitors yet — the distribution fills in after live research.
                    </p>
                  )
                ) : landscape.totalMentions > 0 ? (
                  <ul className="flex min-w-0 flex-col gap-2.5">
                    {landscape.slices.map((s, i) => (
                      <li key={s.name} className="flex items-center gap-2 text-sm">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
                        <span className="min-w-0 flex-1 break-words text-foreground/90">{s.name}</span>
                        <span className="font-bold">{s.mentions}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="max-w-48 text-sm leading-6 text-muted-foreground">
                    No named competitors in the sources yet — the landscape fills in after live research.
                  </p>
                )}
              </div>
              <div className="min-w-0 flex-1 lg:border-l lg:border-border lg:pl-6">
                <h3 className="text-base font-bold tracking-tight">Competitive Insights</h3>
                <ul className="mt-3 flex flex-col gap-3">
                  {insights.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-6 text-foreground/90">
                      <Check className="mt-1 size-4 shrink-0 text-emerald-500" aria-hidden />
                      <span className="break-words">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
              {report
                ? "Distribution of classified competitors — real counts from the validated report, not market share."
                : "Counts show how often each competitor appears in your live-research sources — presence, not verified market share. Verify before you rely on it."}
            </p>
          </Card>

          <Card className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <Globe className="size-5 text-primary" aria-hidden />
              <h2 className="text-lg font-bold tracking-tight">Live Research Summary</h2>
              {research && (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Live
                </span>
              )}
              <OutlineButton
                className="ml-auto px-3 py-1.5 text-xs"
                onClick={() => (snapshot ? setConfirmFresh(true) : void generate())}
                disabled={Boolean(blockedReason) || generating}
              >
                Run Again <RefreshCw className={cn("size-3.5", generating && "animate-spin")} aria-hidden />
              </OutlineButton>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Real-time insights from web search, news and research reports.
            </p>
            {research ? (
              <>
                <dl className="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm">
                  <div className="flex items-start gap-3">
                    <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <dt className="w-28 shrink-0 font-semibold">Search Query</dt>
                    <dd className="min-w-0 break-words text-foreground/90">{research.queries.join(" · ") || "none recorded"}</dd>
                  </div>
                  <div className="flex items-start gap-3">
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <dt className="w-28 shrink-0 font-semibold">Research Date</dt>
                    <dd className="min-w-0 text-foreground/90">{formatStamp(research.collectedAt)}</dd>
                  </div>
                  <div className="flex items-start gap-3">
                    <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <dt className="w-28 shrink-0 font-semibold">Sources ({research.sources.length})</dt>
                    <dd className="min-w-0 break-words">
                      {research.sources.slice(0, 3).map((s, i) => (
                        <span key={`${s.url ?? s.title}-${i}`}>
                          {i > 0 && ", "}
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                              {s.title}
                            </a>
                          ) : (
                            s.title
                          )}
                        </span>
                      ))}
                      {research.sources.length > 3 && (
                        <button type="button" onClick={openFullResearch} className="text-primary underline">
                          +{research.sources.length - 3} more
                        </button>
                      )}
                    </dd>
                  </div>
                </dl>
                {keyFinding && (
                  <p className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm leading-6 text-emerald-700 dark:text-emerald-300">
                    <Check className="mt-1 size-4 shrink-0" aria-hidden />
                    <span className="break-words">Key finding: {keyFinding}</span>
                  </p>
                )}
              </>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-3 text-sm leading-6 text-muted-foreground">
                {snapshot
                  ? "This draft was written from your plan only — no live sources yet. Run live research to ground it."
                  : "No research has run yet. One click searches the live web and drafts a snapshot grounded in what it finds."}
              </p>
            )}
            <button type="button" onClick={openFullResearch} className="mt-4 inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
              View full research <ArrowRight className="size-4" aria-hidden />
            </button>
            {creditsAvailable !== null && (
              <p className="mt-3 border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Account credits available: {creditsAvailable}
              </p>
            )}
          </Card>
        </div>

        {report && <MarketIntelligence report={report} sources={sources} />}

        <details ref={fullResearchRef} className="rounded-2xl border border-border bg-card px-5 py-4">
          <summary className="cursor-pointer text-sm font-semibold text-primary">
            View full research — the complete snapshot and every live source
          </summary>
          {snapshot ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{snapshot.title}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <Check className="size-3" aria-hidden /> AI draft · from live sources
                </span>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {research
                  ? `Live research ${formatDay(research.collectedAt)} · ${research.sources.length} sources${
                      research.researchCreditsCharged > 0 ? ` · ${research.researchCreditsCharged} credits` : ""
                    }`
                  : `Drafted ${formatDay(snapshot.createdAt)} · from your plan, not market data`}
              </p>
              {report ? (
                <StructuredReportBody report={report} sources={sources} research={research} />
              ) : (
                <div className="min-w-0 text-sm leading-6 text-foreground">
                  <CofounderMarkdown>{snapshot.body}</CofounderMarkdown>
                </div>
              )}
              {report && research && <SourcesEvidence research={research} report={report} />}
              {!report && research && (
                <div className="rounded-xl border border-border px-3 py-2">
                  <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <ExternalLink className="size-3.5" aria-hidden />
                    Live sources ({research.sources.length}) — everything the analysis drew from
                  </p>
                  {research.queries.length > 0 && (
                    <p className="mt-2 break-words font-mono text-[10px] leading-5 text-muted-foreground">
                      Searched: {research.queries.map((q, i) => `q${i + 1} “${q}”`).join(" · ")}
                    </p>
                  )}
                  <div className="mt-2 flex flex-col gap-3">
                    {SOURCE_GROUPS.map((group) => {
                      const groupSources = research.sources.filter((s) => s.kind === group.kind)
                      if (groupSources.length === 0) return null
                      return (
                        <div key={group.kind} className="flex flex-col gap-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {group.label} ({groupSources.length})
                          </p>
                          <ul className="flex flex-col gap-1.5">
                            {groupSources.map((source, index) => (
                              <li key={`${group.kind}-${index}-${source.url ?? source.title}`} className="rounded-xl border border-border bg-background/50 px-3 py-2">
                                <div className="flex flex-wrap items-start gap-1.5">
                                  {source.url ? (
                                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-xs font-medium text-primary hover:underline">
                                      {source.title}
                                    </a>
                                  ) : (
                                    <span className="min-w-0 flex-1 break-words text-xs font-medium text-foreground">{source.title}</span>
                                  )}
                                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    {KIND_BADGE[source.kind]}
                                  </span>
                                </div>
                                {(source.domain || source.date) && (
                                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                    {[source.domain, source.date].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                                {(source.snippet || source.excerpt) && (
                                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                                    {source.excerpt ?? source.snippet}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-5 text-muted-foreground">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    Search results reflect what the provider returned on {formatDay(research.collectedAt)} — open the
                    links and verify anything you intend to rely on.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {snapshot.creditsCharged > 0 && (
                  <span className="font-mono text-[10px] text-muted-foreground">{snapshot.creditsCharged} credits</span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <TriangleAlert className="size-3" aria-hidden /> AI draft grounded in live sources — verify before you rely on it
                </span>
                <Link href={`/project/${projectId}/studio`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Open in Studio <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Nothing drafted yet — run live research to create the first snapshot.</p>
          )}
        </details>

        <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="size-5 text-primary" aria-hidden />
              <h2 className="text-lg font-bold tracking-tight">Competitor Suggestions from Resources</h2>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                From Resources
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Read directly from this project&apos;s Resources cache, without generating or charging again. These
              suggestions are separate from the plan-derived snapshot above; neither is verified market research.
            </p>
            {!intelligence ? (
              <p role="status" className="mt-3 rounded-xl border border-border bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground">
                Resources intelligence could not be loaded. Your plan and saved snapshots remain available.
              </p>
            ) : intelligence.competitors.length === 0 ? (
              <p className="mt-3 rounded-xl border border-border bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground">
                No usable competitor suggestions are available in Resources yet.
              </p>
            ) : (
              <p className="mt-3 rounded-xl border border-border bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground">
                {intelligence.competitors.length} suggestion{intelligence.competitors.length === 1 ? "" : "s"} waiting
                for verification: {intelligence.competitors.slice(0, 4).map((c) => c.name).join(", ")}
                {intelligence.competitors.length > 4 ? ", …" : ""} — see the Competitors tab for full details.
              </p>
            )}
            <Link
              href={`/project/${projectId}/resources?section=competitors`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5"
            >
              Open Resources to investigate these leads <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Card>
          <Card>
            <div className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-500" aria-hidden />
              <h2 className="text-lg font-bold tracking-tight">Research Gaps</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Confirm the business and website, check current pricing and positioning, and retain supporting sources
              before making comparisons.
            </p>
            {parse.gaps.length > 0 && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Your latest snapshot also flags {parse.gaps.length} unconfirmed claim{parse.gaps.length === 1 ? "" : "s"} —
                listed under Opportunities &amp; Strategy.
              </p>
            )}
            <OutlineButton className="mt-4" onClick={() => setTab("Opportunities & Strategy")}>
              View detailed analysis <ArrowRight className="size-4" aria-hidden />
            </OutlineButton>
          </Card>
        </div>
      </section>

      {/* ── Competitors ──────────────────────────────────────────────────── */}
      <section role="tabpanel" hidden={tab !== "Competitors"} className={tab === "Competitors" ? "flex flex-col gap-5" : "hidden"}>
        <Card>
          <h2 className="text-lg font-bold tracking-tight">Competitors found in live research</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Only companies that appear in your live sources, cited per claim. Search results are what the provider
            returned on the day — verify before you rely on them.
          </p>
          {report ? (
            <CompetitorCards report={report} sources={sources} researchedAt={research?.collectedAt} />
          ) : parse.competitors.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              {research
                ? "No named competitors were established by the latest sources."
                : "Run live research to identify real competitors."}
            </p>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {parse.competitors.map((c, i) => (
                <div key={`${i}-${c.name}`} className="rounded-xl border border-border bg-background/50 p-4">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
                    <span className="break-words">{c.name}</span>
                  </p>
                  <div className="mt-2 min-w-0 text-sm leading-6 text-foreground/90">
                    <CofounderMarkdown>{c.detail}</CofounderMarkdown>
                  </div>
                  {c.citations.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {c.citations.map((domain) => (
                        <span key={domain} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          source: {domain}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        <CompetitorIntelligenceList intelligence={intelligence} projectId={projectId} />
      </section>

      {/* ── Compare ──────────────────────────────────────────────────────── */}
      <section role="tabpanel" hidden={tab !== "Compare"} className={tab === "Compare" ? "flex flex-col gap-5" : "hidden"}>
        {report && <ReportComparisons report={report} sources={sources} />}
        <Card>
          <h2 className="text-lg font-bold tracking-tight">Side-by-side comparison</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Your plan&apos;s own story versus each competitor suggestion. Plan cells are your positioning; competitor
            cells are unverified AI suggestions from Resources — every gap stays &quot;unknown&quot;, never invented.
          </p>
          {(intelligence?.competitors.length ?? 0) === 0 && parse.competitors.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              Nothing to compare yet — run live research or generate Resources suggestions first.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-semibold">Attribute</th>
                    <th className="py-2 pr-4 font-semibold text-primary">Your plan</th>
                    {(intelligence?.competitors ?? []).slice(0, 4).map((c, i) => (
                      <th key={`${i}-${c.name}`} className="py-2 pr-4 font-semibold">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="align-top">
                  {(
                    [
                      ["Positioning", positioning || "Not in plan yet", (c) => c.tagline],
                      ["Audience", targetUsers.join("; ") || "Not in plan yet", (c) => c.targetCustomer],
                      ["Differentiation", valueProposition || "Not in plan yet", (c) => c.competitiveEdge],
                      ["Pricing", "Not set in plan", (c) => c.pricing],
                      ["Business model", "Not in plan yet", (c) => c.businessModel],
                    ] as Array<[string, string, (c: NonNullable<typeof intelligence>["competitors"][number]) => string | undefined]>
                  ).map(([label, planCell, get]) => (
                    <tr key={label} className="border-b border-border/60">
                      <td className="py-3 pr-4 font-medium">{label}</td>
                      <td className="max-w-64 py-3 pr-4 break-words text-foreground/90">{planCell}</td>
                      {(intelligence?.competitors ?? []).slice(0, 4).map((c, i) => (
                        <td key={`${i}-${c.name}`} className="max-w-64 py-3 pr-4 break-words text-muted-foreground">
                          {get(c) || "Unknown"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(intelligence?.competitors.length ?? 0) > 4 && (
            <p className="mt-2 text-xs text-muted-foreground">Showing the first 4 suggestions — the Competitors tab lists them all.</p>
          )}
        </Card>
      </section>

      {/* ── Opportunities & Strategy ─────────────────────────────────────── */}
      <section role="tabpanel" hidden={tab !== "Opportunities & Strategy"} className={tab === "Opportunities & Strategy" ? "grid gap-5 lg:grid-cols-2" : "hidden"}>
        {report && <OpportunitiesPanel report={report} sources={sources} />}
        {!report && (
        <>
        <Card>
          <div className="flex items-center gap-2">
            <Lightbulb className="size-5 text-emerald-500" aria-hidden />
            <h2 className="text-lg font-bold tracking-tight">Differentiation opportunities</h2>
          </div>
          {parse.opportunities.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {parse.opportunities.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-6 text-foreground/90">
                  <Check className="mt-1 size-4 shrink-0 text-emerald-500" aria-hidden />
                  <span className="break-words">{o}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Run live research to surface opportunities grounded in your sources.</p>
          )}
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <HelpCircle className="size-5 text-primary" aria-hidden />
            <h2 className="text-lg font-bold tracking-tight">Questions to investigate next</h2>
          </div>
          {parse.questions.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {parse.questions.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-6 text-foreground/90">
                  <span className="mt-0.5 font-mono text-xs text-primary">{i + 1}.</span>
                  <span className="break-words">{q}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Follow-up questions from the snapshot appear here.</p>
          )}
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-amber-500" aria-hidden />
            <h2 className="text-lg font-bold tracking-tight">What the sources do not establish</h2>
          </div>
          {parse.gaps.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {parse.gaps.map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-6 text-foreground/90">
                  <TriangleAlert className="mt-1 size-4 shrink-0 text-amber-500" aria-hidden />
                  <span className="break-words">{g}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Confirm the business and website, check current pricing and positioning, and retain supporting sources
              before making comparisons.
            </p>
          )}
        </Card>
        </>
        )}
        <Card>
          <div className="flex items-center gap-2">
            <Target className="size-5 text-primary" aria-hidden />
            <h2 className="text-lg font-bold tracking-tight">Your strategic anchor</h2>
          </div>
          <div className="mt-3 flex flex-col gap-4 text-sm leading-6">
            {positioning ? (
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Market positioning</p>
                <div className="mt-1 min-w-0"><CofounderMarkdown>{positioning}</CofounderMarkdown></div>
              </div>
            ) : (
              <p className="text-muted-foreground">Add market positioning in the plan editor.</p>
            )}
            {valueProposition && (
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Value proposition</p>
                <div className="mt-1 min-w-0"><CofounderMarkdown>{valueProposition}</CofounderMarkdown></div>
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ── History ──────────────────────────────────────────────────────── */}
      <section role="tabpanel" hidden={tab !== "History"} className={tab === "History" ? "flex flex-col gap-4" : "hidden"}>
        <Card>
          <div className="flex items-center gap-2">
            <HistoryIcon className="size-5 text-primary" aria-hidden />
            <h2 className="text-lg font-bold tracking-tight">Draft history</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Every run is kept — AI-generated, from what the sources showed that day. Initially loads the latest 25
            snapshots; older drafts remain in your{" "}
            <Link className="text-primary underline" href={`/project/${projectId}/studio`}>Studio library</Link>.
            Automatic monitoring is not available yet — re-run research to refresh the landscape.
          </p>
          {[snapshot, ...history].filter((s): s is CompetitionSnapshotItem => Boolean(s)).length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              No drafts yet — the first live research run starts your history.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {[snapshot, ...history].filter((s): s is CompetitionSnapshotItem => Boolean(s)).map((item, i) => (
                <details key={item.id} className="rounded-xl border border-border bg-background/50 px-4 py-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{formatDay(item.createdAt)}</span>
                    <span className="min-w-0 flex-1 break-words font-medium text-foreground">{item.title}</span>
                    {i === 0 && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">current</span>
                    )}
                    {item.research && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{item.research.sources.length} sources</span>
                    )}
                    {totalRunCost(item) > 0 && (
                      <span className="font-mono text-[10px]">{totalRunCost(item)} credits (search + AI)</span>
                    )}
                    {item.competitionReport && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        structured report
                      </span>
                    )}
                  </summary>
                  <div className="mt-3 min-w-0 text-sm leading-6 text-foreground/90">
                    {item.competitionReport ? (
                      <StructuredReportBody
                        report={item.competitionReport}
                        sources={item.research?.sources ?? []}
                        research={item.research}
                      />
                    ) : (
                      <CofounderMarkdown>{item.body}</CofounderMarkdown>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  )
}