"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { AlertTriangle, Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { jsonFetcher } from "@/lib/client/api"
import {
  LESSON_STAGE_META,
  LESSON_STAGES,
  type LessonDifficulty,
  type LessonStage,
} from "@/lib/lessons/types"
import type { LearningPathStatus } from "@/lib/lessons/paths"
import type { LessonCategoryView } from "@/lib/lessons/taxonomy"
import { cn } from "@/lib/utils"

type PathItem = {
  id: string
  slug: string
  title: string
  description: string
  objectives: string[]
  audience: string
  stage: LessonStage
  difficulty: LessonDifficulty
  estimatedMinutes: number
  lessonRefs: string[]
  status: LearningPathStatus
  featured: boolean
  order: number
  isDefault: boolean
  updatedAtMs: number
}

type LessonOption = {
  id: string
  title: string
  stage: LessonStage
  difficulty: LessonDifficulty
  readingMinutes: number
  source: "core" | "admin"
}

type PathsResponse = { items: PathItem[]; lessons: LessonOption[] }
type CategoriesResponse = { items: LessonCategoryView[] }

type FormState = {
  title: string
  slug: string
  description: string
  objectivesText: string
  audience: string
  stage: LessonStage
  difficulty: LessonDifficulty
  estimatedMinutes: string
  order: string
  status: LearningPathStatus
  featured: boolean
  lessonRefs: string[]
}

const STATUS_LABEL: Record<LearningPathStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
}

const STATUS_STYLE: Record<LearningPathStatus, string> = {
  draft: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  published: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  archived: "border-border bg-muted text-muted-foreground",
}

function blankForm(): FormState {
  return {
    title: "",
    slug: "",
    description: "",
    objectivesText: "",
    audience: "",
    stage: "planning",
    difficulty: "beginner",
    estimatedMinutes: "45",
    order: "50",
    status: "draft",
    featured: false,
    lessonRefs: [],
  }
}

function formFromPath(path: PathItem): FormState {
  return {
    title: path.title,
    slug: path.slug,
    description: path.description,
    objectivesText: path.objectives.join("\n"),
    audience: path.audience,
    stage: path.stage,
    difficulty: path.difficulty,
    estimatedMinutes: String(path.estimatedMinutes),
    order: String(path.order),
    status: path.status,
    featured: path.featured,
    lessonRefs: path.lessonRefs,
  }
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
  if (!response.ok || !json.ok) throw new Error(json.error?.message || "The request failed.")
  return json
}

