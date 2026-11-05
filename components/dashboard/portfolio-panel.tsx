"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, CircleAlert, Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react"
import { BreakdownBarsChart, MoneyTrendChart } from "@/components/finances/finance-trend-charts"
import { compact, money, when } from "@/components/finances/project-finances-view"
import { Skeleton } from "@/components/ui/skeleton"
import { usePortfolioOverview, type PortfolioOverview, type PortfolioRange } from "@/lib/client/api"
import { cn } from "@/lib/utils"

/**
 * Portfolio panel — earnings and runtime spend across every business the user
 * owns, charted with the same recharts components the finance pages use.
 *
 * Units are never blended: attributed earnings are money in the currency they
 * arrived in, runtime spend is credits. Credits have no single purchase price,
 * so there is no honest way to subtract one from the other — the panel shows
 * both, each in its own unit, and says so. Every figure is computed
 * server-side; the browser only renders it.
 */

const RANGES: { days: PortfolioRange; label: string }[] = [
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
]

function StatBlock({
  label,
  value,
  sub,
  icon,
  tone = "default",
}: {
  label: string
  value: string
  sub: ReactNode
  icon?: ReactNode
  tone?: "default" | "muted"
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon ? <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight tabular-nums",
          tone === "muted" && "text-base font-medium text-muted-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function ChangeIndicator({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span>No spend in the window before this one, so there is no comparison.</span>
  }
  if (pct === 0) return <span>Flat vs the prior window.</span>
  const up = pct > 0
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      {up ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
      {up ? `+${pct}%` : `${pct}%`} vs the prior window
    </span>
  )
}

export function PortfolioPanel() {
  const [days, setDays] = useState<PortfolioRange>(30)
  const { overview, error, isLoading } = usePortfolioOverview(days)

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Portfolio earnings and spend">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Portfolio</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">Earnings and runtime spend</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Every business you own, combined. Earnings are money as received; runtime spend is credits — the two
            are shown separately because credits have no single cash value.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div
            className="inline-flex rounded-lg border border-border bg-background p-0.5"
            role="group"
            aria-label="Chart window"
          >
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                onClick={() => setDays(range.days)}
                aria-pressed={days === range.days}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  days === range.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
          <Link
            href="/finances"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Full business finances <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">We couldn't load your portfolio numbers.</p>
          <p className="mt-1 text-muted-foreground">
            {error.message || "Check your connection and refresh the page."}
          </p>
        </div>
      ) : isLoading && !overview ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : overview ? (
        <PortfolioBody overview={overview} />
      ) : null}
    </section>
  )
}

