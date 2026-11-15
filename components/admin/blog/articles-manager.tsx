"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Archive, Copy, Eye, Globe, Loader2, Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteJson, jsonFetcher, postJson } from "@/lib/client/api"
import type { BlogArticleView, BlogStatus } from "@/lib/blog/types"

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

const STATUS_FILTERS: { value: "all" | BlogStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "review", label: "In review" },
  { value: "scheduled", label: "Scheduled" },
  { value: "archived", label: "Archived" },
]

const STATUS_CLASS: Record<BlogStatus, string> = {
  published: "bg-primary/10 text-primary",
  draft: "bg-muted text-muted-foreground",
  review: "bg-amber-500/10 text-amber-600",
  scheduled: "bg-blue-500/10 text-blue-600",
  archived: "bg-muted text-muted-foreground",
}

/** SEO completeness, derived from the stored metadata. It is a checklist of
 * what is present, never a ranking promise. */
function seoHealth(article: BlogArticleView): "ready" | "needs-work" {
  const hasTitle = Boolean(article.seo?.title?.trim() || article.title.trim())
  const hasDescription = Boolean(article.seo?.description?.trim() || article.description.trim())
  const isIndexable = !article.seo?.noindex
  return hasTitle && hasDescription && isIndexable ? "ready" : "needs-work"
}

function updatedWithin(article: BlogArticleView, days: number): boolean {
  const stamp = Date.parse(`${article.updatedAt}T00:00:00`)
  if (!Number.isFinite(stamp)) return false
  return Date.now() - stamp <= days * 86_400_000
}

