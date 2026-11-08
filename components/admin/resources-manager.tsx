"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  AlertTriangle,
  Archive,
  Check,
  ExternalLink,
  FileDown,
  Film,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { jsonFetcher } from "@/lib/client/api"
import { ResourceEditor, formatIcon, statusBadgeClass, statusLabel } from "@/components/admin/resource-editor"
import {
  CATEGORY_META,
  FORMAT_LABEL,
  RESOURCE_CATEGORIES,
  TYPE_LABEL,
  type ResourceCategory,
  type ResourceFormat,
} from "@/lib/resources/types"
import type { AdminResourceView } from "@/lib/resources/admin-types"
import { cn } from "@/lib/utils"

type Stats = {
  total: number
  published: number
  drafts: number
  archived: number
  featured: number
  downloads: number
  videos: number
}

type ListResponse = {
  items: AdminResourceView[]
  stats: Stats
}

type StatusFilter = "all" | "published" | "draft" | "archived"

export function ResourcesManager() {
  const { data, error, isLoading, mutate } = useSWR<ListResponse>("/api/admin/resources", jsonFetcher)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [category, setCategory] = useState<"all" | ResourceCategory>("all")
  const [editor, setEditor] = useState<AdminResourceView | "new" | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const editorAnchor = useRef<HTMLDivElement>(null)

  // The editor mounts above the list; without this a Customize/Edit click deep
  // in the list appears to do nothing because the form opens off-screen.
  useEffect(() => {
    if (editor) editorAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [editor])

  const items = data?.items ?? []
  const stats = data?.stats

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((item) => status === "all" || item.status === status)
      .filter((item) => category === "all" || item.category === category)
      .filter((item) => {
        if (!q) return true
        return [item.title, item.description, item.slug, item.topics.join(" "), item.keywords?.join(" ") ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      })
  }, [items, query, status, category])

  function closeEditor() {
    setEditor(null)
  }

  async function refresh(message: string) {
    setFlash(message)
    setActionError(null)
    await mutate()
  }

  async function setResourceStatus(item: AdminResourceView, next: "draft" | "published") {
    setBusyId(item.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/resources/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not update the resource.")
      await refresh(next === "published" ? "Published to the resource library." : "Moved back to drafts.")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update the resource.")
    } finally {
      setBusyId(null)
    }
  }

  async function archiveResource(item: AdminResourceView) {
    if (!window.confirm("Remove this resource from the public library? You can restore it later from the Archived filter.")) return
    setBusyId(item.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/resources/${encodeURIComponent(item.id)}`, { method: "DELETE" })
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not archive the resource.")
      await refresh("Removed from the public library. It stays in Archived.")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not archive the resource.")
    } finally {
      setBusyId(null)
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <AlertTriangle className="size-5 text-destructive" />
        <h2 className="mt-3 text-lg font-semibold">The resource library could not load.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Check the database connection, then try again.
        </p>
        <Button type="button" variant="outline" onClick={() => void mutate()} className="mt-4 gap-1.5">
          <RefreshCw className="size-4" /> Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Content</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Resource library</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Guides, tutorials, roadmaps, documents, images, and videos published at{" "}
            <Link href="/resources" className="text-primary underline-offset-4 hover:underline">
              /resources
            </Link>
            . Published resources also feed the docs, sitemaps, and AI-readable files. Editorial entries
            can be customized into editable library copies.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void mutate()} className="h-9 gap-1.5">
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button type="button" onClick={() => setEditor("new")} className="h-9 gap-1.5">
            <Plus className="size-4" /> New resource
          </Button>
        </div>
      </header>

      {flash ? (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="size-4" /> {flash}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Published" value={stats?.published ?? "—"} detail={`${stats?.total ?? 0} records total`} />
        <Stat label="Drafts" value={stats?.drafts ?? "—"} detail="Not visible publicly" />
        <Stat label="Downloads" value={stats?.downloads ?? "—"} detail="PDF and document uploads" />
        <Stat label="Videos" value={stats?.videos ?? "—"} detail="YouTube embeds" />
      </section>

      {editor ? (
        <div ref={editorAnchor} className="scroll-mt-24">
          <ResourceEditor
            key={editor === "new" ? "new" : editor.id}
            resource={editor === "new" ? null : editor}
            onCancel={closeEditor}
            onSaved={() => {
              const wasNew = editor === "new"
              setEditor(null)
              void refresh(wasNew ? "Resource created." : "Changes saved and public pages refreshed.")
            }}
            onArchived={() => {
              setEditor(null)
              void refresh("Removed from the public library.")
            }}
          />
        </div>
      ) : null}

      <section>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the library…"
                className="h-9 pl-9 text-base md:text-sm"
              />
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-base md:text-sm"
            >
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
              <option value="archived">Archived</option>
            </select>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as "all" | ResourceCategory)}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-base md:text-sm"
            >
              <option value="all">All categories</option>
              {RESOURCE_CATEGORIES.map((id) => (
                <option key={id} value={id}>
                  {CATEGORY_META[id].label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {items.length} resource{items.length === 1 ? "" : "s"}
          </p>
        </div>

        {isLoading && !data ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="font-medium">No resources match those filters.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a broader search or a different status.</p>
            <Button type="button" onClick={() => setEditor("new")} variant="outline" className="mt-4 gap-1.5">
              <Plus className="size-4" /> New resource
            </Button>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {filtered.map((item) => {
              const Icon = formatIcon(item.format as ResourceFormat)
              return (
                <li
                  key={item.id}
                  className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/25"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="rounded-xl border border-border bg-background p-2 text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{item.title}</p>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
                              statusBadgeClass(item.status),
                            )}
                          >
                            {statusLabel(item.status)}
                          </span>
                          {item.featured ? (
                            <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-indigo-700 dark:text-indigo-300">
                              Featured
                            </span>
                          ) : null}
                          {item.source === "editorial" ? (
                            <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                              Editorial
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          <span>{CATEGORY_META[item.category].label}</span>
                          <span aria-hidden>·</span>
                          <span>{TYPE_LABEL[item.type]}</span>
                          <span aria-hidden>·</span>
                          <span>{FORMAT_LABEL[item.format]}</span>
                          <span aria-hidden>·</span>
                          <span>/resources/{item.category}/{item.slug}</span>
                          {item.isOverride ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="text-indigo-600 dark:text-indigo-300">Overrides editorial</span>
                            </>
                          ) : null}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {item.file ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                              <FileDown className="size-3" /> {item.file.name}
                            </span>
                          ) : null}
                          {item.youtubeUrl ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                              <Film className="size-3" /> YouTube
                            </span>
                          ) : null}
                          {item.source === "editorial" ? (
                            <span>Editorial catalog</span>
                          ) : (
                            <span>Updated {new Date(item.updatedAtMs).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {item.status === "published" ? (
                        <Link
                          href={item.href}
                          target="_blank"
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent"
                        >
                          <ExternalLink className="size-3.5" /> View
                        </Link>
                      ) : null}
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditor(item)} className="h-8">
                        {item.source === "editorial" ? "Customize" : "Edit"}
                      </Button>
                      {item.status === "archived" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => void setResourceStatus(item, "draft")}
                          className="h-8 gap-1"
                        >
                          <RotateCcw className="size-3.5" /> Restore
                        </Button>
                      ) : item.status === "draft" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => void setResourceStatus(item, "published")}
                          className="h-8 gap-1"
                        >
                          <Check className="size-3.5" /> Publish
                        </Button>
                      ) : null}
                      {item.source === "admin" && item.status !== "archived" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => void archiveResource(item)}
                          className="h-8 gap-1 text-muted-foreground hover:text-destructive"
                        >
                          <Archive className="size-3.5" /> Archive
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