function PortfolioBody({ overview }: { overview: PortfolioOverview }) {
  const { totals, daily } = overview
  const currency = totals.currencies[0] ?? null
  const mixedCurrencies = totals.currencies.length > 1
  const earningsUnavailable = totals.earningsMinor === null
  const hasSpend = totals.creditsCharged > 0 || totals.requests > 0
  const hasEarnings = totals.earningsMinor !== null && totals.earningsMinor > 0

  const trendPoints = daily.map((d) => ({
    date: d.date,
    costCredits: d.creditsCharged,
    earnings: d.earningsMinor / 100,
    providerCostUsd: d.providerCostUsd,
  }))

  const businessBars = overview.byProject
    .slice()
    .sort((a, b) => b.creditsCharged - a.creditsCharged)
    .filter((row) => row.creditsCharged > 0)
    .slice(0, 8)
    .map((row) => ({ key: row.projectName, value: row.creditsCharged }))

  const activeBusinesses = overview.byProject
    .slice()
    .sort((a, b) => b.creditsCharged - a.creditsCharged || (b.earningsMinor ?? 0) - (a.earningsMinor ?? 0))
    .slice(0, 6)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          label={`Attributed earnings (${overview.days}d)`}
          value={earningsUnavailable ? "unavailable" : money(totals.earningsMinor, currency)}
          sub={
            earningsUnavailable
              ? "No earnings feed has reported for these projects yet"
              : `${compact(totals.succeededPayments)} succeeded · ${compact(totals.pendingPayments)} pending`
          }
          icon={<TrendingUp aria-hidden />}
          tone={earningsUnavailable ? "muted" : "default"}
        />
        <StatBlock
          label={`Runtime spend (${overview.days}d)`}
          value={`${compact(totals.creditsCharged)} credits`}
          sub={<ChangeIndicator pct={overview.spendChangePct} />}
          icon={<Wallet aria-hidden />}
        />
        <StatBlock
          label="Provider cost (USD reported)"
          value={totals.providerCostUsd !== null ? `$${totals.providerCostUsd.toFixed(2)}` : "not reported"}
          sub={
            totals.providerCostUsd !== null
              ? "What the model providers charged for these calls"
              : `${compact(totals.providerCostUnavailableCount)} call${totals.providerCostUnavailableCount === 1 ? "" : "s"} carried no numeric cost`
          }
          icon={<Landmark aria-hidden />}
          tone={totals.providerCostUsd === null ? "muted" : "default"}
        />
        <StatBlock
          label="Runtime calls"
          value={compact(totals.requests)}
          sub={`${compact(totals.succeeded)} succeeded · ${compact(totals.failed)} failed across ${overview.projectsCount} business${overview.projectsCount === 1 ? "" : "es"}`}
        />
      </div>

      {overview.earningsStatus === "unavailable" && overview.projectsCount > 0 ? (
        <Notice
          title="Earnings feed not configured."
          body={`${overview.earningsNote ?? ""} Runtime costs are complete; earnings appear once the payment provider is set up.`}
        />
      ) : overview.earningsStatus === "error" ? (
        <Notice body={overview.earningsNote ?? "The earnings feed returned an error for these projects."} />
      ) : null}

      {mixedCurrencies ? (
        <Notice
          body={`Attributed payments arrived in more than one currency (${totals.currencies.join(", ")}). Totals sum nominal amounts across currencies — open a business's finance page for its details.`}
        />
      ) : null}

      {!overview.earningsSweepComplete ? (
        <Notice
          body={`Earnings cover your ${overview.byProject.length} most recently updated businesses (page-load bound). Older ones open their own finance page for the full history; runtime costs cover every business.`}
        />
      ) : null}

      {hasSpend || hasEarnings ? (
        <div className="rounded-xl border border-border bg-background/40 p-3 sm:p-4">
          <h4 className="text-sm font-medium">Daily flow — spend against earnings</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            UTC days · all businesses combined · {overview.days}-day window. Bars are credits (left axis) and
            money (right axis); the line is cumulative earnings in {currency ?? "payment"} units. Hover a day for
            its detail. Computed {when(overview.generatedAt)}.
          </p>
          <div className="mt-3">
            <MoneyTrendChart points={trendPoints} currency={currency} height={280} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
          <p className="text-sm font-medium">Nothing has run yet in this window.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Credits charged by the runtime and payments attributed to your API keys fill this in day by day.
            Nothing here is estimated or back-filled.
          </p>
        </div>
      )}

      {businessBars.length > 0 || activeBusinesses.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-5">
          {businessBars.length > 0 ? (
            <div className="rounded-xl border border-border bg-background/40 p-3 sm:p-4 lg:col-span-2">
              <h4 className="text-sm font-medium">Where the credits went</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Each business&apos;s share of runtime spend in this window, in credits.
              </p>
              <div className="mt-3">
                <BreakdownBarsChart rows={businessBars} />
              </div>
            </div>
          ) : null}
          {activeBusinesses.length > 0 ? (
            <ul className={cn("flex flex-col gap-2", businessBars.length > 0 ? "lg:col-span-3" : "lg:col-span-5")}>
              {activeBusinesses.map((row) => (
                <li
                  key={row.projectId}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.projectName}</p>
                    <p className="text-xs text-muted-foreground">
                      {compact(row.creditsCharged)} credits · {compact(row.requests)} call{row.requests === 1 ? "" : "s"} ·{" "}
                      {row.earningsMinor === null ? (
                        <span>earnings not reported</span>
                      ) : (
                        <span>{money(row.earningsMinor, row.currency)}</span>
                      )}
                    </p>
                  </div>
                  <Link
                    href={`/project/${row.projectId}/finances`}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Finances <ArrowRight className="size-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function Notice({ title, body }: { title?: string; body: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span>
        {title ? <strong className="text-foreground">{title} </strong> : null}
        {body}
      </span>
    </p>
  )
}
