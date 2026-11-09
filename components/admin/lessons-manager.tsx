"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { AlertTriangle, Archive, Check, Plus, RefreshCw, RotateCcw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { jsonFetcher } from "@/lib/client/api"
import { LessonEditor, statusBadgeClass, statusLabel } from "@/components/admin/lesson-editor"
import { LESSON_STAGES, LESSON_STAGE_META, type LessonStage } from "@/lib/lessons/types"
import type { AdminLessonView } from "@/lib/lessons/admin-types"
import { cn } from "@/lib/utils"

type Stats = {
  total: number
  published: number
  drafts: number
  archived: number
  featured: number
  files: number
  videos: number
}

type ListResponse = {
  items: AdminLessonView[]
  stats: Stats
}

type StatusFilter = "all" | "published" | "draft" | "archived"

export function LessonsManager() {
  const { data, error, isLoading, mutate } = useSWR<ListResponse>("/api/admin/lessons", jsonFetcher)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [stage, setStage] = useState<"all" | LessonStage>("all")
  const [editor, setEditor] = useState<AdminLessonView | "new" | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const editorAnchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editor) editorAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [editor])

  const items = data?.items ?? []
  const stats = data?.stats

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((item) => status === "all" || item.status === status)
      .filter((item) => stage === "all" || item.stage === stage)
      .filter((item) => {
        if (!q) return true
        return [item.title, item.summary, item.slug, item.topics.join(" ")].join(" ").toLowerCase().includes(q)
      })
  }, [items, query, status, stage])

  function closeEditor() {
    setEditor(null)
  }

  async function refresh(message: string) {
    setFlash(message)
    setActionError(null)
    await mutate()
  }

  async function setLessonStatus(item: AdminLessonView, next: "draft" | "published") {
    setBusyId(item.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not update the lesson.")
      await refresh(next === "published" ? "Published to the founder libraries." : "Moved back to drafts.")
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not update the lesson.")
    } finally {
      setBusyId(null)
    }
  }

  async function archiveLesson(item: AdminLessonView) {
    if (!window.confirm("Remove this lesson from the founder libraries? You can restore it later from the Archived filter.")) return
    setBusyId(item.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(item.id)}`, { method: "DELETE" })
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not archive the lesson.")
      await refresh("Removed from the founder libraries. It stays in Archived.")
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not archive the lesson.")
    } finally {
      setBusyId(null)
    }
  }

  async function restoreLesson(item: AdminLessonView) {
    setBusyId(item.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      })
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not restore the lesson.")
      await refresh("Restored as a draft.")
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not restore the lesson.")
    } finally {
      setBusyId(null)
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <AlertTriangle className="size-5 text-destructive" />
        <h2 className="mt-3 text-lg font-semibold">The lessons library could not load.</h2>
        <p className="mt-1 text-sm text-muted-foreground">Check the database connection, then try again.</p>
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
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Product</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Business lessons</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Lessons published into the founder libraries at{" "}
            <Link href="/lessons" className="text-primary underline-offset-4 hover:underline">
              /lessons
            </Link>{" "}
            and each project&rsquo;s Business Lessons page. They are stage-tagged additions on top of the in-code core
            curriculum — the core list itself is not editable here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void mutate()} className="h-9 gap-1.5">
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button type="button" onClick={() => setEditor("new")} className="h-9 gap-1.5">
            <Plus className="size-4" /> New lesson
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
        <Stat label="Drafts" value={stats?.drafts ?? "—"} detail="Not visible to founders" />
        <Stat label="Featured" value={stats?.featured ?? "—"} detail="Shown first in their stage" />
        <Stat label="Videos + files" value={stats ? stats.videos + stats.files : "—"} detail="Embeds and downloads" />
      </section>

      {editor ? (
        <div ref={editorAnchor} className="scroll-mt-24">
          <LessonEditor
            key={editor === "new" ? "new" : editor.id}
            lesson={editor === "new" ? null : editor}
            onCancel={closeEditor}
            onSaved={() => {
              const wasNew = editor === "new"
              setEditor(null)
              void refresh(wasNew ? "Lesson created." : "Changes saved and founder libraries refreshed.")
            }}
            onArchived={() => {
              setEditor(null)
              void refresh("Removed from the founder libraries.")
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
                placeholder="Search lessons…"
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
              value={stage}
              onChange={(event) => setStage(event.target.value as "all" | LessonStage)}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-base md:text-sm"
            >
              <option value="all">All stages</option>
              {LESSON_STAGES.map((id) => (
                <option key={id} value={id}>
                  {LESSON_STAGE_META[id].label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {items.length} lesson{items.length === 1 ? "" : "s"}
          </p>
        </div>

        {isLoading && !data ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="font-medium">No lessons match those filters.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a broader search or a different status.</p>
            <Button type="button" onClick={() => setEditor("new")} variant="outline" className="mt-4 gap-1.5">
              <Plus className="size-4" /> New lesson
            </Button>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {filtered.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        statusBadgeClass(item.status),
                      )}
                    >
                      {statusLabel(item.status)}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      {LESSON_STAGE_META[item.stage].label}
                    </span>
                    {item.featured && item.status === "published" ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Featured</span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-semibold">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    /lessons/{item.slug} · updated {item.updatedAt}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.status === "published" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={busyId === item.id}
                      onClick={() => void setLessonStatus(item, "draft")}
                    >
                      Unpublish
                    </Button>
                  ) : item.status === "draft" ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={busyId === item.id}
                      onClick={() => void setLessonStatus(item, "published")}
                    >
                      Publish
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={busyId === item.id}
                      onClick={() => void restoreLesson(item)}
                    >
                      <RotateCcw className="size-3.5" /> Restore
                    </Button>
                  )}
                  {item.status !== "archived" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-destructive hover:text-destructive"
                      disabled={busyId === item.id}
                      onClick={() => void archiveLesson(item)}
                    >
                      <Archive className="size-3.5" /> Archive
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setEditor(item)}
                  >
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
