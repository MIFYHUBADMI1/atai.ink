"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  Eye,
  Globe,
  History,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AuditPanel } from "@/components/admin/blog/audit-panel"
import { ComparisonEditor } from "@/components/admin/blog/comparison-editor"
import { MarkdownToolbar } from "@/components/admin/blog/markdown-toolbar"
import { SeoPanel } from "@/components/admin/blog/seo-panel"
import { ArticlePreview } from "@/components/blog/article-preview"
import { deleteJson, patchJson, postJson } from "@/lib/client/api"
import type {
  BlogArticleView,
  BlogAuditReport,
  BlogAuthor,
  BlogRevisionDoc,
  ComparisonData,
} from "@/lib/blog/types"

/** The outcome of a publish, as reported by the server. */
type AnnouncementSummary = {
  status: "sent" | "partial" | "failed" | "not-configured" | "skipped"
  recipients: number
  sentCount: number
  failedCount: number
  reason?: string
}

/** The outcome of the indexing ping that follows a publish. */
type IndexingSummary = {
  status: "submitted" | "failed" | "not-configured"
  error?: string
}

type BlogEditorValue = {
  title: string
  slug: string
  description: string
  excerpt: string
  body: string
  category: string
  tags: string[]
  author: BlogAuthor
  competitor?: string
  comparison?: ComparisonData
  featuredImage?: { url: string; alt: string }
  seo: {
    title?: string
    description?: string
    canonical?: string
    ogTitle?: string
    ogDescription?: string
    ogImage?: string
    focusKeyword?: string
    secondaryKeywords?: string[]
    noindex?: boolean
  }
  status: "draft" | "review" | "scheduled" | "published" | "archived"
  featured: boolean
  relatedSlugs: string[]
  scheduledFor?: number
  publishedAt?: string
  updatedAt?: string
}

const EMPTY_VALUE: BlogEditorValue = {
  title: "",
  slug: "",
  description: "",
  excerpt: "",
  body: "",
  category: "business-building",
  tags: [],
  author: { name: "Atai Team", role: "Editorial" },
  seo: {},
  status: "draft",
  featured: false,
  relatedSlugs: [],
}

function fromArticle(article: BlogArticleView): BlogEditorValue {
  return {
    title: article.title,
    slug: article.slug,
    description: article.description,
    excerpt: article.excerpt,
    body: article.body,
    category: article.category,
    tags: article.tags,
    author: article.author,
    competitor: article.competitor,
    comparison: article.comparison,
    featuredImage: article.featuredImage,
    seo: article.seo ?? {},
    status: article.status,
    featured: article.featured,
    relatedSlugs: article.relatedSlugs,
    scheduledFor: article.scheduledFor,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
  }
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

/** A publish that starts from the "new article" screen ends on the edit screen,
 * and that navigation remounts the editor. The outcome is handed over so the
 * admin still reads what happened. */
const FLASH_KEY = "atai:blog-editor-flash"

function stashFlash(text: string): void {
  try {
    window.sessionStorage.setItem(FLASH_KEY, text)
  } catch {
    // Private mode or a full quota: the status line in the header still tells
    // the admin the truth, so a missing flash is not a failure.
  }
}

function takeFlash(): string | null {
  try {
    const text = window.sessionStorage.getItem(FLASH_KEY)
    if (text) window.sessionStorage.removeItem(FLASH_KEY)
    return text
  } catch {
    return null
  }
}

/** Date-only, in a pinned locale: the header renders on the server first, so a
 * locale-free time string would print different text on the two passes. A bare
 * YYYY-MM-DD is read as local midnight so the day never shifts. */
function formatSaved(value: string): string {
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** A reload, a crashed tab or a wrong "Leave page" click used to destroy
 * everything typed on the New screen, because nothing is stored until the
 * article is created — and work on a stored article is lost the same way in the
 * seconds before autosave runs. The editor keeps a rolling snapshot in this
 * browser and offers it back on the next load. */
const DRAFT_KEY = "atai:blog-editor-draft"

function draftKey(id: string | null): string {
  return `${DRAFT_KEY}:${id ?? "new"}`
}

type RecoveredDraft = { atMs: number; value: BlogEditorValue; key: string }

function readDraft(key: string): { atMs: number; value: BlogEditorValue } | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { atMs?: number; value?: Partial<BlogEditorValue> } | null
    if (!parsed?.value || typeof parsed.value.body !== "string" || typeof parsed.value.title !== "string") {
      return null
    }
    return {
      atMs: parsed.atMs ?? 0,
      value: { ...EMPTY_VALUE, ...(parsed.value as BlogEditorValue), seo: parsed.value.seo ?? {} },
    }
  } catch {
    return null
  }
}

