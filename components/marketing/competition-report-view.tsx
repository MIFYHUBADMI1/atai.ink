"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Banknote,
  CalendarDays,
  Check,
  ExternalLink,
  Globe,
  HelpCircle,
  Lightbulb,
  Link2,
  MapPin,
  PieChart as PieChartIcon,
  Search,
  Target,
  TrendingUp,
  TriangleAlert,
  Trophy,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type {
  ClaimStatus,
  CompetitionReport,
  ReportClaim,
  ReportFact,
  ReportMarketFigure,
  ReportOpportunity,
  VerificationStatus,
} from "@/lib/marketing/competition-report"
import {
  CLAIM_STATUS_LABELS,
  COMPETITOR_CATEGORY_LABELS,
  SOURCE_CATEGORY_LABELS,
} from "@/lib/marketing/competition-report"
import {
  claimsCitingSource,
  competitorStats,
  formatDay,
  formatStamp,
  groupFiguresByGeography,
  reportCategoryDistribution,
  sourceCategoryDistribution,
  sourceRelevanceDistribution,
  type CompetitionResearchView,
  type CompetitionSourceView,
  type CountSlice,
} from "@/lib/marketing/competition-view-model"
import { cn } from "@/lib/utils"

const CHART_COLORS = ["#7c5cfa", "#38a1f7", "#10b981", "#f59e0b", "#94a3b8", "#cbd5e1", "#f472b6", "#22d3ee"]

const STATUS_STYLES: Record<ClaimStatus, string> = {
  verified_fact: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  ai_interpretation: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  ai_suggestion: "bg-primary/10 text-primary",
  founder_provided: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  unknown: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  outdated: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
}

export function ClaimBadge({ status }: { status: ClaimStatus }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLES[status])}>
      {CLAIM_STATUS_LABELS[status]}
    </span>
  )
}

const VERIFICATION_STYLES: Record<VerificationStatus, string> = {
  verified: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  ai_suggestion: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  research_needed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
}

export function VerificationBadge({ verification }: { verification: VerificationStatus }) {
  const label = verification === "verified" ? "Verified" : verification === "ai_suggestion" ? "AI suggestion" : "Research needed"
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", VERIFICATION_STYLES[verification])}>{label}</span>
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}>{children}</div>
}

function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

