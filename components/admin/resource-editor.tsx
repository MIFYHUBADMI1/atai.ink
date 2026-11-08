"use client"

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react"
import Link from "next/link"
import {
  Archive,
  BookOpen,
  Check,
  ExternalLink,
  FileDown,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Route,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import {
  CATEGORY_META,
  FORMAT_LABEL,
  RESOURCE_CATEGORIES,
  RESOURCE_FORMATS,
  RESOURCE_TYPES,
  TYPE_LABEL,
  type ResourceCategory,
  type ResourceDifficulty,
  type ResourceFile,
  type ResourceFormat,
  type ResourceType,
} from "@/lib/resources/types"
import {
  formatFileSize,
  youTubeThumbnailUrl,
  youTubeVideoId,
} from "@/lib/resources/media"
import type { AdminResourceView } from "@/lib/resources/admin-types"
import { cn } from "@/lib/utils"

type FormState = {
  title: string
  slug: string
  category: ResourceCategory
  type: ResourceType
  format: ResourceFormat
  description: string
  topicsText: string
  difficulty: ResourceDifficulty
  readingMinutes: string
  contentMarkdown: string
  imageUrl: string
  youtubeUrl: string
  externalUrl: string
  seoTitle: string
  seoDescription: string
  keywordsText: string
  relatedText: string
  featured: boolean
  status: "draft" | "published" | "archived"
  publishedAt: string
}

const STATUS_LABEL: Record<FormState["status"], string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
}

const STATUS_STYLE: Record<FormState["status"], string> = {
  draft: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  published: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  archived: "border-border bg-muted text-muted-foreground",
}

export function statusBadgeClass(status: FormState["status"]) {
  return STATUS_STYLE[status]
}

export function statusLabel(status: FormState["status"]) {
  return STATUS_LABEL[status]
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
    category: "start",
    type: "guide",
    format: "article",
    description: "",
    topicsText: "",
    difficulty: "beginner",
    readingMinutes: "5",
    contentMarkdown: "",
    imageUrl: "",
    youtubeUrl: "",
    externalUrl: "",
    seoTitle: "",
    seoDescription: "",
    keywordsText: "",
    relatedText: "",
    featured: false,
    status: "draft",
    publishedAt: today(),
  }
}

