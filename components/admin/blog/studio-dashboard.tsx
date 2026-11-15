"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { AlertTriangle, ArrowRight, Download, Eye, FileText, Globe, Loader2, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { jsonFetcher, postJson } from "@/lib/client/api"
import type { BlogArticleView, BlogAuditReport } from "@/lib/blog/types"

type ListResponse = {
  items: BlogArticleView[]
  stats: {
    total: number
    published: number
    drafts: number
    review: number
    scheduled: number
    archived: number
    views: number
  }
}

type AuditResponse = { reports: BlogAuditReport[] }

export function StudioDashboard() {
  const { data, isLoading, mutate } = useSWR<ListResponse>("/api/admin/blog", jsonFetcher)
  const { data: auditData } = useSWR<AuditResponse>("/api/admin/blog/audit", async () => {
    const response = await fetch("/api/admin/blog/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    const body = await response.json().catch(() => null)
    return (body?.data ?? { reports: [] }) as AuditResponse
  })
  const [importing, setImporting] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const stats = data?.stats
  const recent = (data?.items ?? []).slice(0, 6)
  const top = [...(data?.items ?? [])].sort((a, b) => b.views - a.views).slice(0, 5)
  const needsAttention = (auditData?.reports ?? [])
    .map((report) => ({
      report,
      errors: report.findings.filter((finding) => finding.severity === "error").length,
      warnings: report.findings.filter((finding) => finding.severity === "warning").length,
    }))
    .filter((entry) => entry.errors > 0 || entry.warnings > 0)
    .sort((a, b) => b.errors - a.errors || b.warnings - a.warnings)
    .slice(0, 6)

  async function importLegacy() {
    setImporting(true)
    setFlash(null)
    try {
      const response = await postJson<{ imported: string[]; skipped: string[] }>("/api/admin/blog/import")
      setFlash(
        `Imported ${response.imported.length} original post(s). ${response.skipped.length} already existed.`,
      )
      await mutate()
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "The import could not run.")
    } finally {
      setImporting(false)
    }
  }

  const cards = [
    { label: "Total articles", value: stats?.total ?? "—", icon: FileText, href: "/admin/blog/articles" },
    { label: "Published", value: stats?.published ?? "—", icon: Globe, href: "/admin/blog/articles?status=published" },
    { label: "Drafts", value: stats?.drafts ?? "—", icon: FileText, href: "/admin/blog/articles?status=draft" },
    { label: "In review", value: stats?.review ?? "—", icon: Sparkles, href: "/admin/blog/articles?status=review" },
    { label: "Scheduled", value: stats?.scheduled ?? "—", icon: Loader2, href: "/admin/blog/articles?status=scheduled" },
    { label: "Total views", value: stats?.views?.toLocaleString() ?? "—", icon: Eye, href: "/admin/blog/performance" },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Write, audit, publish and measure the Atai Insights blog.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void importLegacy()} disabled={importing}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Import original posts
          </Button>
          <Button size="sm" render={<Link href="/admin/blog/articles/new" />}>
            <Plus className="size-4" /> New article
          </Button>
        </div>
      </div>

      {flash ? <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{flash}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{card.label}</p>
              <card.icon className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{card.value}</p>
          </Link>
        ))}
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Recently updated</h2>
          {isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
          ) : recent.length ? (
            <ul className="mt-3 space-y-2">
              {recent.map((article) => (
                <li key={article.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/admin/blog/articles/${article.id}`} className="truncate text-sm font-medium hover:text-primary">
                      {article.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {article.status} · {article.category}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{article.updatedAt}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No articles yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Most read</h2>
          <p className="mt-1 text-xs text-muted-foreground">Real view counts collected from this site.</p>
          {top.length ? (
            <ul className="mt-3 space-y-2">
              {top.map((article) => (
                <li key={article.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <Link href={`/admin/blog/articles/${article.id}`} className="truncate text-sm hover:text-primary">
                    {article.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{article.views.toLocaleString()} views</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No views recorded yet.</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Content needing attention</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Specific findings from the content and SEO audit — not a ranking score.
        </p>
        {needsAttention.length ? (
          <ul className="mt-3 space-y-2">
            {needsAttention.map((entry) => (
              <li key={entry.report.slug} className="rounded-lg border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/admin/blog/articles`} className="text-sm font-medium hover:text-primary">
                    {entry.report.title}
                  </Link>
                  <span className="flex items-center gap-2 text-xs">
                    {entry.errors ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="size-3" /> {entry.errors} error(s)
                      </span>
                    ) : null}
                    {entry.warnings ? <span className="text-amber-600">{entry.warnings} warning(s)</span> : null}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{entry.report.findings[0]?.message}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nothing flagged. Run the audit from an article for details.</p>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" size="sm" render={<Link href="/admin/blog/categories" />}>
          Manage categories
        </Button>
        <Button variant="outline" size="sm" render={<Link href="/admin/blog/redirects" />}>
          Manage redirects
        </Button>
        <Button variant="outline" size="sm" render={<Link href="/admin/blog/performance" />}>
          Content performance
        </Button>
        <Button variant="outline" size="sm" render={<Link href="/admin/blog/settings" />}>
          Discoverability settings <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