/** Donut of REAL counts (categories, sources) — never estimated shares. */
export function CountDonut({ slices, centerCount, centerLabel }: { slices: CountSlice[]; centerCount: number; centerLabel: string }) {
  const mounted = useMounted()
  const data = useMemo(() => slices.filter((s) => s.count > 0), [slices])
  if (!mounted) return <div className="size-44" aria-hidden />
  if (data.length === 0) {
    return (
      <div className="flex size-44 items-center justify-center rounded-full border border-dashed border-border text-center text-xs text-muted-foreground">
        No data yet
      </div>
    )
  }
  return (
    <div className="relative size-44 shrink-0" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="label" innerRadius="64%" outerRadius="96%" paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
            {data.map((entry, i) => (
              <Cell key={entry.key} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "var(--foreground)" }}
            formatter={(value: unknown, name: unknown) => [`${value}`, String(name)]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{centerCount}</span>
        <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
      </div>
    </div>
  )
}

/** Horizontal count bars — widths are proportional to REAL counts, never shares. */
function CountBars({ slices, empty }: { slices: CountSlice[]; empty: string }) {
  const present = slices.filter((s) => s.count > 0)
  const max = Math.max(1, ...present.map((s) => s.count))
  if (present.length === 0) return <p className="mt-3 text-sm leading-6 text-muted-foreground">{empty}</p>
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {present.map((slice, i) => (
        <li key={slice.key} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-words text-foreground/90">{slice.label}</span>
            <span className="shrink-0 font-bold">{slice.count}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(4, Math.round((slice.count / max) * 100))}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub: string
}) {
  return (
    <Card className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon} {label}
        </p>
        <p className="mt-2 text-2xl font-bold">{value}</p>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{sub}</p>
      </div>
    </Card>
  )
}

function EvidenceChips({ evidence, byId }: { evidence: Array<{ sourceId: string }>; byId: Map<string, CompetitionSourceView> }) {
  return (
    <>
      {evidence.map((e) => {
        const source = byId.get(e.sourceId)
        if (!source) return null
        return source.url ? (
          <a
            key={e.sourceId}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-primary hover:underline"
          >
            {e.sourceId}: {source.domain ?? source.title}
          </a>
        ) : (
          <span key={e.sourceId} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {e.sourceId}: {source.title}
          </span>
        )
      })}
    </>
  )
}

export function ClaimList({ claims, empty }: { claims: ReportClaim[]; empty: string }) {
  if (claims.length === 0) return <p className="mt-3 text-sm leading-6 text-muted-foreground">{empty}</p>
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {claims.map((claim, i) => (
        <li key={i} className="flex items-start gap-2 text-sm leading-6 text-foreground/90">
          <Check className="mt-1 size-4 shrink-0 text-emerald-500" aria-hidden />
          <span className="min-w-0 break-words">
            <ClaimBadge status={claim.status} /> <span className="ml-1">{claim.text}</span>
            {claim.evidence.length > 0 && (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">({claim.evidence.map((e) => e.sourceId).join(", ")})</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ExecutiveSummary({
  report,
  research,
  createdAt,
  totalCost,
}: {
  report: CompetitionReport
  research?: CompetitionResearchView
  createdAt: number
  totalCost: number
}) {
  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-bold tracking-tight">Live Research Complete</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {report.competitors.length} competitor{report.competitors.length === 1 ? "" : "s"} classified ·{" "}
              {report.keyFindings.length} key finding{report.keyFindings.length === 1 ? "" : "s"} ·{" "}
              {report.opportunities.length} opportunit{report.opportunities.length === 1 ? "y" : "ies"}
            </p>
          </div>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Research run: {formatStamp(research?.collectedAt ?? createdAt)}
          {research ? ` · ${research.sources.length} sources` : ""} · run cost {totalCost} credits
        </p>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Key findings</h3>
          <ClaimList claims={report.keyFindings} empty="The sources did not establish key findings yet." />
        </div>
        <div>
          <h3 className="text-sm font-bold">Research limitations</h3>
          {report.limitations.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {report.limitations.map((limitation, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                  <TriangleAlert className="mt-1 size-4 shrink-0 text-amber-500" aria-hidden />
                  <span className="break-words">{limitation}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">No limitations recorded.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Stats + distribution charts for the Competitors tab — every number is a real count. */
export function CompetitorsOverview({ report }: { report: CompetitionReport }) {
  const stats = useMemo(() => competitorStats(report), [report])
  const categories = useMemo(() => reportCategoryDistribution(report), [report])
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Trophy className="size-4 shrink-0 text-amber-500" aria-hidden />}
          label="Competitors classified"
          value={stats.active}
          sub={`${stats.total} entries reviewed, including not-a-competitor checks`}
        />
        <StatCard
          icon={<Link2 className="size-4 shrink-0 text-blue-500" aria-hidden />}
          label="Evidence coverage"
          value={stats.citedSources}
          sub={`distinct live sources cited · ${stats.withWebsite}/${stats.total} have a website`}
        />
        <StatCard
          icon={<Banknote className="size-4 shrink-0 text-emerald-500" aria-hidden />}
          label="Pricing found"
          value={stats.withPricing}
          sub={stats.withPricing > 0 ? "competitors with actual prices from sources" : "no prices stated in the sources yet"}
        />
        <StatCard
          icon={<TrendingUp className="size-4 shrink-0 text-primary" aria-hidden />}
          label="Valuation / funding"
          value={stats.withValuation + stats.withFunding}
          sub={
            stats.withValuation + stats.withFunding > 0
              ? `${stats.withValuation} valuation · ${stats.withFunding} funding facts, as reported`
              : "no valuations or funding stated in the sources"
          }
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight">Who is in the field</h2>
            <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Competitor categories
            </span>
          </div>
          <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
            <CountDonut slices={categories} centerCount={stats.active} centerLabel="Competitors" />
            {categories.length > 0 ? (
              <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
                {categories.map((s, i) => (
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
            )}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            Real counts of classified competitors — not market share. Nothing here is estimated.
          </p>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight">How solid is the evidence</h2>
            <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Verification status
            </span>
          </div>
          <CountBars
            slices={stats.verificationDistribution}
            empty="No competitors classified yet — verification counts appear after live research."
          />
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            Verified means a competitor-site source backs the entry; AI suggestions still need your confirmation;
            research-needed entries have no eligible evidence yet.
          </p>
        </Card>
      </div>
    </>
  )
}

function FactRow({ label, fact, byId }: { label: string; fact: ReportFact; byId: Map<string, CompetitionSourceView> }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
          As reported
        </span>
        {fact.amount !== undefined && (
          <strong className="text-foreground">
            {fact.amount}
            {fact.currency ? ` ${fact.currency}` : ""}
          </strong>
        )}
        {fact.asOfDate && <span className="font-mono text-[10px] text-muted-foreground">{fact.asOfDate}</span>}
      </p>
      <p className="mt-1 break-words text-xs leading-5 text-foreground/90">{fact.summary}</p>
      <p className="mt-1 flex flex-wrap gap-1">
        <EvidenceChips evidence={fact.evidence} byId={byId} />
      </p>
    </div>
  )
}

export function CompetitorCards({
  report,
  sources,
  researchedAt,
}: {
  report: CompetitionReport
  sources: CompetitionSourceView[]
  researchedAt?: number
}) {
  const byId = useMemo(() => new Map(sources.map((s, i) => [`s${i + 1}`, s])), [sources])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [verification, setVerification] = useState("all")
  const [sort, setSort] = useState("name")

  const filteredCompetitors = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const confidenceRank = { high: 3, medium: 2, low: 1 } as const
    return report.competitors
      .filter((competitor) => {
        if (category !== "all" && competitor.category !== category) return false
        if (verification !== "all" && competitor.verification !== verification) return false
        if (!needle) return true
        return [
          competitor.name,
          competitor.whyItMayCompete,
          competitor.targetAudience,
          competitor.productsServices,
          competitor.location,
        ].some((value) => value?.toLowerCase().includes(needle))
      })
      .sort((a, b) => {
        if (sort === "confidence") return confidenceRank[b.confidence] - confidenceRank[a.confidence]
        if (sort === "category") return COMPETITOR_CATEGORY_LABELS[a.category].localeCompare(COMPETITOR_CATEGORY_LABELS[b.category])
        return a.name.localeCompare(b.name)
      })
  }, [report.competitors, query, category, verification, sort])

  if (report.competitors.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
        No named competitors were established by the latest sources.
      </p>
    )
  }
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/50 p-3 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search competitors</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search competitors, audiences, products…"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-medium">Type</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-44">
            <option value="all">All types</option>
            {Object.entries(COMPETITOR_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-medium">Evidence</span>
          <select value={verification} onChange={(event) => setVerification(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-40">
            <option value="all">All evidence</option>
            <option value="verified">Verified</option>
            <option value="ai_suggestion">AI suggestion</option>
            <option value="research_needed">Needs verification</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-medium">Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-36">
            <option value="name">Name</option>
            <option value="category">Type</option>
            <option value="confidence">Confidence</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {filteredCompetitors.length} of {report.competitors.length} classified competitor{report.competitors.length === 1 ? "" : "s"}.
      </p>
      {filteredCompetitors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No competitors match these filters. Clear the search or choose a broader category.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
      {filteredCompetitors.map((competitor, i) => {
        const moneyFacts = [
          ["Pricing", competitor.pricing],
          ["Valuation", competitor.valuation],
          ["Funding", competitor.funding],
        ] as const
        const hasMoneyFact = moneyFacts.some(([, fact]) => fact)
        return (
          <div key={`${i}-${competitor.name}`} className="flex flex-col rounded-xl border border-border bg-background/50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
              <p className="min-w-0 flex-1 break-words text-sm font-bold">{competitor.name}</p>
              <VerificationBadge verification={competitor.verification} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {COMPETITOR_CATEGORY_LABELS[competitor.category]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                confidence: {competitor.confidence}
              </span>
              {researchedAt ? (
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  researched {formatDay(researchedAt)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 break-words text-sm leading-6 text-foreground/90">{competitor.whyItMayCompete}</p>
            <dl className="mt-2 flex flex-col gap-1 text-xs leading-5 text-muted-foreground">
              {competitor.targetAudience && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-foreground/70">Audience:</dt>
                  <dd className="min-w-0 break-words">{competitor.targetAudience}</dd>
                </div>
              )}
              {competitor.productsServices && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-foreground/70">Products / services:</dt>
                  <dd className="min-w-0 break-words">{competitor.productsServices}</dd>
                </div>
              )}
              {competitor.location && (
                <div className="flex gap-1.5">
                  <dt className="flex shrink-0 items-center gap-1 font-semibold text-foreground/70">
                    <MapPin className="size-3" aria-hidden /> Location:
                  </dt>
                  <dd className="min-w-0 break-words">{competitor.location}</dd>
                </div>
              )}
              {competitor.founded && (
                <div className="flex gap-1.5">
                  <dt className="flex shrink-0 items-center gap-1 font-semibold text-foreground/70">
                    <CalendarDays className="size-3" aria-hidden /> Founded:
                  </dt>
                  <dd className="min-w-0 break-words">{competitor.founded}</dd>
                </div>
              )}
            </dl>
            {hasMoneyFact ? (
              <div className="mt-3 flex flex-col gap-2">
                {moneyFacts.map(([label, fact]) => (fact ? <FactRow key={label} label={label} fact={fact} byId={byId} /> : null))}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                No pricing, valuation or funding figures were stated in the sources — nothing is estimated here.
              </p>
            )}
            {(competitor.strengths?.length || competitor.weaknesses?.length) ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {competitor.strengths && competitor.strengths.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
                      Strengths · AI interpretation
                    </p>
                    <ul className="mt-1 flex flex-col gap-1 text-xs leading-5 text-foreground/90">
                      {competitor.strengths.map((s, j) => (
                        <li key={j} className="flex gap-1.5">
                          <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" aria-hidden />
                          <span className="break-words">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {competitor.weaknesses && competitor.weaknesses.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">
                      Weaknesses · AI interpretation
                    </p>
                    <ul className="mt-1 flex flex-col gap-1 text-xs leading-5 text-foreground/90">
                      {competitor.weaknesses.map((w, j) => (
                        <li key={j} className="flex gap-1.5">
                          <TriangleAlert className="mt-0.5 size-3 shrink-0 text-amber-500" aria-hidden />
                          <span className="break-words">{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              {competitor.website && (
                <a
                  href={competitor.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-primary hover:underline"
                >
                  <Link2 className="size-3" aria-hidden /> website
                </a>
              )}
              <EvidenceChips evidence={competitor.evidence} byId={byId} />
            </div>
          </div>
        )
      })}
        </div>
      )}
    </div>
  )
}

interface ComparableFigureGroup {
  figures: ReportMarketFigure[]
  unit?: string
  currency?: string
  status: ReportMarketFigure["status"]
}

/** Only comparable reported figures (same geography group, unit and currency) may share a chart. */
function comparableFigureGroups(figures: ReportMarketFigure[]): ComparableFigureGroup[] {
  const groups = new Map<string, ComparableFigureGroup>()
  for (const figure of figures) {
    if (typeof figure.value !== "number") continue
    const key = `${figure.status}|${figure.unit ?? ""}|${figure.currency ?? ""}`
    const group = groups.get(key) ?? { figures: [], unit: figure.unit, currency: figure.currency, status: figure.status }
    group.figures.push(figure)
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.figures.length >= 2)
}

function MarketFigureBars({ group, geographyLabel }: { group: ComparableFigureGroup; geographyLabel: string }) {
  const mounted = useMounted()
  const data = useMemo(
    () =>
      group.figures.map((figure, index) => ({
        key: `${index}-${figure.label}`,
        label: figure.label.length > 42 ? `${figure.label.slice(0, 39)}…` : figure.label,
        value: figure.value ?? 0,
      })),
    [group.figures],
  )
  if (!mounted || data.length < 2) return null
  return (
    <div className="mt-4">
      <div className="h-44 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.08} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "var(--foreground)" }}
            />
            <Bar dataKey="value" fill="#7c5cfa" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        {CLAIM_STATUS_LABELS[group.status]} figures for {geographyLabel}
        {group.unit ? ` in ${group.unit}` : ""}{group.currency ? ` (${group.currency})` : ""}.
        These are point-in-time source values, not a constructed trend.
      </p>
    </div>
  )
}

export function MarketIntelligence({ report, sources }: { report: CompetitionReport; sources: CompetitionSourceView[] }) {
  const byId = useMemo(() => new Map(sources.map((s, i) => [`s${i + 1}`, s])), [sources])
  const groups = useMemo(() => groupFiguresByGeography(report), [report])
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Globe className="size-5 text-primary" aria-hidden />
        <h2 className="text-lg font-bold tracking-tight">Market intelligence</h2>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Every figure keeps its own geographic scope, currency and dates. Figures from different geographies are never
        combined into one statistic.
      </p>
      {groups.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          The sources did not establish market figures. No chart is drawn from unsupported estimates.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {groups.map((group) => (
            <div key={`${group.scope}-${group.label}`} className="rounded-xl border border-border bg-background/50 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                  {group.scope}
                </span>
                {group.label}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {group.figures.map((figure, i) => {
                  const source = byId.get(figure.sourceId)
                  return (
                    <li key={i} className="flex flex-wrap items-start gap-2 text-sm leading-6 text-foreground/90">
                      <ClaimBadge status={figure.status} />
                      <span className="min-w-0 flex-1 break-words">
                        {figure.label}
                        {figure.value !== undefined && (
                          <strong className="ml-1">
                            {figure.value}
                            {figure.unit ? ` ${figure.unit}` : ""}
                            {figure.currency ? ` (${figure.currency})` : ""}
                          </strong>
                        )}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                          {[figure.publicationDate, figure.forecastPeriod].filter(Boolean).join(" · ")}
                        </span>
                        {source && (
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            (source: {source.domain ?? source.title})
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {comparableFigureGroups(group.figures).map((chartGroup, chartIndex) => (
                <MarketFigureBars key={`${chartGroup.unit ?? "unit"}-${chartGroup.currency ?? "currency"}-${chartIndex}`} group={chartGroup} geographyLabel={group.label} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Customer behaviour</h3>
          <ClaimList claims={report.customerBehaviour} empty="No customer-behaviour findings in the sources." />
        </div>
        <div>
          <h3 className="text-sm font-bold">News & funding</h3>
          <ClaimList claims={report.news} empty="No recent news or funding events in the sources." />
        </div>
      </div>
    </Card>
  )
}

/** Evidence-linked comparison matrices — missing cells stay unknown, never inferred. */
export function ReportComparisons({ report, sources = [] }: { report: CompetitionReport; sources?: CompetitionSourceView[] }) {
  const sourceById = useMemo(() => new Map(sources.map((s, i) => [`s${i + 1}`, s])), [sources])
  const sections = [
    { title: "Feature comparison", rows: report.featureComparison, empty: "No feature details were established by the sources — nothing is invented here." },
    { title: "Pricing comparison", rows: report.pricingComparison, empty: "No actual prices were found in the sources. The pricing search keeps looking on every run — nothing is guessed here." },
  ]
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">Comparisons from live research</h2>
        <span className="rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {report.featureComparison.length} feature · {report.pricingComparison.length} pricing attributes
        </span>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Only attributes the sources actually describe. Missing cells stay unknown; swipe or scroll sideways on small screens.
      </p>
      <div className="mt-4 flex flex-col gap-6">
        {sections.map((section) => {
          const competitors = [...new Set(section.rows.flatMap((row) => row.competitors.map((cell) => cell.name)))]
          return (
            <div key={section.title}>
              <h3 className="text-sm font-bold">{section.title}</h3>
              {section.rows.length === 0 ? (
                <p className="mt-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{section.empty}</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-background/60">
                        <th className="px-3 py-2 font-semibold">Attribute</th>
                        <th className="px-3 py-2 font-semibold text-primary">Your plan</th>
                        {competitors.map((name) => (
                          <th key={name} className="max-w-44 px-3 py-2 font-semibold">{name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="align-top">
                      {section.rows.map((row) => (
                        <tr key={row.attribute} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-3 font-medium">{row.attribute}</td>
                          <td className="max-w-56 px-3 py-3 break-words text-foreground/90">{row.yours ?? "Unknown"}</td>
                          {competitors.map((name) => {
                            const cell = row.competitors.find((candidate) => candidate.name === name)
                            const source = cell?.sourceId ? sourceById.get(cell.sourceId) : undefined
                            return (
                              <td key={`${row.attribute}-${name}`} className="max-w-56 px-3 py-3 break-words text-muted-foreground">
                                {cell ? cell.value : "Unknown"}
                                {source?.url && (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                                  >
                                    <Link2 className="size-3" aria-hidden /> evidence
                                  </a>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function OpportunityEstimateBadges({ opportunity }: { opportunity: ReportOpportunity }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <ClaimBadge status={opportunity.status} />
      {opportunity.impact && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {opportunity.impact === "high" ? "High impact" : "Lower impact"} · AI estimate
        </span>
      )}
      {opportunity.effort && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {opportunity.effort === "high" ? "High effort" : "Low effort"} · AI estimate
        </span>
      )}
      {opportunity.confidence && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          confidence: {opportunity.confidence}
        </span>
      )}
    </div>
  )
}

function OpportunityCard({ opportunity, byId }: { opportunity: ReportOpportunity; byId: Map<string, CompetitionSourceView> }) {
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <p className="break-words text-sm font-semibold leading-6 text-foreground">{opportunity.text}</p>
      <OpportunityEstimateBadges opportunity={opportunity} />
      {opportunity.nextStep && (
        <p className="break-words text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground/80">Next step:</span> {opportunity.nextStep}
        </p>
      )}
      {opportunity.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <EvidenceChips evidence={opportunity.evidence} byId={byId} />
        </div>
      )}
    </article>
  )
}

const OPPORTUNITY_QUADRANTS = [
  { impact: "high", effort: "low", title: "Quick wins", description: "High estimated impact with lower estimated effort." },
  { impact: "high", effort: "high", title: "Strategic bets", description: "High estimated impact that likely needs more work." },
  { impact: "low", effort: "low", title: "Incremental gains", description: "Lower impact and effort; useful when capacity is spare." },
  { impact: "low", effort: "high", title: "Deprioritize", description: "Lower estimated impact with higher estimated effort." },
] as const

export function OpportunitiesPanel({ report, sources = [] }: { report: CompetitionReport; sources?: CompetitionSourceView[] }) {
  const byId = useMemo(() => new Map(sources.map((s, i) => [`s${i + 1}`, s])), [sources])
  const unprioritized = report.opportunities.filter((opportunity) => !opportunity.impact || !opportunity.effort)
  return (
    <>
      <Card>
        <div className="flex items-center gap-2">
          <Lightbulb className="size-5 text-emerald-500" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">Differentiation opportunities</h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {report.opportunities.length}
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Impact and effort are AI estimates from the cited evidence, not proven financial outcomes. Opportunities without both estimates stay in the unprioritized list.
        </p>
        {report.opportunities.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            Run live research to surface opportunities grounded in your sources.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {OPPORTUNITY_QUADRANTS.map((quadrant) => {
              const items = report.opportunities.filter((opportunity) => opportunity.impact === quadrant.impact && opportunity.effort === quadrant.effort)
              return (
                <section key={`${quadrant.impact}-${quadrant.effort}`} className="rounded-xl border border-border bg-background/50 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold">{quadrant.title}</h3>
                    <span className="font-mono text-[10px] text-muted-foreground">{items.length}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{quadrant.description}</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {items.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">No opportunities estimated here.</p>
                    ) : items.map((opportunity, index) => (
                      <OpportunityCard key={`${index}-${opportunity.text}`} opportunity={opportunity} byId={byId} />
                    ))}
                  </div>
                </section>
              )
            })}
            <section className="rounded-xl border border-dashed border-border bg-background/50 p-3 lg:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold">Needs prioritization</h3>
                <span className="font-mono text-[10px] text-muted-foreground">{unprioritized.length}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">These opportunities are supported by the report but do not yet have both impact and effort estimates.</p>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {unprioritized.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Every opportunity has an impact/effort estimate.</p>
                ) : unprioritized.map((opportunity, index) => (
                  <OpportunityCard key={`unprioritized-${index}-${opportunity.text}`} opportunity={opportunity} byId={byId} />
                ))}
              </div>
            </section>
          </div>
        )}
      </Card>
      <Card>
        <div className="flex items-center gap-2">
          <Target className="size-5 text-primary" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">Positioning read from the sources</h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {report.positioningNotes.length}
          </span>
        </div>
        <ClaimList claims={report.positioningNotes} empty="No positioning notes were established by the sources." />
      </Card>
      <Card>
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-5 text-amber-500" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">What the sources do not establish</h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {report.gaps.length}
          </span>
        </div>
        {report.gaps.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-3">
            {report.gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-6 text-foreground/90">
                <TriangleAlert className="mt-1 size-4 shrink-0 text-amber-500" aria-hidden />
                <span className="break-words">{gap}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nothing flagged.</p>
        )}
      </Card>
      <Card>
        <div className="flex items-center gap-2">
          <HelpCircle className="size-5 text-primary" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">Questions to investigate next</h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {report.questions.length}
          </span>
        </div>
        {report.questions.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-3">
            {report.questions.map((question, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-6 text-foreground/90">
                <span className="mt-0.5 font-mono text-xs text-primary">{i + 1}.</span>
                <span className="break-words">{question}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Follow-up questions appear here.</p>
        )}
      </Card>
    </>
  )
}

export function SourcesEvidence({ research, report }: { research: CompetitionResearchView; report?: CompetitionReport }) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [relevance, setRelevance] = useState("all")
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return research.sources
      .map((source, index) => ({ source, id: `s${index + 1}` }))
      .filter(({ source }) => {
        if (category !== "all" && (source.category ?? "uncategorized") !== category) return false
        if (relevance !== "all" && (source.relevance ?? "unclassified") !== relevance) return false
        if (!needle) return true
        return [source.title, source.domain, source.snippet, source.excerpt, source.provider, source.relevanceReason]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle))
      })
  }, [research.sources, query, category, relevance])
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <ExternalLink className="size-3.5" aria-hidden />
        Sources & evidence ({research.sources.length}) — retrieval {formatDay(research.collectedAt)}
      </p>
      {research.queries.length > 0 && (
        <p className="mt-2 break-words font-mono text-[10px] leading-5 text-muted-foreground">
          Searched: {research.queries.map((q, i) => `q${i + 1} “${q}”`).join(" · ")}
        </p>
      )}
      <div className="mt-3 grid gap-2 rounded-xl border border-border bg-background/50 p-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="relative min-w-0">
          <span className="sr-only">Search sources</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, domains, excerpts…"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-medium">Type</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-w-0 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="all">All types</option>
            {Object.entries(SOURCE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-medium">Relevance</span>
          <select value={relevance} onChange={(event) => setRelevance(event.target.value)} className="min-w-0 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="all">All relevance</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="irrelevant">Irrelevant</option>
            <option value="unclassified">Unclassified</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        Showing {rows.length} of {research.sources.length} sources.
      </p>
      <div className="mt-2 flex flex-col gap-3">
        {rows.map(({ source, id }) => {
          const supported = report ? claimsCitingSource(report, id) : []
          return (
            <div key={`${id}-${source.url ?? source.title}`} className="rounded-xl border border-border bg-background/50 px-3 py-2">
              <div className="flex flex-wrap items-start gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">{id}</span>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-xs font-medium text-primary hover:underline">
                    {source.title}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 break-words text-xs font-medium text-foreground">{source.title}</span>
                )}
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {source.category ? SOURCE_CATEGORY_LABELS[source.category] : source.kind}
                </span>
                {source.relevance && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]",
                      source.relevance === "irrelevant"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {source.relevance}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {[source.domain, source.date ? `published ${source.date}` : null, `retrieved ${formatDay(research.collectedAt)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {source.relevanceReason && (
                <p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">{source.relevanceReason}</p>
              )}
              {(source.snippet || source.excerpt) && (
                <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{source.excerpt ?? source.snippet}</p>
              )}
              {supported.length > 0 && (
                <p className="mt-1 break-words text-[11px] leading-5 text-foreground/80">
                  Supports: {supported.join(" · ")}
                </p>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            No sources match these filters. Clear the search or choose a broader source type.
          </p>
        )}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-5 text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
        Search results reflect what the provider returned on {formatDay(research.collectedAt)} — open the links and
        verify anything you intend to rely on.
      </p>
    </div>
  )
}

/** First-class Sources & Evidence tab: real-count stats, distributions, queries, full ledger. */
export function SourcesPanel({ research, report }: { research: CompetitionResearchView; report?: CompetitionReport }) {
  const categorySlices = useMemo(() => sourceCategoryDistribution(research.sources), [research.sources])
  const relevanceSlices = useMemo(() => sourceRelevanceDistribution(research.sources), [research.sources])
  const classified = research.sources.some((s) => s.relevance)
  const eligible = research.sources.filter(
    (s) => s.relevance && s.relevance !== "irrelevant" && s.category !== "data_tool",
  ).length
  const leadsOnly = research.sources.length - eligible
  const perQuery = research.queries.map((query, i) => ({
    query,
    count: research.sources.filter((s) => s.queryIndex === i).length,
  }))
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Search className="size-4 shrink-0 text-blue-500" aria-hidden />}
          label="Sources retrieved"
          value={research.sources.length}
          sub={`retrieved ${formatDay(research.collectedAt)}`}
        />
        <StatCard
          icon={<Check className="size-4 shrink-0 text-emerald-500" aria-hidden />}
          label="Evidence-eligible"
          value={classified ? eligible : "—"}
          sub={classified ? "sources that may back a claim" : "legacy run — sources were not classified"}
        />
        <StatCard
          icon={<TriangleAlert className="size-4 shrink-0 text-amber-500" aria-hidden />}
          label="Leads only"
          value={classified ? leadsOnly : "—"}
          sub={classified ? "irrelevant results and data tools — never evidence" : "legacy run — sources were not classified"}
        />
        <StatCard
          icon={<PieChartIcon className="size-4 shrink-0 text-primary" aria-hidden />}
          label="Queries run"
          value={research.queries.length}
          sub="every search is recorded below"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight">What the searches returned</h2>
            <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Source categories
            </span>
          </div>
          <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
            <CountDonut slices={categorySlices} centerCount={research.sources.length} centerLabel="Sources" />
            <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
              {categorySlices.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
                  <span className="min-w-0 flex-1 break-words text-foreground/90">{s.label}</span>
                  <span className="font-bold">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            Real counts of retrieved sources by classification — not market share or coverage estimates.
          </p>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight">Relevance to your business</h2>
            <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Relevance scoring
            </span>
          </div>
          <CountBars slices={relevanceSlices} empty="No relevance scoring recorded for this run." />
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-sm font-bold">Queries run</h3>
            {perQuery.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No queries recorded.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {perQuery.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs leading-5">
                    <span className="shrink-0 font-mono text-[10px] text-primary">q{i + 1}</span>
                    <span className="min-w-0 flex-1 break-words text-foreground/90">{q.query}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{q.count} sources</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
      <Card>
        <SourcesEvidence research={research} report={report} />
      </Card>
    </>
  )
}

export function StructuredReportBody({
  report,
  sources,
  research,
}: {
  report: CompetitionReport
  sources: CompetitionSourceView[]
  research?: CompetitionResearchView
}) {
  return (
    <div className="flex flex-col gap-4">
      <CompetitorCards report={report} sources={sources} researchedAt={research?.collectedAt} />
      <MarketIntelligence report={report} sources={sources} />
      <OpportunitiesPanel report={report} sources={sources} />
    </div>
  )
}