function writeDraft(key: string, value: BlogEditorValue): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ atMs: Date.now(), value }))
  } catch {
    // Quota or private mode: the debounced server autosave still protects
    // stored articles, so a missing local snapshot is not a failure.
  }
}

function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to clean up if storage was unreachable.
  }
}

/** Fixed field order, so two values that hold the same writing always compare
 * equal regardless of how each object was assembled. Publishing state
 * (`status`, `featured`, `scheduledFor`, `publishedAt`) is deliberately absent:
 * the server owns that, and a snapshot from before a publish must not be
 * offered as though content were missing. */
function draftFingerprint(value: BlogEditorValue): string {
  return JSON.stringify([
    value.title,
    value.slug,
    value.description,
    value.excerpt,
    value.body,
    value.category,
    value.tags,
    value.seo,
    value.relatedSlugs,
    value.author,
    value.competitor ?? null,
    value.comparison ?? null,
    value.featuredImage ?? null,
  ])
}

/** The writing from the snapshot, on top of whatever the editor currently
 * holds. Restoring never rolls back a publish, an archive or a schedule. */
function recoveredContent(snapshot: BlogEditorValue, current: BlogEditorValue): BlogEditorValue {
  return {
    ...current,
    title: snapshot.title,
    slug: snapshot.slug,
    description: snapshot.description,
    excerpt: snapshot.excerpt,
    body: snapshot.body,
    category: snapshot.category,
    tags: snapshot.tags,
    seo: snapshot.seo,
    relatedSlugs: snapshot.relatedSlugs,
    author: snapshot.author,
    competitor: snapshot.competitor,
    comparison: snapshot.comparison,
    featuredImage: snapshot.featuredImage,
  }
}

/** The banner renders only after mount, so this string never reaches the
 * server pass — but the locale is pinned anyway. */