export function ArticlesManager({
  categories,
  initialFilters,
}: {
  categories: { slug: string; name: string }[]
  initialFilters?: { query: string; status: "all" | BlogStatus; category: string; author: string }
}) {
  const router = useRouter()
  const { data, error, isLoading, mutate } = useSWR<ListResponse>("/api/admin/blog", jsonFetcher)
  const [query, setQuery] = useState(initialFilters?.query ?? "")
  const [status, setStatus] = useState<"all" | BlogStatus>(initialFilters?.status ?? "all")
  const [category, setCategory] = useState(initialFilters?.category ?? "all")
  const [author, setAuthor] = useState(initialFilters?.author ?? "all")
  const [updated, setUpdated] = useState("all")
  const [seo, setSeo] = useState("all")
  const [performance, setPerformance] = useState("all")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const firstRender = useRef(true)

  // The filters live in the URL so a filtered list can be shared, reloaded or
  // reached with the back button.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const params = new URLSearchParams()
    if (query.trim()) params.set("q", query.trim())
    if (status !== "all") params.set("status", status)
    if (category !== "all") params.set("category", category)
    if (author !== "all") params.set("author", author)
    const search = params.toString()
    router.replace(search ? `/admin/blog/articles?${search}` : "/admin/blog/articles", { scroll: false })
  }, [query, status, category, author, router])

  const items = data?.items ?? []
  const authors = useMemo(
    () => [...new Set(items.map((item) => item.author?.name).filter(Boolean))].sort(),
    [items],
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items
      .filter((item) => status === "all" || item.status === status)
      .filter((item) => category === "all" || item.category === category)
      .filter((item) => author === "all" || item.author?.name === author)
      .filter((item) => updated === "all" || updatedWithin(item, Number(updated)))
      .filter((item) => seo === "all" || seoHealth(item) === seo)
      .filter((item) =>
        performance === "all"
          ? true
          : performance === "with-views"
            ? item.views > 0
            : item.views === 0,
      )
      .filter(
        (item) =>
          !needle ||
          item.title.toLowerCase().includes(needle) ||
          item.slug.includes(needle) ||
          item.tags.join(" ").toLowerCase().includes(needle),
      )
      .sort((a, b) => b.views - a.views)
  }, [items, query, status, category, author, updated, seo, performance])

  async function runAction(article: BlogArticleView, action: "publish" | "unpublish" | "archive" | "restore") {
    setBusyId(article.id)
    setFlash(null)
    try {
      await postJson(`/api/admin/blog/${article.id}/status`, { action })
      setFlash(
        action === "publish"
          ? `Published “${article.title}”.`
          : action === "unpublish"
            ? `Unpublished “${article.title}”.`
            : action === "archive"
              ? `Archived “${article.title}”.`
              : `Restored “${article.title}”.`,
      )
      await mutate()
    } catch (actionError) {
      setFlash(actionError instanceof Error ? actionError.message : "That action failed.")
    } finally {
      setBusyId(null)
    }
  }

  async function duplicate(article: BlogArticleView) {
    setBusyId(article.id)
    try {
      await postJson(`/api/admin/blog/${article.id}/duplicate`)
      await mutate()
      setFlash(`Duplicated “${article.title}” as a new draft.`)
    } catch (actionError) {
      setFlash(actionError instanceof Error ? actionError.message : "Could not duplicate the article.")
    } finally {
      setBusyId(null)
    }
  }

  async function remove(article: BlogArticleView) {
    if (!window.confirm(`Delete “${article.title}” permanently?`)) return
    setBusyId(article.id)
    try {
      await deleteJson(`/api/admin/blog/${article.id}`)
      await mutate()
      setFlash(`Deleted “${article.title}”.`)
    } catch (actionError) {
      setFlash(actionError instanceof Error ? actionError.message : "Could not delete the article.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Articles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? `${data.stats.total} article(s) · ${data.stats.published} published · ${data.stats.views.toLocaleString()} total views` : "Loading…"}
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/blog/articles/new" />}>
          <Plus className="size-4" /> New article
        </Button>
      </div>

      {flash ? <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{flash}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, slug or tag"
            className="pl-9"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as "all" | BlogStatus)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.name}
            </option>
          ))}
        </select>
        <select
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          aria-label="Filter by author"
        >
          <option value="all">All authors</option>
          {authors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={updated}
          onChange={(event) => setUpdated(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          aria-label="Filter by last updated"
        >
          <option value="all">Any last updated</option>
          <option value="7">Updated in the last 7 days</option>
          <option value="30">Updated in the last 30 days</option>
          <option value="90">Updated in the last 90 days</option>
        </select>
        <select
          value={seo}
          onChange={(event) => setSeo(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          aria-label="Filter by SEO health"
        >
          <option value="all">Any SEO health</option>
          <option value="ready">SEO metadata complete</option>
          <option value="needs-work">SEO metadata needs work</option>
        </select>
        <select
          value={performance}
          onChange={(event) => setPerformance(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          aria-label="Filter by search performance"
        >
          <option value="all">Any readership</option>
          <option value="with-views">Has recorded views</option>
          <option value="no-views">No recorded views</option>
        </select>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Could not load articles. Sign in as an admin and reload.
        </p>
      ) : null}

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading articles…
        </p>
      ) : filtered.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Article</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Status</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Category</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Author</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Published</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">Updated</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">SEO</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">Views</th>
                <th className="border-b border-border bg-muted/50 px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((article) => (
                <tr key={article.id}>
                  <td className="border-b border-border/60 px-3 py-2">
                    <Link href={`/admin/blog/articles/${article.id}`} className="font-medium hover:text-primary">
                      {article.title}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">/blog/{article.slug}</p>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[article.status]}`}>{article.status}</span>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">{article.category}</td>
                  <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">{article.author?.name}</td>
                  <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">{article.publishedAt}</td>
                  <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">{article.updatedAt}</td>
                  <td className="border-b border-border/60 px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        seoHealth(article) === "ready" ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {seoHealth(article) === "ready" ? "complete" : "needs work"}
                    </span>
                  </td>
                  <td className="border-b border-border/60 px-3 py-2 text-right text-muted-foreground">
                    {article.views.toLocaleString()}
                  </td>
                  <td className="border-b border-border/60 px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="View public page"
                        render={<Link href={`/blog/${article.slug}`} target="_blank" />}
                      >
                        <Eye className="size-4" />
                      </Button>
                      {article.status !== "published" ? (
                        <Button variant="ghost" size="sm" onClick={() => void runAction(article, "publish")} disabled={busyId === article.id}>
                          <Globe className="size-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => void runAction(article, "unpublish")} disabled={busyId === article.id}>
                          <Archive className="size-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void duplicate(article)} disabled={busyId === article.id}>
                        <Copy className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void remove(article)} disabled={busyId === article.id}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">No articles match these filters.</p>
          <p className="mt-1 text-sm text-muted-foreground">Create the first one, or import the original Markdown posts.</p>
        </div>
      )}
    </div>
  )
}
