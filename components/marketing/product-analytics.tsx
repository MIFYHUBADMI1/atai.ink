import Link from "next/link"
import { BarChart3, MousePointerClick, Route, Sparkles } from "lucide-react"

import { Chip, EmptyPanel, SectionCard, StatTile } from "@/components/connected-business/page-ui"
import type { ProductSummary } from "@/lib/analytics/product/summary"

/**
 * What visitors do — the product-analytics panel.
 *
 * It is the same component on both surfaces: a build project and a connected
 * business both install the same snippet and both get the same answer. Every
 * number comes from `ProductSummary`, which is pure, so what is rendered here
 * is exactly what a test asserted.
 *
 * The panel is honest about absence: with no sessions it shows how to install
 * the collector rather than a wall of zeroes, and a sampled read says so.
 */

function percentOf(part: number, whole: number): string {
  if (whole <= 0) return "—"
  return `${Math.round((part / whole) * 100)}%`
}

function duration(ms?: number): string | null {
  if (!ms || ms <= 0) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

function BarChart({ daily }: { daily: ProductSummary["daily"] }) {
  const max = Math.max(...daily.map((day) => day.pageViews), 1)
  return (
    <div>
      <div className="flex h-24 items-end gap-1" role="img" aria-label="Page views per day">
        {daily.map((day) => (
          <div
            key={day.date}
            title={`${day.date}: ${day.pageViews} page views · ${day.sessions} visits`}
            className="min-w-0 flex-1 rounded-t bg-primary/60 transition-colors hover:bg-primary"
            style={{ height: `${Math.max(4, Math.round((day.pageViews / max) * 100))}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{daily[0]?.date ?? ""}</span>
        <span>{daily[daily.length - 1]?.date ?? ""}</span>
      </div>
    </div>
  )
}

function PageTable({ summary }: { summary: ProductSummary }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Pages</p>
      <ul className="mt-2 divide-y divide-border/70">
        {summary.topPages.map((page) => (
          <li key={page.path} className="flex min-w-0 items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={page.path}>
              {page.path}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{page.views} views</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {percentOf(page.exits, page.views)} exit
            </span>
            {duration(page.medianMs) ? (
              <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                {duration(page.medianMs)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ClickList({ summary }: { summary: ProductSummary }) {
  if (summary.topClicks.length === 0) {
    return (
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Pressed</p>
        <p className="mt-2 text-xs text-muted-foreground">No clicks recorded yet.</p>
      </div>
    )
  }
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Pressed</p>
      <ul className="mt-2 divide-y divide-border/70">
        {summary.topClicks.map((click) => (
          <li key={`${click.path}-${click.label}`} className="flex min-w-0 items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs" title={click.label}>
              {click.label}
            </span>
            <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground" title={click.path}>
              {click.path}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{click.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProductAnalyticsPanel({
  summary,
  keysHref,
}: {
  summary: ProductSummary
  /** Where the founder creates the browser key the snippet needs. */
  keysHref?: string
}) {
  const hasData = summary.sessions > 0

  return (
    <SectionCard
      icon={MousePointerClick}
      title="What visitors do"
      description="Pages they reach, where they stop, what they press — measured by the snippet you install, never by a third party."
      actions={
        hasData ? (
          <Chip tone={summary.sampled ? "warning" : "muted"}>
            {summary.sampled ? "sampled" : `last ${summary.windowDays} days`}
          </Chip>
        ) : undefined
      }
    >
      {!hasData ? (
        <EmptyPanel
          icon={BarChart3}
          title="No visits recorded yet"
          description={
            keysHref
              ? "Create a browser key, then paste the snippet it gives you into the head of every page. Within a minute of the first visit, this panel fills itself."
              : "Create a browser key in your project settings, then paste the snippet it gives you into the head of every page."
          }
          action={
            keysHref ? (
              <Link
                href={keysHref}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Create a browser key
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Visitors" value={summary.visitors} hint={`${summary.returningVisitors} came back`} />
            <StatTile label="Visits" value={summary.sessions} hint={`${summary.pagesPerSession} pages each`} />
            <StatTile label="Page views" value={summary.pageViews} />
            <StatTile
              label="Leave after one page"
              value={`${Math.round(summary.bounceRate * 100)}%`}
              hint={summary.medianSessionMs ? `median visit ${duration(summary.medianSessionMs)}` : undefined}
            />
          </div>

          {summary.signals.length > 0 ? (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-primary" aria-hidden />
                What this means
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {summary.signals.map((signal) => (
                  <li key={signal} className="text-sm leading-6 text-foreground/85">
                    {signal}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <BarChart daily={summary.daily} />

          <div className="grid gap-6 border-t border-border/70 pt-5 sm:grid-cols-2">
            <PageTable summary={summary} />
            <ClickList summary={summary} />
          </div>

          <div className="grid gap-6 border-t border-border/70 pt-5 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Devices</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {summary.devices.map((device) => (
                  <Chip key={device.device}>
                    {device.device} · {device.sessions}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Arrived from</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {summary.referrers.length > 0 ? (
                  summary.referrers.map((referrer) => (
                    <Chip key={referrer.host}>
                      {referrer.host} · {referrer.sessions}
                    </Chip>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Direct visits only.</span>
                )}
              </div>
            </div>
          </div>

          {summary.journeys.length > 0 ? (
            <div className="border-t border-border/70 pt-5">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <Route className="size-3.5" aria-hidden />
                The usual paths
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {summary.journeys.map((journey) => (
                  <li key={journey.steps.join(">")} className="flex min-w-0 items-center gap-3 text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono">{journey.steps.join(" → ")}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{journey.sessions} visits</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  )
}