function formFromResource(resource: AdminResourceView): FormState {
  return {
    title: resource.title,
    slug: resource.slug,
    category: resource.category,
    type: resource.type,
    format: resource.format,
    description: resource.description,
    topicsText: resource.topics.join(", "),
    difficulty: resource.difficulty,
    readingMinutes: String(resource.readingMinutes),
    contentMarkdown: resource.contentMarkdown ?? "",
    imageUrl: resource.imageUrl ?? "",
    youtubeUrl: resource.youtubeUrl ?? "",
    externalUrl: resource.externalUrl ?? "",
    seoTitle: resource.seoTitle ?? "",
    seoDescription: resource.seoDescription ?? "",
    keywordsText: (resource.keywords ?? []).join(", "),
    relatedText: resource.related.join(", "),
    featured: resource.featured,
    status: resource.status,
    publishedAt: resource.publishedAt,
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
const TEXTAREA =
  "w-full rounded-xl border border-input bg-transparent px-3 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"

type UploadTarget = "content" | "image" | "document" | null

export function ResourceEditor({
  resource,
  onSaved,
  onArchived,
  onCancel,
}: {
  resource: AdminResourceView | null
  onSaved: () => void
  onArchived: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(resource ? formFromResource(resource) : blankForm())
  const [file, setFile] = useState<ResourceFile | null>(resource?.file ?? null)
  const [slugTouched, setSlugTouched] = useState(Boolean(resource))
  const [showSeo, setShowSeo] = useState(Boolean(resource?.seoTitle || resource?.seoDescription))
  const [tab, setTab] = useState<"write" | "preview">("write")
  const [uploading, setUploading] = useState<UploadTarget>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const documentInput = useRef<HTMLInputElement>(null)
  const textInput = useRef<HTMLInputElement>(null)
  const isPersisted = Boolean(resource && resource.source === "admin")

  const videoId = youTubeVideoId(form.youtubeUrl)
  const videoThumb = youTubeThumbnailUrl(form.youtubeUrl)
  const needsContent = form.format === "article" || form.format === "tutorial" || form.format === "roadmap"
  const needsImage = form.format === "image"
  const needsDocument = form.format === "document"
  const needsVideo = form.format === "video"
  const needsLink = form.format === "link"

  const seoPreviewTitle = form.seoTitle || form.title || "Resource title"
  const seoPreviewDescription =
    form.seoDescription || form.description || "A short, useful description of what this resource covers."

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

  async function handleUpload(event: ChangeEvent<HTMLInputElement>, target: Exclude<UploadTarget, null>) {
    const selected = event.target.files?.[0]
    event.target.value = ""
    if (!selected) return
    setUploading(target)
    setError(null)
    try {
      const body = new FormData()
      body.append("file", selected)
      const response = await fetch("/api/admin/resources/upload", { method: "POST", body })
      const json = (await response.json()) as {
        ok?: boolean
        data?: { kind: "text"; text: string; name: string } | { kind: "image" | "document"; url: string; name: string; mimeType: string; size: number }
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
      setUploading(null)
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
        category: form.category,
        type: form.type,
        format: form.format,
        description: form.description.trim(),
        topics: splitList(form.topicsText),
        difficulty: form.difficulty,
        readingMinutes: Number(form.readingMinutes) || 5,
        contentMarkdown: form.contentMarkdown.trim() || undefined,
        imageUrl: form.imageUrl.trim() || undefined,
        youtubeUrl: form.youtubeUrl.trim() || undefined,
        externalUrl: form.externalUrl.trim() || undefined,
        file: file ?? undefined,
        seoTitle: form.seoTitle.trim() || undefined,
        seoDescription: form.seoDescription.trim() || undefined,
        keywords: splitList(form.keywordsText),
        related: splitList(form.relatedText),
        featured: form.featured,
        status: form.status,
        publishedAt: form.publishedAt || undefined,
      }
      const response = await fetch(
        isPersisted && resource
          ? `/api/admin/resources/${encodeURIComponent(resource.id)}`
          : "/api/admin/resources",
        {
          method: isPersisted ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) {
        throw new Error(json.error?.message || "Could not save the resource.")
      }
      setSavedFlash(true)
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the resource.")
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    if (!resource) return
    if (!window.confirm("Remove this resource from the public library? You can restore it later from the Archived filter.")) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/resources/${encodeURIComponent(resource.id)}`, { method: "DELETE" })
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !json.ok) throw new Error(json.error?.message || "Could not archive the resource.")
      onArchived()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Could not archive the resource.")
      setSaving(false)
    }
  }

  const previewResource = useMemo(
    () => ({
      title: form.title || "Untitled resource",
      description: form.description,
      category: form.category,
      type: form.type,
      format: form.format,
    }),
    [form.title, form.description, form.category, form.type, form.format],
  )
  const PreviewIcon = formatIcon(previewResource.format)

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {isPersisted ? "Editing resource" : resource ? "Customizing editorial resource" : "New resource"}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{resource ? resource.title : "Add to the library"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Write a guide, upload a PDF, publish a roadmap, or embed a YouTube video.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {resource?.status === "published" ? (
            <Link href={resource.href} target="_blank" className={cn(buttonLike, "h-9")}>
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
          <Check className="size-4" /> Saved. Public pages and sitemaps were refreshed.
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
                placeholder="How to validate a business idea"
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
                placeholder="how-to-validate-a-business-idea"
                className={FIELD}
              />
              <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                /resources/{form.category}/{form.slug || "…"}
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
              <span className={labelClass}>Goal category</span>
              <select
                value={form.category}
                onChange={(event) => update("category", event.target.value as ResourceCategory)}
                className={selectClass}
              >
                {RESOURCE_CATEGORIES.map((id) => (
                  <option key={id} value={id}>
                    {CATEGORY_META[id].label} — {CATEGORY_META[id].title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelClass}>Content type</span>
              <select
                value={form.type}
                onChange={(event) => update("type", event.target.value as ResourceType)}
                className={selectClass}
              >
                {RESOURCE_TYPES.map((id) => (
                  <option key={id} value={id}>
                    {TYPE_LABEL[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>Format</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {RESOURCE_FORMATS.map((id) => {
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
                      {FORMAT_LABEL[id]}
                    </button>
                  )
                })}
              </div>
            </label>
            <label className="sm:col-span-2">
              <span className={labelClass}>Description</span>
              <textarea
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                rows={3}
                placeholder="What the reader will learn, and who it is for."
                className={TEXTAREA}
              />
              <span className="mt-1 block text-right font-mono text-[10px] text-muted-foreground">
                {form.description.length}/400
              </span>
            </label>
          </div>

          {needsVideo ? (
            <div className="rounded-xl border border-border bg-background/60 p-4">
              <span className={labelClass}>YouTube video URL</span>
              <Input
                value={form.youtubeUrl}
                onChange={(event) => update("youtubeUrl", event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                className={FIELD}
              />
              {form.youtubeUrl && !videoId ? (
                <p className="mt-2 text-xs text-destructive">Use a full YouTube, Shorts, or youtu.be link.</p>
              ) : null}
              {videoId && videoThumb ? (
                <div className="mt-3 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={videoThumb} alt="" className="h-16 w-28 rounded-lg border border-border object-cover" />
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1 font-medium text-foreground">
                      <Film className="size-3.5 text-red-500" /> Video detected
                    </p>
                    <p className="mt-0.5 truncate font-mono">youtube.com/watch?v={videoId}</p>
                  </div>
                </div>
              ) : null}
            </div>
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

          {needsImage ? (
            <MediaUpload
              title="Image"
              description="Upload a PNG, JPEG, WEBP, or GIF (max 5MB)."
              uploading={uploading === "image"}
              onPick={() => imageInput.current?.click()}
              input={
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => void handleUpload(event, "image")}
                />
              }
            >
              <Input
                value={form.imageUrl}
                onChange={(event) => update("imageUrl", event.target.value)}
                placeholder="…or paste an https image URL"
                className={FIELD}
              />
              {form.imageUrl ? (
                <div className="mt-3 flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.imageUrl}
                    alt=""
                    className="h-20 w-32 rounded-lg border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => update("imageUrl", "")}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Remove image
                  </button>
                </div>
              ) : null}
            </MediaUpload>
          ) : null}

          {needsDocument ? (
            <MediaUpload
              title="Document"
              description="PDF, Word, PowerPoint, or Excel — up to 25MB."
              uploading={uploading === "document"}
              onPick={() => documentInput.current?.click()}
              input={
                <input
                  ref={documentInput}
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                  className="hidden"
                  onChange={(event) => void handleUpload(event, "document")}
                />
              }
            >
              {file ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <FileDown className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No document uploaded yet.</p>
              )}
            </MediaUpload>
          ) : null}

          {needsContent ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={labelClass}>Content</span>
                <div className="flex items-center gap-1 rounded-lg border border-border p-1">
                  {(["write", "preview"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                        tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {id === "write" ? "Markdown" : "Formatted"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2">
                {tab === "write" ? (
                  <textarea
                    value={form.contentMarkdown}
                    onChange={(event) => update("contentMarkdown", event.target.value)}
                    rows={16}
                    placeholder={"## Start with the problem\n\nWrite the guide in Markdown. Use ## for sections so the page gets a table of contents."}
                    className={cn(TEXTAREA, "min-h-72 font-mono text-[13px] leading-6")}
                  />
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-xl border border-border bg-background p-5">
                    {form.contentMarkdown.trim() ? (
                      <MarkdownArticle markdown={form.contentMarkdown} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Write some Markdown, then preview it here.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Markdown supports headings, lists, tables, links, and images.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading === "content"}
                  onClick={() => textInput.current?.click()}
                  className="gap-1.5"
                >
                  {uploading === "content" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  Import .md / .txt
                </Button>
                <input
                  ref={textInput}
                  type="file"
                  accept=".md,.markdown,.txt,.csv,text/plain,text/markdown,text/csv"
                  className="hidden"
                  onChange={(event) => void handleUpload(event, "content")}
                />
              </div>
            </div>
          ) : null}

          {!needsContent && !needsImage && form.format !== "video" && form.format !== "link" ? (
            <label>
              <span className={labelClass}>Cover image (optional)</span>
              <Input
                value={form.imageUrl}
                onChange={(event) => update("imageUrl", event.target.value)}
                placeholder="https://…"
                className={FIELD}
              />
            </label>
          ) : null}

          <div className="rounded-xl border border-border bg-background/60 p-4">
            <button
              type="button"
              onClick={() => setShowSeo((value) => !value)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={showSeo}
            >
              <span>
                <span className="block text-sm font-medium">Search &amp; discovery</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Topics, difficulty, keywords, SEO title, and related resources.
                </span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {showSeo ? "Hide" : "Show"}
              </span>
            </button>
            {showSeo ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label>
                  <span className={labelClass}>Topics</span>
                  <Input
                    value={form.topicsText}
                    onChange={(event) => update("topicsText", event.target.value)}
                    placeholder="validation, customers, mvp"
                    className={FIELD}
                  />
                </label>
                <label>
                  <span className={labelClass}>Keywords</span>
                  <Input
                    value={form.keywordsText}
                    onChange={(event) => update("keywordsText", event.target.value)}
                    placeholder="startup idea, validation"
                    className={FIELD}
                  />
                </label>
                <label>
                  <span className={labelClass}>Difficulty</span>
                  <select
                    value={form.difficulty}
                    onChange={(event) => update("difficulty", event.target.value as ResourceDifficulty)}
                    className={selectClass}
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>
                <label>
                  <span className={labelClass}>Reading minutes</span>
                  <Input
                    type="number"
                    min={1}
                    max={180}
                    value={form.readingMinutes}
                    onChange={(event) => update("readingMinutes", event.target.value)}
                    className={FIELD}
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className={labelClass}>SEO title (optional)</span>
                  <Input
                    value={form.seoTitle}
                    onChange={(event) => update("seoTitle", event.target.value)}
                    placeholder={form.title || "Defaults to the resource title"}
                    className={FIELD}
                  />
                  <span className="mt-1 block text-right font-mono text-[10px] text-muted-foreground">
                    {form.seoTitle.length}/70
                  </span>
                </label>
                <label className="sm:col-span-2">
                  <span className={labelClass}>SEO description (optional)</span>
                  <textarea
                    value={form.seoDescription}
                    onChange={(event) => update("seoDescription", event.target.value)}
                    rows={2}
                    placeholder={form.description || "Defaults to the description"}
                    className={TEXTAREA}
                  />
                  <span className="mt-1 block text-right font-mono text-[10px] text-muted-foreground">
                    {form.seoDescription.length}/180
                  </span>
                </label>
                <label className="sm:col-span-2">
                  <span className={labelClass}>Related resources</span>
                  <Input
                    value={form.relatedText}
                    onChange={(event) => update("relatedText", event.target.value)}
                    placeholder="build/how-to-build-an-mvp, launch/launch-checklist"
                    className={FIELD}
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Comma-separated category/slug ids, including editorial resources.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Card preview</p>
            <div className="mt-3 flex items-start gap-2">
              <PreviewIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {CATEGORY_META[previewResource.category].label} · {FORMAT_LABEL[previewResource.format]}
                </p>
                <p className="mt-1 font-semibold leading-5">{previewResource.title}</p>
                <p className="mt-1 line-clamp-4 text-xs leading-5 text-muted-foreground">
                  {previewResource.description || "The description appears here."}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Search result</p>
            <p className="mt-2 truncate text-sm text-primary">{seoPreviewTitle}</p>
            <p className="truncate font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
              atai.ink/resources/{form.category}/{form.slug || "…"}
            </p>
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{seoPreviewDescription}</p>
          </div>

          <div className="rounded-2xl border border-border bg-background p-4">
            <span className={labelClass}>Publishing</span>
            <select
              value={form.status}
              onChange={(event) => update("status", event.target.value as FormState["status"])}
              className={selectClass}
            >
              <option value="draft">Draft — only admins can see it</option>
              <option value="published">Published — visible and in sitemaps</option>
              <option value="archived">Archived — hidden from the library</option>
            </select>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(event) => update("featured", event.target.checked)}
                className="size-4 rounded border-border"
              />
              Feature on the resources hub
            </label>
            {resource ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Last updated {new Date(resource.updatedAtMs).toLocaleDateString()}
                {resource.isOverride ? " · Overrides an editorial resource" : ""}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving} className="h-9 gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {isPersisted ? "Save changes" : resource ? "Save library copy" : "Create resource"}
            </Button>
            {isPersisted && resource && resource.status !== "archived" ? (
              <Button type="button" variant="outline" onClick={() => void archive()} disabled={saving} className="h-9 gap-1.5">
                <Archive className="size-4" /> Remove from library
              </Button>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  )
}

const labelClass = "mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
const buttonLike =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"

function MediaUpload({
  title,
  description,
  uploading,
  onPick,
  input,
  children,
}: {
  title: string
  description: string
  uploading: boolean
  onPick: () => void
  input: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onPick} disabled={uploading} className="gap-1.5">
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {input}
      <div className="mt-3">{children}</div>
    </div>
  )
}

export function formatIcon(format: ResourceFormat) {
  if (format === "video") return Film
  if (format === "document") return FileDown
  if (format === "image") return ImageIcon
  if (format === "roadmap") return Route
  if (format === "link") return Link2
  if (format === "tutorial") return BookOpen
  return FileText
}