export function LearningManager() {
  const paths = useSWR<PathsResponse>("/api/admin/learning-paths", jsonFetcher)
  const categories = useSWR<CategoriesResponse>("/api/admin/lesson-categories", jsonFetcher)
  const [editor, setEditor] = useState<PathItem | "new" | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const items = paths.data?.items ?? []
  const lessons = paths.data?.lessons ?? []

  async function refresh(message?: string) {
    if (message) setFlash(message)
    setActionError(null)
    await Promise.all([paths.mutate(), categories.mutate()])
  }

  async function archive(path: PathItem) {
    if (!window.confirm(`Archive “${path.title}”? Founders will no longer see it.`)) return
    setActionError(null)
    try {
      await requestJson(`/api/admin/learning-paths/${encodeURIComponent(path.id)}`, { method: "DELETE" })
      if (editor !== "new" && editor?.id === path.id) setEditor(null)
      await refresh("Path archived.")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not archive the path.")
    }
  }

  async function restore(path: PathItem) {
    setActionError(null)
    try {
      await requestJson(`/api/admin/learning-paths/${encodeURIComponent(path.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "draft" }),
      })
      await refresh("Path restored as a draft.")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not restore the path.")
    }
  }

  async function hardDelete(path: PathItem) {
    if (path.isDefault) {
      setActionError("Built-in paths can be archived but not deleted.")
      return
    }
    if (!window.confirm(`Permanently delete “${path.title}”? This cannot be undone.`)) return
    setActionError(null)
    try {
      await requestJson(`/api/admin/learning-paths/${encodeURIComponent(path.id)}?hard=1`, { method: "DELETE" })
      if (editor !== "new" && editor?.id === path.id) setEditor(null)
      await refresh("Path deleted.")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete the path.")
    }
  }

  if (paths.error || categories.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <AlertTriangle className="size-5 text-destructive" />
        <h2 className="mt-3 text-lg font-semibold">The learning structure could not load.</h2>
        <p className="mt-1 text-sm text-muted-foreground">Check the database connection, then try again.</p>
        <Button type="button" variant="outline" onClick={() => void refresh()} className="mt-4 gap-1.5">
          <RefreshCw className="size-4" /> Try again
        </Button>
      </div>
    )
  }

  const published = items.filter((path) => path.status === "published").length

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Product</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Learning structure</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Learning paths and topic categories for{" "}
            <Link href="/lessons" className="text-primary underline-offset-4 hover:underline">
              /lessons
            </Link>
            . Paths only contain published lessons; categories rename the library filters.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void refresh()} className="h-9 gap-1.5">
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button type="button" onClick={() => setEditor("new")} className="h-9 gap-1.5">
            <Plus className="size-4" /> New path
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

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Published paths" value={published} detail={`${items.length} total`} />
        <Stat label="Library lessons" value={lessons.length} detail="Available to paths" />
        <Stat
          label="Hidden categories"
          value={(categories.data?.items ?? []).filter((category) => category.hidden).length}
          detail={`${categories.data?.items.length ?? 0} categories`}
        />
      </section>

      {editor ? (
        <PathEditor
          key={editor === "new" ? "new" : editor.id}
          path={editor === "new" ? null : editor}
          lessons={lessons}
          onCancel={() => setEditor(null)}
          onSaved={async (message) => {
            setEditor(null)
            await refresh(message)
          }}
        />
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Learning paths</h2>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No paths yet. Create the first one.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((path) => (
              <li key={path.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {path.title}
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", STATUS_STYLE[path.status])}>
                      {STATUS_LABEL[path.status]}
                    </span>
                    {path.featured ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        Featured
                      </span>
                    ) : null}
                    {path.isDefault ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        Built-in
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {LESSON_STAGE_META[path.stage].label} · {path.lessonRefs.length} lessons · {path.estimatedMinutes} min
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditor(path)} className="gap-1.5">
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  {path.status !== "archived" ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void archive(path)}>
                      Archive
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => void restore(path)}>
                      Restore
                    </Button>
                  )}
                  {!path.isDefault ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void hardDelete(path)}
                      aria-label={`Delete ${path.title}`}
                      className="gap-1.5 text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Topic categories</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Rename, describe, reorder, or hide the filters founders use.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {(categories.data?.items ?? []).map((category) => (
            <CategoryRow key={category.id} category={category} onSaved={() => void refresh("Category updated.")} />
          ))}
        </ul>
      </section>
    </div>
  )
}

function Stat({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function CategoryRow({ category, onSaved }: { category: LessonCategoryView; onSaved: () => void }) {
  const [name, setName] = useState(category.name)
  const [description, setDescription] = useState(category.description)
  const [order, setOrder] = useState(String(category.order))
  const [hidden, setHidden] = useState(category.hidden)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty =
    name !== category.name ||
    description !== category.description ||
    order !== String(category.order) ||
    hidden !== category.hidden

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await requestJson("/api/admin/lesson-categories", {
        method: "PATCH",
        body: JSON.stringify({
          id: category.id,
          name: name.trim(),
          description: description.trim(),
          order: Number(order) || 0,
          hidden,
        }),
      })
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the category.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-start">
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_5rem]">
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Category name" />
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-label="Category description"
        />
        <Input
          type="number"
          min={0}
          value={order}
          onChange={(event) => setOrder(event.target.value)}
          aria-label="Category order"
        />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
          Hidden
        </label>
        <Button type="button" size="sm" variant="outline" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive lg:hidden">{error}</p> : null}
    </li>
  )
}

function PathEditor({
  path,
  lessons,
  onCancel,
  onSaved,
}: {
  path: PathItem | null
  lessons: LessonOption[]
  onCancel: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState<FormState>(path ? formFromPath(path) : blankForm())
  const [lessonQuery, setLessonQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredLessons = useMemo(() => {
    const query = lessonQuery.trim().toLowerCase()
    return lessons.filter((lesson) => !query || lesson.title.toLowerCase().includes(query))
  }, [lessons, lessonQuery])

  const grouped = useMemo(() => {
    return LESSON_STAGES.map((stage) => ({
      stage,
      lessons: filteredLessons.filter((lesson) => lesson.stage === stage),
    })).filter((group) => group.lessons.length > 0)
  }, [filteredLessons])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggleLesson(ref: string) {
    setForm((current) => ({
      ...current,
      lessonRefs: current.lessonRefs.includes(ref)
        ? current.lessonRefs.filter((item) => item !== ref)
        : [...current.lessonRefs, ref],
    }))
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description.trim(),
        objectives: form.objectivesText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        audience: form.audience.trim(),
        stage: form.stage,
        difficulty: form.difficulty,
        estimatedMinutes: Number(form.estimatedMinutes) || 45,
        order: Number(form.order) || 0,
        status: form.status,
        featured: form.featured,
        lessonRefs: form.lessonRefs,
      }
      const url = path ? `/api/admin/learning-paths/${encodeURIComponent(path.id)}` : "/api/admin/learning-paths"
      await requestJson(url, { method: path ? "PATCH" : "POST", body: JSON.stringify(payload) })
      onSaved(path ? "Path saved." : "Path created.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the path.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-primary/25 bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{path ? `Edit “${path.title}”` : "New learning path"}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Close editor">
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <Input value={form.title} onChange={(event) => update("title", event.target.value)} className="mt-1" />
        </label>
        <label>
          <span className="text-xs font-medium text-muted-foreground">Slug (optional)</span>
          <Input
            value={form.slug}
            onChange={(event) => update("slug", event.target.value)}
            placeholder="validate-your-business-idea"
            className="mt-1 font-mono text-xs"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted-foreground">Audience</span>
          <Input value={form.audience} onChange={(event) => update("audience", event.target.value)} className="mt-1" />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Description</span>
          <textarea
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Objectives (one per line)</span>
          <textarea
            value={form.objectivesText}
            onChange={(event) => update("objectivesText", event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted-foreground">Stage</span>
          <select
            value={form.stage}
            onChange={(event) => update("stage", event.target.value as LessonStage)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-base md:text-sm"
          >
            {LESSON_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {LESSON_STAGE_META[stage].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-xs font-medium text-muted-foreground">Difficulty</span>
          <select
            value={form.difficulty}
            onChange={(event) => update("difficulty", event.target.value as LessonDifficulty)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-base md:text-sm"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label>
          <span className="text-xs font-medium text-muted-foreground">Estimated minutes</span>
          <Input
            type="number"
            min={5}
            max={600}
            value={form.estimatedMinutes}
            onChange={(event) => update("estimatedMinutes", event.target.value)}
            className="mt-1"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted-foreground">Order</span>
          <Input
            type="number"
            min={0}
            value={form.order}
            onChange={(event) => update("order", event.target.value)}
            className="mt-1"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <select
            value={form.status}
            onChange={(event) => update("status", event.target.value as LearningPathStatus)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-base md:text-sm"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={form.featured}
            onChange={(event) => update("featured", event.target.checked)}
          />
          Feature this path first
        </label>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Lessons ({form.lessonRefs.length} selected, in order)
          </p>
          <Input
            value={lessonQuery}
            onChange={(event) => setLessonQuery(event.target.value)}
            placeholder="Filter lessons"
            className="h-8 w-full sm:w-56"
          />
        </div>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-border">
          {grouped.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No published lessons match.</p>
          ) : (
            grouped.map(({ stage, lessons: stageLessons }) => (
              <div key={stage} className="border-b border-border last:border-b-0">
                <p className="sticky top-0 bg-muted/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
                  {LESSON_STAGE_META[stage].label}
                </p>
                <ul className="divide-y divide-border/60">
                  {stageLessons.map((lesson) => {
                    const index = form.lessonRefs.indexOf(lesson.id)
                    return (
                      <li key={lesson.id}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40">
                          <input
                            type="checkbox"
                            checked={index >= 0}
                            onChange={() => toggleLesson(lesson.id)}
                          />
                          <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                          {index >= 0 ? (
                            <span className="shrink-0 font-mono text-[10px] text-primary">#{index + 1}</span>
                          ) : null}
                          <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{lesson.source}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        {form.lessonRefs.length > 0 ? (
          <button
            type="button"
            onClick={() => update("lessonRefs", [])}
            className="mt-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Clear selected lessons
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : path ? "Save changes" : "Create path"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
