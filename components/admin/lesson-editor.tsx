"use client"

import { useRef, useState, type ChangeEvent } from "react"
import Link from "next/link"
import { Check, ExternalLink, FileDown, Film, Image as ImageIcon, Link2, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import {
  LESSON_FORMATS,
  LESSON_FORMAT_LABEL,
  LESSON_STAGES,
  LESSON_STAGE_META,
  type LessonFile,
  type LessonFormat,
  type LessonStage,
} from "@/lib/lessons/types"
import { LESSON_STATUSES, type AdminLessonView } from "@/lib/lessons/admin-types"
import { formatFileSize } from "@/lib/resources/media"
import { cn } from "@/lib/utils"

type FormState = {
  title: string
  slug: string
  stage: LessonStage
  format: LessonFormat
  summary: string
  topicsText: string
  difficulty: "beginner" | "intermediate" | "advanced"
  readingMinutes: string
  contentMarkdown: string
  imageUrl: string
  youtubeUrl: string
  externalUrl: string
  featured: boolean
  status: (typeof LESSON_STATUSES)[number]
  publishedAt: string
}

const STATUS_LABEL = { draft: "Draft", published: "Published", archived: "Archived" } as const

const STATUS_STYLE = {
  draft: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  published: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  archived: "border-border bg-muted text-muted-foreground",
} as const

export function statusBadgeClass(status: FormState["status"]) {
  return STATUS_STYLE[status]
}

export function statusLabel(status: FormState["status"]) {
  return STATUS_LABEL[status]
}

function formatIcon(format: LessonFormat) {
  if (format === "video") return Film
  if (format === "file") return FileDown
  if (format === "image") return ImageIcon
  if (format === "link") return Link2
  return Check
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function blankForm(): FormState {
  return {
    title: "",
    slug: "",
    stage: "planning",
    format: "article",
    summary: "",
    topicsText: "",
    difficulty: "beginner",
    readingMinutes: "5",
    contentMarkdown: "",
    imageUrl: "",
    youtubeUrl: "",
    externalUrl: "",
    featured: false,
    status: "draft",
    publishedAt: today(),
  }
}

function formFromLesson(lesson: AdminLessonView): FormState {
  return {
    title: lesson.title,
    slug: lesson.slug,
    stage: lesson.stage,
    format: lesson.format,
    summary: lesson.summary,
    topicsText: lesson.topics.join(", "),
    difficulty: lesson.difficulty,
    readingMinutes: String(lesson.readingMinutes),
    contentMarkdown: lesson.contentMarkdown ?? "",
    imageUrl: lesson.imageUrl ?? "",
    youtubeUrl: lesson.youtubeUrl ?? "",
    externalUrl: lesson.externalUrl ?? "",
    featured: lesson.featured,
    status: lesson.status,
    publishedAt: lesson.publishedAt,
  }
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

const FIELD = "h-9 text-base md:text-sm"
const labelClass = "mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"

export function LessonEditor({
  lesson,
  onSaved,
  onArchived,
  onCancel,
}: {
  lesson: AdminLessonView | null
  onSaved: () => void
  onArchived: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(lesson ? formFromLesson(lesson) : blankForm())
  const [slugTouched, setSlugTouched] = useState(Boolean(lesson))
  const [tab, setTab] = useState<"write" | "preview">("write")
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [file, setFile] = useState<LessonFile | null>(lesson?.file ?? null)
  const fileInput = useRef<HTMLInputElement>(null)
  const isPersisted = Boolean(lesson)

  const needsContent = form.format === "article"
  const needsImage = form.format === "image"
  const needsVideo = form.format === "video"
  const needsLink = form.format === "link"

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function onTitleChange(value: string) {
    setForm((current) => ({
      ...current,
      title: value,
      slug: slugTouched ? current.slug : slugify(value),
    }))
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ""
    if (!selected) return
    setUploading(true)
    setError(null)
    try {
      const body = new FormData()
      body.append("file", selected)
      const response = await fetch("/api/admin/lessons/upload", { method: "POST", body })
      const json = (await response.json()) as {
        ok?: boolean
        data?: { kind: "text"; text: string } | { kind: "image"; url: string } | { kind: "document"; url: string; name: string; mimeType: string; size: number }
        error?: { message?: string }
      }
      if (!response.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message || "Upload failed. Try a smaller file or paste a URL instead.")
      }
      const data = json.data
      if (data.kind === "text") {
        setForm((current) => ({
          ...current,
          contentMarkdown: current.contentMarkdown.trim()
            ? `${current.contentMarkdown.trim()}\n\n${data.text}`
            : data.text,
        }))
        setTab("write")
      } else if (data.kind === "image") {
        update("imageUrl", data.url)
      } else {
        setFile({
          url: data.url,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size,
          provider: "imagekit",
        })
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.")
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSavedFlash(false)
    try {
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim() || undefined,
        stage: form.stage,
        format: form.format,
        summary: form.summary.trim(),
        topics: splitList(form.topicsText),
        difficulty: form.difficulty,
        readingMinutes: Number(form.readingMinutes) || 5,
        contentMarkdown: form.contentMarkdown.trim() || undefined,
        imageUrl: form.imageUrl.trim() || undefined,
        youtubeUrl: form.youtubeUrl.trim() || undefined,
        externalUrl: form.externalUrl.trim() || undefined,
        file: file ?? undefined,
        featured: form.featured,
        status: form.status,
        publishedAt: form.publishedAt || undefined,
      }
      const response = await fetch(
        isPersisted && lesson ? `/api/admin/lessons/${encodeURIComponent(lesson.id)}` : "/api/admin/lessons",
        {
          method: isPersisted ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) {
        throw new Error(json.error?.message || "Could not save the lesson.")
      }
      setSavedFlash(true)
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the lesson.")
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    if (!lesson) return
    if (!window.confirm("Remove this lesson from the founder libraries? You can restore it later from the Archived filter.")) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lesson.id)}`, { method: "DELETE" })
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not archive the lesson.")
      onArchived()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Could not archive the lesson.")
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {isPersisted ? "Editing lesson" : "New lesson"}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{lesson ? lesson.title : "Add a business lesson"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stage-tagged lessons merged into the founder libraries at /lessons — articles, videos, PDFs, images, or links.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lesson?.status === "published" ? (
            <Link href={lesson.href} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted h-9">
              <ExternalLink className="size-3.5" /> View
            </Link>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onCancel} type="button" className="h-9">
            Close
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {savedFlash ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="size-4" /> Saved. Founder libraries were refreshed.
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={labelClass}>Title</span>
              <Input
                value={form.title}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Pricing your first SaaS plan"
                className={FIELD}
              />
            </label>
            <label>
              <span className={labelClass}>URL slug</span>
              <Input
                value={form.slug}
                onChange={(event) => {
                  setSlugTouched(true)
                  update("slug", slugify(event.target.value))
                }}
                placeholder="pricing-your-first-saas-plan"
                className={FIELD}
              />
              <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                /lessons/{form.slug || "…"}
              </span>
            </label>
            <label>
              <span className={labelClass}>Published date</span>
              <Input
                type="date"
                value={form.publishedAt}
                onChange={(event) => update("publishedAt", event.target.value)}
                className={FIELD}
              />
            </label>
            <label>
              <span className={labelClass}>Business stage</span>
              <select
                value={form.stage}
                onChange={(event) => update("stage", event.target.value as LessonStage)}
                className={selectClass}
              >
                {LESSON_STAGES.map((id) => (
                  <option key={id} value={id}>
                    {LESSON_STAGE_META[id].label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelClass}>Status</span>
              <select
                value={form.status}
                onChange={(event) => update("status", event.target.value as FormState["status"])}
                className={selectClass}
              >
                {LESSON_STATUSES.map((id) => (
                  <option key={id} value={id}>
                    {STATUS_LABEL[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>Format</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {LESSON_FORMATS.map((id) => {
                  const Icon = formatIcon(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => update("format", id)}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
                        form.format === id
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      <Icon className="size-3.5" />
                      {LESSON_FORMAT_LABEL[id]}
                    </button>
                  )
                })}
              </div>
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>Summary ({form.summary.trim().length}/400)</span>
              <textarea
                value={form.summary}
                onChange={(event) => update("summary", event.target.value)}
                rows={2}
                placeholder="One or two sentences founders see on the lesson card."
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
            </label>
            <label>
              <span className={labelClass}>Topics (comma separated)</span>
              <Input
                value={form.topicsText}
                onChange={(event) => update("topicsText", event.target.value)}
                placeholder="pricing, revenue, positioning"
                className={FIELD}
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label>
                <span className={labelClass}>Difficulty</span>
                <select
                  value={form.difficulty}
                  onChange={(event) => update("difficulty", event.target.value as FormState["difficulty"])}
                  className={selectClass}
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
              <label>
                <span className={labelClass}>Minutes</span>
                <Input
                  type="number"
                  min={1}
                  max={180}
                  value={form.readingMinutes}
                  onChange={(event) => update("readingMinutes", event.target.value)}
                  className={FIELD}
                />
              </label>
            </div>
          </div>

          {needsContent ? (
            <div>
              <div className="flex items-center justify-between">
                <span className={labelClass}>Lesson content (markdown)</span>
                <div className="flex gap-1 rounded-lg border border-border p-0.5">
                  {(["write", "preview"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTab(mode)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                        tab === mode ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              {tab === "write" ? (
                <textarea
                  value={form.contentMarkdown}
                  onChange={(event) => update("contentMarkdown", event.target.value)}
                  rows={16}
                  placeholder="## Section&#10;&#10;Write the lesson body in markdown."
                  className="mt-1 w-full rounded-xl border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              ) : (
                <div className="mt-1 min-h-[16rem] rounded-xl border border-border bg-background p-4">
                  {form.contentMarkdown.trim() ? (
                    <MarkdownArticle markdown={form.contentMarkdown} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {needsVideo ? (
            <label>
              <span className={labelClass}>YouTube URL</span>
              <Input
                value={form.youtubeUrl}
                onChange={(event) => update("youtubeUrl", event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                className={FIELD}
              />
            </label>
          ) : null}

          {needsImage ? (
            <label>
              <span className={labelClass}>Image URL</span>
              <Input
                value={form.imageUrl}
                onChange={(event) => update("imageUrl", event.target.value)}
                placeholder="https://…"
                className={FIELD}
              />
            </label>
          ) : null}

          {needsLink ? (
            <label>
              <span className={labelClass}>External URL</span>
              <Input
                value={form.externalUrl}
                onChange={(event) => update("externalUrl", event.target.value)}
                placeholder="https://…"
                className={FIELD}
              />
            </label>
          ) : null}

          <div className="rounded-2xl border border-dashed border-border p-4">
            <p className="text-sm font-medium">Attach a document (optional)</p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF, Word, PowerPoint, or Excel up to 25MB — founders get a download card on the lesson.
              {lesson?.file ? ` Current file: ${lesson.file.name} (${formatFileSize(lesson.file.size)}).` : ""}
            </p>
            <input ref={fileInput} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.markdown,.csv,.png,.jpg,.jpeg,.webp,.gif" className="hidden" onChange={handleUpload} />
            <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploading ? "Uploading…" : "Upload file"}
            </Button>
            {file && !lesson?.file ? (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">File uploaded — save the lesson to attach it.</p>
            ) : null}          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className={labelClass}>Visibility</p>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(event) => update("featured", event.target.checked)}
                className="size-4 rounded border-input"
              />
              Featured (shown first in its stage)
            </label>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {form.status === "published"
                ? `Live at /lessons under the ${LESSON_STAGE_META[form.stage].label} stage.`
                : form.status === "draft"
                  ? "Drafts are only visible here."
                  : "Archived lessons are hidden from founders but restorable."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button type="button" onClick={save} disabled={saving || uploading} className="gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {isPersisted ? "Save changes" : "Create lesson"}
            </Button>
            {lesson && lesson.status !== "archived" ? (
              <Button type="button" variant="outline" onClick={archive} disabled={saving} className="gap-1.5 text-destructive hover:text-destructive">
                Archive lesson
              </Button>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  )
}