function formatRecovered(atMs: number): string {
  if (!atMs) return "an earlier visit"
  const date = new Date(atMs)
  if (Number.isNaN(date.getTime())) return "an earlier visit"
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** `datetime-local` needs "YYYY-MM-DDTHH:mm" in the browser's own timezone. */
function formatScheduleInput(value?: number): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** What actually happened to the newsletter announcement, in plain words. */
function announcementMessage(announcement?: AnnouncementSummary): string | null {
  if (!announcement) return null
  switch (announcement.status) {
    case "sent":
      return ` ${announcement.sentCount} subscriber${announcement.sentCount === 1 ? "" : "s"} notified.`
    case "partial":
      return ` ${announcement.sentCount} of ${announcement.recipients} subscribers notified.`
    case "failed":
      return ` The announcement failed to send${announcement.reason ? `: ${announcement.reason}` : "."}`
    case "not-configured":
      return " The announcement was not sent — the mail provider is not connected."
    default:
      return null
  }
}

/** What actually happened to the indexing ping. A ping is not indexing. */
function indexingMessage(indexing?: IndexingSummary): string | null {
  if (!indexing) return null
  switch (indexing.status) {
    case "submitted":
      return " The indexing ping was accepted — that is not a claim that the page is indexed."
    case "failed":
      return ` The indexing ping was not accepted${indexing.error ? `: ${indexing.error}` : "."} The article is live but was not submitted for indexing.`
    case "not-configured":
      return " No indexing ping was sent — IndexNow is not configured."
    default:
      return null
  }
}

export function ArticleEditor({
  article,
  categories,
  siteUrl,
}: {
  article: BlogArticleView | null
  categories: { slug: string; name: string }[]
  siteUrl: string
}) {
  const router = useRouter()
  const [value, setValue] = useState<BlogEditorValue>(article ? fromArticle(article) : EMPTY_VALUE)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [audit, setAudit] = useState<BlogAuditReport | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [revisions, setRevisions] = useState<BlogRevisionDoc[]>([])
  const [scheduleAt, setScheduleAt] = useState(() => formatScheduleInput(article?.scheduledFor))
  const [tab, setTab] = useState<string>("preview")
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const dirtyRef = useRef(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(article?.updatedAt ?? null)
  const [recovered, setRecovered] = useState<RecoveredDraft | null>(null)
  const [localRecoveryAvailable, setLocalRecoveryAvailable] = useState(true)
  const articleId = article?.id ?? createdId

  useEffect(() => {
    const flash = takeFlash()
    if (flash) setMessage(flash)
  }, [])

  useEffect(() => {
    try {
      const probe = `${DRAFT_KEY}:probe`
      window.localStorage.setItem(probe, "1")
      window.localStorage.removeItem(probe)
    } catch {
      // Private mode or a full quota: the header must not promise recovery.
      setLocalRecoveryAvailable(false)
    }
  }, [])

  // A snapshot left by a previous visit is offered back, never applied silently:
  // it may be older than what the server holds, and reverting the admin's stored
  // article without asking is worse than asking twice. Checked once per article,
  // because every router.refresh() hands down a new `article` object.
  const recoveryCheckedFor = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const id = article?.id ?? null
    if (recoveryCheckedFor.current === id) return
    recoveryCheckedFor.current = id
    const key = draftKey(id)
    const snapshot = readDraft(key)
    if (!snapshot) return
    const current = article ? fromArticle(article) : EMPTY_VALUE
    if (draftFingerprint(snapshot.value) === draftFingerprint(current)) {
      clearDraft(key)
      return
    }
    setRecovered({ atMs: snapshot.atMs, value: snapshot.value, key })
  }, [article])

  // The rolling snapshot is written whenever the editor holds content, and once
  // the server has the same content the snapshot is dropped.
  useEffect(() => {
    if (draftFingerprint(value) === draftFingerprint(EMPTY_VALUE)) return
    const key = draftKey(articleId)
    const timer = setTimeout(() => writeDraft(key, value), 800)
    return () => clearTimeout(timer)
  }, [value, articleId])

  function applyRecoveredDraft() {
    if (!recovered) return
    dirtyRef.current = true
    setValue((current) => recoveredContent(recovered.value, current))
    setSaveState("dirty")
    clearDraft(recovered.key)
    setRecovered(null)
    setMessage("Recovered the unsaved writing from this browser. It is stored only once it saves or publishes.")
  }

  function discardRecoveredDraft() {
    if (!recovered) return
    clearDraft(recovered.key)
    setRecovered(null)
  }

  const set = useCallback(<K extends keyof BlogEditorValue>(key: K, next: BlogEditorValue[K]) => {
    dirtyRef.current = true
    setValue((current) => ({ ...current, [key]: next }))
    setSaveState("dirty")
  }, [])

  const payload = useMemo(
    () => ({
      title: value.title.trim(),
      slug: value.slug.trim() || undefined,
      description: value.description.trim(),
      excerpt: value.excerpt.trim() || undefined,
      body: value.body,
      category: value.category,
      tags: value.tags,
      author: value.author,
      competitor: value.competitor?.trim() || undefined,
      comparison: value.comparison,
      featuredImage: value.featuredImage,
      seo: value.seo,
      status: value.status,
      featured: value.featured,
      relatedSlugs: value.relatedSlugs,
      scheduledFor: value.scheduledFor,
      publishedAt: value.publishedAt,
    }),
    [value],
  )

  const save = useCallback(
    async (silent = false) => {
      if (!articleId) return false
      setSaveState("saving")
      try {
        await patchJson<{ item: BlogArticleView }>(`/api/admin/blog/${articleId}`, payload)
        dirtyRef.current = false
        clearDraft(draftKey(articleId))
        setSavedAt(new Date().toISOString())
        setSaveState("saved")
        if (!silent) setMessage("Saved.")
        return true
      } catch (error) {
        setSaveState("error")
        setMessage(error instanceof Error ? error.message : "Could not save the article.")
        return false
      }
    },
    [articleId, payload],
  )

  // Autosave: debounced, only for saved articles, never while publishing.
  useEffect(() => {
    if (!articleId || !dirtyRef.current) return
    const timer = setTimeout(() => {
      void save(true)
    }, 2500)
    return () => clearTimeout(timer)
  }, [value, articleId, save])

  // Warn before losing unsaved work.
  useEffect(() => {
    if (!dirtyRef.current) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [value])

  useEffect(() => {
    if (!articleId) return
    fetch(`/api/admin/blog/${articleId}/revisions`, { credentials: "include" })
      .then((res) => res.json())
      .then((body) => {
        if (body?.ok && Array.isArray(body.data?.items)) setRevisions(body.data.items)
      })
      .catch(() => undefined)
  }, [articleId])

  /** Store the article for the first time and adopt the server's copy. Returns
   * the id, or null when nothing was created (the reason is in `message`). */
  async function ensureCreated(): Promise<string | null> {
    const response = await postJson<{ item: BlogArticleView }>("/api/admin/blog", payload)
    const id = response.item?.id
    if (!id) {
      setMessage("The article was created but the studio could not read it back. Open the article list and retry.")
      return null
    }
    setCreatedId(id)
    if (response.item) setValue(fromArticle(response.item))
    dirtyRef.current = false
    setSaveState("saved")
    setSavedAt(response.item?.updatedAt ?? new Date().toISOString())
    // The content is on the server now, so both the browser snapshot for the
    // "new article" screen and any restore offer are obsolete.
    clearDraft(draftKey(null))
    setRecovered(null)
    return id
  }

  async function createArticle() {
    setBusy("create")
    try {
      const id = await ensureCreated()
      if (id) router.push(`/admin/blog/articles/${id}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the article.")
      setBusy(null)
    }
  }

  async function runAction(action: "publish" | "schedule" | "unpublish" | "archive" | "restore" | "review") {
    setBusy(action)
    try {
      // Every action needs a stored article. On the "new article" screen the
      // first action creates the draft and then applies itself, instead of
      // doing nothing while the control looks clickable.
      let id = articleId
      // Was created during this action: the URL still says /new, so the admin
      // is moved to the article's own screen once the step succeeds.
      const wasCreated = id === null
      if (wasCreated) {
        try {
          id = await ensureCreated()
        } catch (error) {
          setMessage(
            `${error instanceof Error ? error.message : "The article could not be created."} Nothing was ${action === "publish" ? "published" : "changed"}.`,
          )
          setBusy(null)
          return
        }
        if (!id) {
          setMessage("Nothing was published — the article could not be created.")
          setBusy(null)
          return
        }
      } else if (dirtyRef.current) {
        const saved = await save(true)
        if (!saved) {
          // Publishing stale content is worse than not publishing: the admin
          // is told the action did not happen.
          setMessage((current) => `${current ? `${current} ` : ""}Nothing was published — the article could not be saved.`)
          setBusy(null)
          return
        }
      }
      const scheduledFor = action === "schedule" ? new Date(scheduleAt).getTime() : undefined
      const response = await postJson<{
        item: BlogArticleView
        announcement?: AnnouncementSummary
        indexing?: IndexingSummary
      }>(`/api/admin/blog/${id}/status`, { action, scheduledFor })
      // The server is the source of truth after an action. Without this the
      // editor kept the old status and the next autosave could undo it — a
      // scheduled article was silently turned back into a draft.
      if (response?.item) {
        dirtyRef.current = false
        setValue(fromArticle(response.item))
        setScheduleAt(formatScheduleInput(response.item.scheduledFor))
        setSavedAt(response.item.updatedAt ?? new Date().toISOString())
      }
      const announced = announcementMessage(response?.announcement)
      const indexed = indexingMessage(response?.indexing)
      const outcome =
        (action === "publish"
          ? "Published. The article is now public and eligible for indexing."
          : action === "schedule"
            ? "Scheduled. It goes live automatically at the chosen time."
            : action === "unpublish"
              ? "Unpublished. The article is back to a draft."
              : action === "archive"
                ? "Archived."
                : action === "review"
                  ? "Submitted for review."
                  : "Restored as a draft.") + (announced ?? "") + (indexed ?? "")
      setMessage(outcome)
      if (wasCreated && response?.item) {
        // The address still says /new while the article now exists. Moving to
        // the edit screen remounts the editor, so hand the outcome over first.
        stashFlash(outcome)
        router.replace(`/admin/blog/articles/${id}`)
        return
      }
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That action failed.")
    } finally {
      setBusy(null)
    }
  }

  async function runAudit() {
    if (!articleId) return
    setAuditLoading(true)
    try {
      if (dirtyRef.current) await save(true)
      const response = await postJson<{ report: BlogAuditReport }>("/api/admin/blog/audit", { articleId })
      setAudit(response.report)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The audit could not run.")
    } finally {
      setAuditLoading(false)
    }
  }

  async function restoreRevision(revisionId: string) {
    if (!articleId) return
    setBusy("restore")
    try {
      const response = await postJson<{ item: BlogArticleView }>(`/api/admin/blog/${articleId}/revisions`, { revisionId })
      setValue(fromArticle(response.item))
      setMessage("Revision restored.")
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not restore that revision.")
    } finally {
      setBusy(null)
    }
  }

  async function duplicate() {
    if (!articleId) return
    setBusy("duplicate")
    try {
      const response = await postJson<{ item: BlogArticleView }>(`/api/admin/blog/${articleId}/duplicate`)
      router.push(`/admin/blog/articles/${response.item.id}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not duplicate the article.")
      setBusy(null)
    }
  }

  async function remove() {
    if (!articleId) return
    const confirmed = window.confirm("Delete this article permanently? This also removes its revision history.")
    if (!confirmed) return
    setBusy("delete")
    try {
      await deleteJson(`/api/admin/blog/${articleId}`)
      router.push("/admin/blog/articles")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete the article.")
      setBusy(null)
    }
  }

  // Only a published article has a public URL to open; a draft or an unsaved
  // article would 404 there, so Preview renders it in the editor instead.
  const isLive = value.status === "published" && Boolean(articleId)
  const liveHref = `/blog/${value.slug || article?.slug}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {articleId ? "Edit article" : "New article"}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium capitalize">
              {value.status === "published" ? "Live" : value.status}
            </span>
            {!articleId ? (
              <span>
                Not stored yet — nothing is public.
                {localRecoveryAvailable
                  ? " The writing is kept in this browser as you type, so a reload can give it back."
                  : " This browser cannot keep a local copy, so create the draft before closing the tab."}
              </span>
            ) : saveState === "saving" ? (
              <span>Saving…</span>
            ) : saveState === "error" ? (
              <span className="text-destructive">Last save failed — the studio still holds your changes.</span>
            ) : saveState === "dirty" ? (
              <span>Unsaved changes</span>
            ) : (
              <span>
                Saved{savedAt ? ` ${formatSaved(savedAt)}` : " — no changes since"}
                {value.status !== "published" ? ". Not public yet." : "."}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLive ? (
            <Button variant="outline" size="sm" render={<Link href={liveHref} target="_blank" />}>
              <Eye className="size-4" /> View live page
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setTab("preview")}>
              <Eye className="size-4" /> Preview
            </Button>
          )}
          {articleId ? (
            <>
              <Button variant="outline" size="sm" onClick={() => void save()} disabled={saveState === "saving"}>
                <Save className="size-4" /> Save
              </Button>
              <Button variant="outline" size="sm" onClick={() => void duplicate()} disabled={busy === "duplicate"}>
                <Copy className="size-4" /> Duplicate
              </Button>
              <Button size="sm" onClick={() => void runAction("publish")} disabled={busy === "publish"}>
                {busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />} Publish
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void createArticle()} disabled={busy === "create"}>
              {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create draft
            </Button>
          )}
        </div>
      </div>

      {recovered ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">This browser holds writing that was never stored</p>
              <p className="text-xs text-muted-foreground">
                Snapshot from {formatRecovered(recovered.atMs)}. Restoring brings back the text, headings, image and SEO
                fields only — it never changes the article&apos;s status, schedule or what is already public.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={discardRecoveredDraft}>
              Discard
            </Button>
            <Button size="sm" onClick={applyRecoveredDraft}>
              Restore it
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{message}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="A descriptive headline" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">URL slug</Label>
              <Input
                id="slug"
                value={value.slug}
                onChange={(e) => set("slug", e.target.value)}
                placeholder="atai-vs-lovable"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Changing a published slug keeps the old URL working via a permanent redirect.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Meta description</Label>
              <Textarea
                id="description"
                rows={2}
                value={value.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="50–160 characters describing the article"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="excerpt">Excerpt</Label>
              <Textarea
                id="excerpt"
                rows={2}
                value={value.excerpt}
                onChange={(e) => set("excerpt", e.target.value)}
                placeholder="Short card summary shown on listing pages"
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <Label htmlFor="body">Article body (Markdown)</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Headings, lists, tables, quotes and code blocks are supported. Start at H2 — the title is the page H1.
              </p>
            </div>
            <MarkdownToolbar value={value.body} onChange={(next) => set("body", next)} textareaRef={bodyRef} />
            <Textarea
              id="body"
              ref={bodyRef}
              value={value.body}
              onChange={(e) => set("body", e.target.value)}
              rows={26}
              /* `field-sizing-content` is the shared Textarea default, which
                 grows the box to the whole article and turns the page into an
                 endless scroll. The body keeps a fixed height and scrolls
                 inside itself. */
              className="min-h-[420px] max-h-[70vh] field-sizing-fixed overflow-y-auto rounded-none border-0 font-mono text-[13px] leading-6 focus-visible:ring-0"
            />
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              How Markdown behaves here: a blank line separates paragraphs, a single line break does not — press Enter
              twice, or use the toolbar, which inserts complete blocks. Anything written as raw HTML (
              <code className="rounded bg-muted px-1 font-mono">&lt;br&gt;</code>,{" "}
              <code className="rounded bg-muted px-1 font-mono">&lt;b&gt;</code>) is stripped and will not render, so
              use the Markdown forms. The Preview tab uses the same renderer as the live page.
            </p>
          </section>

          <Tabs value={tab} onValueChange={setTab}>
            {/* Five tabs do not fit a phone in one unbreakable row: the strip
                wraps onto more lines instead of pushing the page sideways. */}
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="seo">SEO</TabsTrigger>
              <TabsTrigger value="comparison">Comparison</TabsTrigger>
              <TabsTrigger value="audit">Audit</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="mt-4">
              <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
                <p className="mb-3 text-xs text-muted-foreground">
                  Reader view. A long article scrolls inside this frame instead of stretching the studio page — the
                  published page is one continuous scroll.
                </p>
                <div className="max-h-[75vh] min-h-0 overflow-y-auto pr-1">
                  <ArticlePreview
                    article={{
                      title: value.title,
                      description: value.description,
                      excerpt: value.excerpt,
                      body: value.body,
                      category: value.category,
                      tags: value.tags,
                      competitor: value.competitor,
                      comparison: value.comparison,
                      featuredImage: value.featuredImage,
                      seo: value.seo,
                      author: value.author,
                      publishedAt: value.publishedAt,
                      updatedAt: value.updatedAt,
                    }}
                  />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="seo" className="mt-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <SeoPanel
                  seo={value.seo}
                  onChange={(next) => set("seo", next)}
                  siteUrl={siteUrl}
                  slug={value.slug || article?.slug || "slug"}
                  title={value.title || "Article title"}
                  description={value.description || "Article description"}
                />
              </div>
            </TabsContent>
            <TabsContent value="comparison" className="mt-4">
              <div className="rounded-xl border border-border bg-card p-4">
                {value.comparison ? (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => set("comparison", undefined)}>
                        <Trash2 className="size-4" /> Remove comparison
                      </Button>
                    </div>
                    <ComparisonEditor comparison={value.comparison} onChange={(next) => set("comparison", next)} />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      No structured comparison yet. Add one to render a side-by-side table with sources and verification dates.
                    </p>
                    <div className="max-w-sm space-y-1.5">
                      <Label htmlFor="comparison-competitor">Competitor name</Label>
                      <Input
                        id="comparison-competitor"
                        value={value.competitor ?? ""}
                        onChange={(e) => set("competitor", e.target.value)}
                        placeholder="Lovable"
                      />
                      <p className="text-xs text-muted-foreground">
                        The comparison is titled with this name, so it needs one before it can be added. It is the same
                        competitor tag the article carries.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!value.competitor?.trim()}
                      onClick={() =>
                        set("comparison", {
                          competitorName: value.competitor?.trim() ?? "",
                          rows: [],
                        })
                      }
                    >
                      <Plus className="size-4" /> Add comparison
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="audit" className="mt-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Content &amp; SEO audit</p>
                    <p className="text-xs text-muted-foreground">
                      Checks structure, metadata, evidence and freshness. It never publishes for you.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runAudit()}
                    disabled={auditLoading || !articleId}
                    title={articleId ? undefined : "Create the draft first — the audit reads the stored article."}
                  >
                    <Search className="size-4" /> {auditLoading ? "Auditing…" : "Run audit"}
                  </Button>
                </div>
                {audit ? (
                  <AuditPanel findings={audit.findings} score={audit.score} wordCount={audit.wordCount} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {articleId
                      ? "Run the audit to see specific findings and fixes."
                      : "The audit reads the stored article, so it needs the draft created first. It is a check, not a gate — publishing does not depend on it."}
                  </p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <History className="size-4" /> Revision history
                </p>
                {revisions.length ? (
                  <ul className="space-y-2">
                    {revisions.map((revision) => (
                      <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <div>
                          <p className="text-sm">{revision.note ?? "Saved version"}</p>
                          <p className="text-xs text-muted-foreground">{new Date(revision.createdAtMs).toLocaleString()}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void restoreRevision(revision.id)}
                          disabled={busy === "restore"}
                        >
                          Restore
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No saved versions yet.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <Label>Publishing</Label>
            {!articleId ? (
              <p className="rounded-lg border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                This article is not stored yet. Choosing “Published”, scheduling it or sending it to review creates
                the draft and applies that step in one go — you will be told what happened.
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="status" className="text-xs text-muted-foreground">
                Status
              </Label>
              <select
                id="status"
                value={value.status}
                onChange={(e) => {
                  const next = e.target.value as BlogEditorValue["status"]
                  // Publishing and scheduling are actions, not labels: they
                  // announce the article to subscribers and submit it for
                  // indexing, so they go through the server action.
                  if (next === "published") {
                    void runAction("publish")
                    return
                  }
                  if (next === "scheduled") {
                    if (!scheduleAt) {
                      setMessage("Pick a publication date and time before scheduling.")
                      return
                    }
                    void runAction("schedule")
                    return
                  }
                  set("status", next)
                }}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="draft">Draft</option>
                <option value="review">In review</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-at" className="text-xs text-muted-foreground">
                Schedule for
              </Label>
              <Input
                id="schedule-at"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void runAction("schedule")}
                disabled={busy === "schedule" || !scheduleAt}
              >
                <CalendarClock className="size-4" /> Schedule publication
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => void runAction("review")} disabled={busy === "review"}>
                <Check className="size-4" /> Send to review
              </Button>
              {articleId && value.status === "published" ? (
                <Button variant="outline" size="sm" onClick={() => void runAction("unpublish")} disabled={busy === "unpublish"}>
                  Unpublish
                </Button>
              ) : null}
              {articleId && value.status !== "archived" ? (
                <Button variant="outline" size="sm" onClick={() => void runAction("archive")} disabled={busy === "archive"}>
                  Archive
                </Button>
              ) : null}
              {articleId && value.status === "archived" ? (
                <Button variant="outline" size="sm" onClick={() => void runAction("restore")} disabled={busy === "restore"}>
                  Restore
                </Button>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={value.featured}
                onChange={(e) => set("featured", e.target.checked)}
              />
              Feature on the blog home page
            </label>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <Label>Classification</Label>
            <div className="space-y-1.5">
              <Label htmlFor="category" className="text-xs text-muted-foreground">
                Category
              </Label>
              <select
                id="category"
                value={value.category}
                onChange={(e) => set("category", e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
              >
                {categories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tags" className="text-xs text-muted-foreground">
                Tags (comma separated)
              </Label>
              <Input
                id="tags"
                value={value.tags.join(", ")}
                onChange={(e) => set("tags", e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor" className="text-xs text-muted-foreground">
                Competitor tag
              </Label>
              <Input
                id="competitor"
                value={value.competitor ?? ""}
                onChange={(e) => set("competitor", e.target.value)}
                placeholder="Lovable"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="related" className="text-xs text-muted-foreground">
                Related article slugs (comma separated)
              </Label>
              <Input
                id="related"
                value={value.relatedSlugs.join(", ")}
                onChange={(e) => set("relatedSlugs", e.target.value.split(",").map((slug) => slug.trim()).filter(Boolean))}
              />
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <Label>Author</Label>
            <div className="space-y-1.5">
              <Label htmlFor="author-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input
                id="author-name"
                value={value.author.name}
                onChange={(e) => set("author", { ...value.author, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="author-role" className="text-xs text-muted-foreground">
                Role
              </Label>
              <Input
                id="author-role"
                value={value.author.role ?? ""}
                onChange={(e) => set("author", { ...value.author, role: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="author-bio" className="text-xs text-muted-foreground">
                Bio
              </Label>
              <Textarea
                id="author-bio"
                rows={3}
                value={value.author.bio ?? ""}
                onChange={(e) => set("author", { ...value.author, bio: e.target.value })}
              />
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <Label>Featured image</Label>
            <div className="space-y-1.5">
              <Label htmlFor="image-url" className="text-xs text-muted-foreground">
                Image URL
              </Label>
              <Input
                id="image-url"
                value={value.featuredImage?.url ?? ""}
                onChange={(e) =>
                  set("featuredImage", { url: e.target.value, alt: value.featuredImage?.alt ?? "" })
                }
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="image-alt" className="text-xs text-muted-foreground">
                Alt text
              </Label>
              <Input
                id="image-alt"
                value={value.featuredImage?.alt ?? ""}
                onChange={(e) =>
                  set("featuredImage", { url: value.featuredImage?.url ?? "", alt: e.target.value })
                }
                placeholder="Describe the image"
              />
            </div>
          </section>

          {articleId ? (
            <Button variant="outline" size="sm" className="w-full text-destructive" onClick={() => void remove()}>
              <Trash2 className="size-4" /> Delete article
            </Button>
          ) : null}

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Publishing makes the article public and eligible for indexing. It does not mean any search engine or AI
            assistant has indexed or recommended it.
          </p>
        </aside>
      </div>
    </div>
  )
}
