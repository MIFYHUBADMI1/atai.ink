"use client"

import { useState } from "react"
import useSWR from "swr"
import { Download, Eye, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { jsonFetcher } from "@/lib/client/api"
import type { BlogStatus } from "@/lib/blog/types"

type PerformanceResponse = {
  rows: {
    slug: string
    title: string
    status: BlogStatus
    views: number
    publishedAt: string
    daily: { date: string; views: number }[]
  }[]
  totals: { views: number; articles: number; published: number }
  daily: { date: string; views: number }[]
  search: {
    status: "not-configured" | "unauthorized" | "error" | "ready"
    message: string
    configured: boolean
    rows: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]
    totals: { clicks: number; impressions: number; ctr: number; position: number } | null
    range: { startDate: string; endDate: string }
  }
  bing: { verified: boolean; metricsAvailable: boolean; message: string }
}

function exportCsv(payload: PerformanceResponse) {
  const rows = [
    "slug,title,status,publishedAt,totalViews",
    ...payload.rows.map((row) =>
      [row.slug, `"${row.title.replace(/"/g, '""')}"`, row.status, row.publishedAt, row.views].join(","),
    ),
  ]
  const searchRows = payload.search?.totals
    ? [
        "",
        "search_page,clicks,impressions,ctr,position",
        ...payload.search.rows.map((row) =>
          [row.keys.join(" | "), row.clicks, row.impressions, row.ctr.toFixed(4), row.position.toFixed(2)].join(","),
        ),
      ]
    : []
  const blob = new Blob([[...rows, ...searchRows].join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "atai-blog-performance.csv"
  link.click()
  URL.revokeObjectURL(url)
}

export function PerformanceView() {
  const [days, setDays] = useState(30)
  const { data, isLoading } = useSWR<PerformanceResponse>(`/api/admin/blog/performance?days=${days}`, jsonFetcher)

  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((entry) => entry.views))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content performance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            First-party view counts come from the blog&apos;s own view beacon. Search impressions, clicks and average
            position come from Google Search Console when that property is connected. Unavailable data is never shown
            as zero.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            aria-label="Date range"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => data && exportCsv(data)} disabled={!data}>
            <Download className="size-4" /> Export CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading performance…
        </p>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Views (all time)</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{data.totals.views.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Articles</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{data.totals.articles}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Published</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{data.totals.published}</p>
            </div>
          </div>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Daily views (last {days} days)</h2>
            {data.daily.length ? (
              <div className="mt-4 flex h-32 items-end gap-1">
                {data.daily.map((entry) => (
                  <div
                    key={entry.date}
                    title={`${entry.date}: ${entry.views} views`}
                    className="flex-1 rounded-t bg-primary/70"
                    style={{ height: `${Math.max(4, (entry.views / maxDaily) * 100)}%` }}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No views recorded in this period yet.</p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Search performance (Google Search Console)</h2>
            {data.search.status === "ready" && data.search.totals ? (
              <>
                <div className="mt-3 grid gap-4 sm:grid-cols-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Impressions</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight">
                      {data.search.totals.impressions.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Clicks</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight">{data.search.totals.clicks.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">CTR</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight">
                      {(data.search.totals.ctr * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Avg position</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight">
                      {data.search.totals.position.toFixed(1)}
                    </p>
                  </div>
                </div>
                {data.search.rows.length ? (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[560px] border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Page</th>
                          <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">Clicks</th>
                          <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">
                            Impressions
                          </th>
                          <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">CTR</th>
                          <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">
                            Position
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.search.rows.map((row) => (
                          <tr key={row.keys.join("|")}>
                            <td className="border-b border-border/60 px-3 py-2 font-mono text-xs">{row.keys.join(" | ")}</td>
                            <td className="border-b border-border/60 px-3 py-2 text-right">{row.clicks.toLocaleString()}</td>
                            <td className="border-b border-border/60 px-3 py-2 text-right">
                              {row.impressions.toLocaleString()}
                            </td>
                            <td className="border-b border-border/60 px-3 py-2 text-right">
                              {(row.ctr * 100).toFixed(1)}%
                            </td>
                            <td className="border-b border-border/60 px-3 py-2 text-right">{row.position.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{data.search.message}</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{data.bing.message}</p>
          </section>

          <section className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Article</th>
                  <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Status</th>
                  <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Published</th>
                  <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">Views</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.slug}>
                    <td className="border-b border-border/60 px-3 py-2">
                      <span className="font-medium">{row.title}</span>
                      <p className="font-mono text-xs text-muted-foreground">/blog/{row.slug}</p>
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">{row.status}</td>
                    <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">{row.publishedAt}</td>
                    <td className="border-b border-border/60 px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <Eye className="size-3.5 text-muted-foreground" />
                        {row.views.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  )
}
