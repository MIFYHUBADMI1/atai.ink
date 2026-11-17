import "server-only"

import { revalidatePath } from "next/cache"
import {
  blogArticlesCol,
  blogCampaignsCol,
  blogCategoriesCol,
  blogNewsletterCol,
  blogRedirectsCol,
  blogRevisionsCol,
  blogSettingsCol,
  blogStatsCol,
} from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { buildUpdate } from "@/lib/db/update"
import { logger } from "@/lib/logging/logger"
import { cryptoId } from "@/lib/store/id"
import { listBlogPosts } from "@/lib/blog/legacy"
import { readingMinutes, slugifyBlog, todayIso } from "@/lib/blog/content"
import { sanitizeBlogMarkdown, sanitizeBlogText } from "@/lib/blog/sanitize"
import { buildSlugRedirect, dueScheduledArticles, normalizeRedirectPath, resolveRedirect, transitionError, validateSchedule } from "@/lib/blog/logic"
import { DEFAULT_BLOG_CATEGORIES } from "@/lib/blog/types"
import type {
  BlogArticleDoc,
  BlogArticleInput,
  BlogArticleView,
  BlogAuditReport,
  BlogCampaignDoc,
  BlogCategoryDoc,
  BlogNewsletterDoc,
  BlogRedirectDoc,
  BlogRevisionDoc,
  BlogSettingsDoc,
  BlogStatDoc,
  BlogStatus,
} from "@/lib/blog/types"
import { auditArticle } from "@/lib/blog/audit"

const CACHE_TTL_MS = 60_000
const FAILURE_BACKOFF_MS = 60_000
const MAX_REVISIONS = 50

type Cache = { at: number; docs: BlogArticleDoc[] }
type Failure = { until: number }

const globalForBlog = globalThis as unknown as {
  __ataiBlogCache?: Cache
  __ataiBlogFailure?: Failure
}

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build"
}

// ─── Legacy seed mapping ─────────────────────────────────────────────────────
// The original blog shipped as blog/<slug>.md files. They remain on disk as the
// import seed and as a read-only fallback so the public site never goes empty
// before the one-time import runs. The database is the publishing source of
// truth; there is no second publishing path.

function legacyToDoc(post: ReturnType<typeof listBlogPosts>[number]): BlogArticleDoc {
  const now = Date.now()
  return {
    id: `legacy-${post.slug}`,
    slug: post.slug,
    title: post.title,
    description: post.description,
    excerpt: post.excerpt,
    body: post.body,
    category: post.competitor ? "comparisons" : "tutorials-guides",
    tags: post.tags,
    author: { name: "Atai Team", role: "Editorial" },
    competitor: post.competitor,
    comparison: post.comparison,
    seo: {},
    status: "published",
    featured: false,
    relatedSlugs: [],
    publishedAt: post.date,
    updatedAt: post.updated ?? post.date,
    readingMinutes: post.readingMinutes,
    views: 0,
    createdAtMs: now,
    updatedAtMs: now,
    createdBy: "legacy-import",
    updatedBy: "legacy-import",
  }
}

let legacyCache: { at: number; docs: BlogArticleDoc[] } | undefined

/** The legacy markdown seed, read once per cache window. The files are read
 * from disk on every call otherwise, which is wasteful on a hot public page. */
function legacyArticles(): BlogArticleDoc[] {
  const now = Date.now()
  if (legacyCache && now - legacyCache.at < CACHE_TTL_MS) return legacyCache.docs
  const docs = listBlogPosts().map(legacyToDoc)
  legacyCache = { at: now, docs }
  return docs
}

/** Published articles, falling back to the legacy seed while the database has
 * none. This must be applied on EVERY read path — including a cache hit —
 * otherwise the blog silently empties itself the moment the cache warms up. */
function publishedOrLegacy(docs: BlogArticleDoc[]): BlogArticleDoc[] {
  const published = docs.filter((doc) => doc.status === "published")
  if (published.length) return published
  return legacyArticles().filter((doc) => doc.status === "published")
}

// ─── Public reads ────────────────────────────────────────────────────────────

async function readAllDocs(): Promise<BlogArticleDoc[]> {
  const col = await blogArticlesCol()
  return (await col.find({}).sort({ publishedAt: -1, updatedAtMs: -1 }).toArray()) as BlogArticleDoc[]
}

async function promoteDueScheduled(docs: BlogArticleDoc[]): Promise<BlogArticleDoc[]> {
  const due = dueScheduledArticles(docs, Date.now())
  if (!due.length) return docs
  try {
    const col = await blogArticlesCol()
    for (const doc of due) {
      // The article went live on the day it was scheduled for, not on the day
      // a reader happened to trigger the promotion.
      const publishedAt =
        typeof doc.scheduledFor === "number" ? new Date(doc.scheduledFor).toISOString().slice(0, 10) : undefined
      await col.updateOne(
        { id: doc.id },
        {
          $set: {
            status: "published",
            updatedAtMs: Date.now(),
            ...(publishedAt ? { publishedAt } : {}),
          },
          $unset: { scheduledFor: "" },
        },
      )
      doc.status = "published"
      if (publishedAt) doc.publishedAt = publishedAt
      delete doc.scheduledFor
    }
    invalidateBlogCache()
  } catch (error) {
    logger.warn("blog.store", "Could not promote scheduled articles", {
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return docs
}

/** Published articles for public surfaces. During the production build (no DB
 * access) and on DB failure, falls back to the legacy markdown seed so pages
 * still render real content. */
export async function publicArticles(): Promise<BlogArticleDoc[]> {
  if (isBuildPhase()) return publishedOrLegacy([])
  const now = Date.now()
  const cached = globalForBlog.__ataiBlogCache
  if (cached && now - cached.at < CACHE_TTL_MS) {
    // The cache holds the raw database rows — the legacy fallback still has to
    // be applied here, or a warm cache empties the public blog.
    return publishedOrLegacy(cached.docs)
  }
  const failure = globalForBlog.__ataiBlogFailure
  if (failure && now < failure.until) {
    return publishedOrLegacy([])
  }
  try {
    const docs = await promoteDueScheduled(await readAllDocs())
    globalForBlog.__ataiBlogCache = { at: now, docs }
    globalForBlog.__ataiBlogFailure = undefined
    return publishedOrLegacy(docs)
  } catch (error) {
    globalForBlog.__ataiBlogFailure = { until: now + FAILURE_BACKOFF_MS }
    logger.warn("blog.store", "Could not load blog articles", {
      message: error instanceof Error ? error.message : String(error),
    })
    return publishedOrLegacy([])
  }
}

export function invalidateBlogCache() {
  globalForBlog.__ataiBlogCache = undefined
  globalForBlog.__ataiBlogFailure = undefined
  legacyCache = undefined
}

async function getPublicArticle(slug: string): Promise<BlogArticleDoc | null> {
  const normalized = slug.trim().toLowerCase()
  const articles = await publicArticles()
  return articles.find((article) => article.slug === normalized) ?? null
}

type SlugResolution =
  | { kind: "article"; article: BlogArticleDoc }
  | { kind: "redirect"; toSlug: string }
  | { kind: "missing" }

/** Resolve a public slug, following permanent redirects left by slug edits. */
export async function resolvePublicSlug(slug: string): Promise<SlugResolution> {
  const normalized = slug.trim().toLowerCase()
  const article = await getPublicArticle(normalized)
  if (article) return { kind: "article", article }
  try {
    const col = await blogRedirectsCol()
    const redirects = (await col.find({}).toArray()) as BlogRedirectDoc[]
    // A slug can be renamed more than once, so the whole chain is followed —
    // a single hop would leave the first old URL pointing at a slug that no
    // longer exists.
    const resolution = resolveRedirect(`/blog/${normalized}`, redirects)
    if (resolution.toSlug) {
      const target = await getPublicArticle(resolution.toSlug)
      if (target) return { kind: "redirect", toSlug: resolution.toSlug }
    }
  } catch {
    // Redirect lookup is best-effort; a missing article still 404s cleanly.
  }
  return { kind: "missing" }
}

/** The pillars that ship with the blog. They live in code, not in the
 * database — an edit materialises a stored copy that takes their place. */
const BUILTIN_CATEGORY_PREFIX = "default-"

function defaultCategories(): BlogCategoryDoc[] {
  return DEFAULT_BLOG_CATEGORIES.map((category, index) => ({
    id: `${BUILTIN_CATEGORY_PREFIX}${category.slug}`,
    slug: category.slug,
    name: category.name,
    description: category.description,
    order: index,
    createdAtMs: 0,
    updatedAtMs: 0,
    builtIn: true,
  }))
}

export async function publicCategories(): Promise<BlogCategoryDoc[]> {
  const defaults = defaultCategories()
  if (isBuildPhase()) return defaults
  try {
    const col = await blogCategoriesCol()
    const custom = (await col.find({}).sort({ order: 1 }).toArray()) as BlogCategoryDoc[]
    // A stored copy of a built-in pillar replaces it — by id, so a renamed
    // slug does not leave the original behind as a duplicate.
    const storedIds = new Set(custom.map((category) => category.id))
    const merged = new Map(
      defaults.filter((category) => !storedIds.has(category.id)).map((category) => [category.slug, category]),
    )
    for (const category of custom) {
      merged.set(category.slug, { ...category, builtIn: category.id.startsWith(BUILTIN_CATEGORY_PREFIX) })
    }
    return [...merged.values()].sort((a, b) => a.order - b.order)
  } catch {
    return defaults
  }
}

export async function getCategory(slug: string): Promise<BlogCategoryDoc | null> {
  const categories = await publicCategories()
  return categories.find((category) => category.slug === slug) ?? null
}

/** Related articles: the slugs the admin pinned first, then same competitor,
 * shared tags and category. */
export function relatedArticles(article: BlogArticleDoc, all: BlogArticleDoc[], limit = 3): BlogArticleDoc[] {
  const pinned = (article.relatedSlugs ?? [])
    .map((slug) => all.find((other) => other.slug === slug))
    .filter((other): other is BlogArticleDoc => Boolean(other) && other!.slug !== article.slug)
  const pinnedSlugs = new Set(pinned.map((entry) => entry.slug))
  const rest = all
    .filter((other) => other.slug !== article.slug && !pinnedSlugs.has(other.slug))
    .map((other) => {
      let score = 0
      if (article.competitor && other.competitor === article.competitor) score += 5
      if (other.category === article.category) score += 2
      score += other.tags.filter((tag) => article.tags.includes(tag)).length
      return { other, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.other)
  return [...pinned, ...rest].slice(0, limit)
}

// ─── Engagement ──────────────────────────────────────────────────────────────

export async function recordArticleView(slug: string): Promise<void> {
  // Only published articles in the database count. A draft never accrues views
  // and the legacy markdown seed is not a published document either.
  await publicArticles()
  const cached = globalForBlog.__ataiBlogCache
  const article = cached?.docs.find((entry) => entry.slug === slug)
  if (!article || article.status !== "published") return
  const date = todayIso()
  const [articlesCol, statsCol] = await Promise.all([blogArticlesCol(), blogStatsCol()])
  await Promise.all([
    articlesCol.updateOne({ slug }, { $inc: { views: 1 } }),
    statsCol.updateOne({ date, slug }, { $inc: { views: 1 } }, { upsert: true }),
  ])
  // Count the view in the cached copy instead of dropping the whole cache —
  // invalidating it on every read turned each article page into a full
  // database round trip.
  article.views = (article.views ?? 0) + 1
}

export async function subscribeNewsletter(email: string, source: string): Promise<{ alreadySubscribed: boolean }> {
  const col = await blogNewsletterCol()
  const normalized = email.trim().toLowerCase()
  const existing = await col.findOne({ email: normalized })
  if (existing) {
    // A reader who comes back after unsubscribing is welcomed again, so the
    // address goes back on the list instead of being stuck as "left".
    if (existing.unsubscribedAt) {
      await col.updateOne({ id: existing.id }, { $unset: { unsubscribedAt: "" } })
      return { alreadySubscribed: false }
    }
    return { alreadySubscribed: true }
  }
  const doc: BlogNewsletterDoc = { id: cryptoId(), email: normalized, source, createdAtMs: Date.now() }
  try {
    await col.insertOne(doc)
  } catch (error) {
    // Two concurrent submits of the same address: the unique index wins.
    if (error instanceof Error && /E11000|duplicate key/i.test(error.message)) {
      return { alreadySubscribed: true }
    }
    throw error
  }
  return { alreadySubscribed: false }
}

// ─── Admin reads ─────────────────────────────────────────────────────────────

interface AdminArticleFilter {
  status?: BlogStatus
  category?: string
  author?: string
  query?: string
}

export async function listAdminArticles(filter: AdminArticleFilter = {}): Promise<BlogArticleView[]> {
  const col = await blogArticlesCol()
  const query: Record<string, unknown> = {}
  if (filter.status) query.status = filter.status
  if (filter.category) query.category = filter.category
  const docs = (await col.find(query).sort({ updatedAtMs: -1 }).toArray()) as BlogArticleDoc[]
  const needle = filter.query?.trim().toLowerCase()
  const author = filter.author?.trim().toLowerCase()
  return docs
    .filter((doc) => !needle || doc.title.toLowerCase().includes(needle) || doc.slug.includes(needle))
    .filter((doc) => !author || doc.author.name.toLowerCase().includes(author))
    .map(toAdminView)
}

export function toAdminView(doc: BlogArticleDoc): BlogArticleView {
  const { _id, ...rest } = doc
  return { ...rest, href: `/admin/blog/articles/${doc.id}`, publicUrl: `/blog/${doc.slug}` }
}

export async function getAdminArticle(id: string): Promise<BlogArticleDoc | null> {
  const col = await blogArticlesCol()
  return (await col.findOne({ id })) as BlogArticleDoc | null
}

export async function blogStats(): Promise<{
  total: number
  published: number
  drafts: number
  review: number
  scheduled: number
  archived: number
  views: number
}> {
  const col = await blogArticlesCol()
  const docs = (await col.find({}).toArray()) as BlogArticleDoc[]
  return {
    total: docs.length,
    published: docs.filter((doc) => doc.status === "published").length,
    drafts: docs.filter((doc) => doc.status === "draft").length,
    review: docs.filter((doc) => doc.status === "review").length,
    scheduled: docs.filter((doc) => doc.status === "scheduled").length,
    archived: docs.filter((doc) => doc.status === "archived").length,
    views: docs.reduce((sum, doc) => sum + (doc.views ?? 0), 0),
  }
}

// ─── Admin writes ────────────────────────────────────────────────────────────

function snapshotOf(doc: BlogArticleDoc): BlogRevisionDoc["snapshot"] {
  return {
    title: doc.title,
    description: doc.description,
    excerpt: doc.excerpt,
    body: doc.body,
    category: doc.category,
    tags: doc.tags,
    author: doc.author,
    competitor: doc.competitor,
    comparison: doc.comparison,
    featuredImage: doc.featuredImage,
    seo: doc.seo,
    relatedSlugs: doc.relatedSlugs,
  }
}

async function pushRevision(doc: BlogArticleDoc, adminId: string, note?: string) {
  const col = await blogRevisionsCol()
  const revision: BlogRevisionDoc = {
    id: cryptoId(),
    articleId: doc.id,
    snapshot: snapshotOf(doc),
    note,
    createdAtMs: Date.now(),
    createdBy: adminId,
  }
  await col.insertOne(revision)
  const count = await col.countDocuments({ articleId: doc.id })
  if (count > MAX_REVISIONS) {
    const oldest = (await col
      .find({ articleId: doc.id })
      .sort({ createdAtMs: 1 })
      .limit(count - MAX_REVISIONS)
      .toArray()) as BlogRevisionDoc[]
    await col.deleteMany({ id: { $in: oldest.map((entry) => entry.id) } })
  }
}

function inputToDoc(input: BlogArticleInput, id: string, adminId: string, existing?: BlogArticleDoc): BlogArticleDoc {
  const now = Date.now()
  const slug = input.slug?.trim() || slugifyBlog(input.title)
  if (!slug) throw new AppError("VALIDATION", "Add a URL slug for this article.", 422)
  // Defence in depth: the renderer never executes stored content, but the
  // stored document itself is kept clean so it stays safe to move around.
  const title = sanitizeBlogText(input.title)
  const description = sanitizeBlogText(input.description)
  const excerpt = input.excerpt?.trim() ? sanitizeBlogText(input.excerpt) : description.slice(0, 200)
  const body = sanitizeBlogMarkdown(input.body)
  return {
    id,
    slug,
    title,
    description,
    excerpt,
    body,
    category: input.category,
    tags: input.tags.map((tag) => sanitizeBlogText(tag)).filter(Boolean),
    author: {
      ...input.author,
      name: sanitizeBlogText(input.author.name),
      role: input.author.role ? sanitizeBlogText(input.author.role) : undefined,
      bio: input.author.bio ? sanitizeBlogText(input.author.bio) : undefined,
    },
    competitor: input.competitor ? sanitizeBlogText(input.competitor) : undefined,
    comparison: input.comparison
      ? {
          ...input.comparison,
          competitorName: sanitizeBlogText(input.comparison.competitorName),
          competitorDescription: input.comparison.competitorDescription
            ? sanitizeBlogText(input.comparison.competitorDescription)
            : undefined,
          positioning: input.comparison.positioning ? sanitizeBlogText(input.comparison.positioning) : undefined,
          limitations: input.comparison.limitations ? sanitizeBlogText(input.comparison.limitations) : undefined,
          rows: input.comparison.rows.map((row) => ({
            ...row,
            dimension: sanitizeBlogText(row.dimension),
            atai: sanitizeBlogText(row.atai),
            competitor: sanitizeBlogText(row.competitor),
            evidence: row.evidence ? sanitizeBlogText(row.evidence) : undefined,
            note: row.note ? sanitizeBlogText(row.note) : undefined,
          })),
        }
      : undefined,
    featuredImage: input.featuredImage
      ? { url: input.featuredImage.url, alt: sanitizeBlogText(input.featuredImage.alt) }
      : undefined,
    seo: {
      ...input.seo,
      title: input.seo?.title ? sanitizeBlogText(input.seo.title) : undefined,
      description: input.seo?.description ? sanitizeBlogText(input.seo.description) : undefined,
      ogTitle: input.seo?.ogTitle ? sanitizeBlogText(input.seo.ogTitle) : undefined,
      ogDescription: input.seo?.ogDescription ? sanitizeBlogText(input.seo.ogDescription) : undefined,
      focusKeyword: input.seo?.focusKeyword ? sanitizeBlogText(input.seo.focusKeyword) : undefined,
    },
    status: input.status,
    featured: input.featured ?? false,
    relatedSlugs: input.relatedSlugs,
    publishedAt: input.publishedAt || existing?.publishedAt || todayIso(),
    // The server owns the "last edited" date — a client can never backdate it.
    updatedAt: todayIso(),
    // A scheduled article keeps its publication time when the admin edits the
    // content, so the date cannot be dropped by an unrelated save.
    scheduledFor: input.status === "scheduled" ? (input.scheduledFor ?? existing?.scheduledFor) : undefined,
    readingMinutes: readingMinutes(body),
    views: existing?.views ?? 0,
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    createdBy: existing?.createdBy ?? adminId,
    updatedBy: adminId,
  }
}

export async function createArticle(input: BlogArticleInput, adminId: string): Promise<BlogArticleDoc> {
  const col = await blogArticlesCol()
  const id = cryptoId()
  const doc = inputToDoc(input, id, adminId)
  const scheduleError = validateSchedule(doc.status, doc.scheduledFor, Date.now())
  if (scheduleError) throw new AppError("VALIDATION", scheduleError, 422)
  if (await col.findOne({ slug: doc.slug })) {
    throw new AppError("VALIDATION", `The slug "${doc.slug}" is already used by another article.`, 409)
  }
  await col.insertOne(doc)
  await pushRevision(doc, adminId, "Created")
  invalidateBlogCache()
  revalidateBlogSurfaces(doc)
  return doc
}

export async function updateArticle(id: string, input: BlogArticleInput, adminId: string): Promise<BlogArticleDoc> {
  const col = await blogArticlesCol()
  const existing = (await col.findOne({ id })) as BlogArticleDoc | null
  if (!existing) throw new AppError("NOT_FOUND", "Article not found.", 404)
  const doc = inputToDoc(input, id, adminId, existing)
  // A schedule the admin did not touch is not re-validated: an article whose
  // time has come is due to go live, and a content save must not be blocked
  // by a date that was already in the past.
  const keepsSchedule = input.status === "scheduled" && input.scheduledFor === undefined
  const scheduleError =
    keepsSchedule && typeof doc.scheduledFor === "number"
      ? null
      : validateSchedule(doc.status, doc.scheduledFor, Date.now())
  if (scheduleError) throw new AppError("VALIDATION", scheduleError, 422)
  const clash = (await col.findOne({ slug: doc.slug, id: { $ne: id } })) as BlogArticleDoc | null
  if (clash) throw new AppError("VALIDATION", `The slug "${doc.slug}" is already used by another article.`, 409)

  // Preserve link equity: a changed published slug keeps a permanent redirect.
  if (existing.slug !== doc.slug && existing.status === "published") {
    const redirect = buildSlugRedirect(existing.slug, doc.slug)
    if (redirect) await upsertRedirect(redirect.from, redirect.toSlug, adminId, "Slug changed")
  }

  await pushRevision(existing, adminId, "Before edit")
  await col.replaceOne({ id }, doc)
  invalidateBlogCache()
  revalidateBlogSurfaces(doc)
  if (existing.slug !== doc.slug) revalidatePath(`/blog/${existing.slug}`)
  return doc
}

export async function setArticleStatus(
  id: string,
  action: "publish" | "schedule" | "unpublish" | "archive" | "restore" | "review",
  adminId: string,
  scheduledFor?: number,
): Promise<BlogArticleDoc> {
  const col = await blogArticlesCol()
  const existing = (await col.findOne({ id })) as BlogArticleDoc | null
  if (!existing) throw new AppError("NOT_FOUND", "Article not found.", 404)

  const next: Partial<BlogArticleDoc> = { updatedBy: adminId, updatedAtMs: Date.now() }
  let target: BlogStatus = existing.status
  switch (action) {
    case "publish":
      target = "published"
      next.status = "published"
      // The publication date is the day the article went live — not the day
      // the draft was written. An article that was already published keeps
      // its original date.
      next.publishedAt = existing.status === "published" ? existing.publishedAt || todayIso() : todayIso()
      next.scheduledFor = undefined
      break
    case "schedule": {
      const error = validateSchedule("scheduled", scheduledFor, Date.now())
      if (error) throw new AppError("VALIDATION", error, 422)
      target = "scheduled"
      next.status = "scheduled"
      next.scheduledFor = scheduledFor
      break
    }
    case "unpublish":
      target = "draft"
      next.status = "draft"
      break
    case "archive":
      target = "archived"
      next.status = "archived"
      break
    case "restore":
      target = "draft"
      next.status = "draft"
      break
    case "review":
      target = "review"
      next.status = "review"
      break
  }
  // Publishing a scheduled article and letting it go live on its own are the
  // same move; every other jump has to be a legal one.
  const illegal = transitionError(existing.status, target)
  if (illegal) throw new AppError("VALIDATION", illegal, 422)
  // An empty `$unset` is rejected by the server, so the operator is only
  // added when there is a field to clear.
  const clearsSchedule = action === "publish" || action === "unpublish"
  await col.updateOne({ id }, buildUpdate({ ...(next as Record<string, unknown>), ...(clearsSchedule ? { scheduledFor: undefined } : {}) }))
  const updated = (await col.findOne({ id })) as BlogArticleDoc
  invalidateBlogCache()
  revalidateBlogSurfaces(updated)
  return updated
}

export async function duplicateArticle(id: string, adminId: string): Promise<BlogArticleDoc> {
  const existing = await getAdminArticle(id)
  if (!existing) throw new AppError("NOT_FOUND", "Article not found.", 404)
  const col = await blogArticlesCol()
  let slug = `${existing.slug}-copy`
  let suffix = 2
  while (await col.findOne({ slug })) {
    slug = `${existing.slug}-copy-${suffix++}`
  }
  const copy: BlogArticleDoc = {
    ...existing,
    id: cryptoId(),
    slug,
    title: `${existing.title} (copy)`,
    status: "draft",
    featured: false,
    views: 0,
    publishedAt: todayIso(),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    createdBy: adminId,
    updatedBy: adminId,
  }
  delete copy._id
  await col.insertOne(copy)
  invalidateBlogCache()
  return copy
}

export async function deleteArticle(id: string): Promise<void> {
  const col = await blogArticlesCol()
  const existing = (await col.findOne({ id })) as BlogArticleDoc | null
  if (!existing) throw new AppError("NOT_FOUND", "Article not found.", 404)
  await col.deleteOne({ id })
  const revisions = await blogRevisionsCol()
  await revisions.deleteMany({ articleId: id })
  invalidateBlogCache()
  revalidateBlogSurfaces(existing)
}

// ─── Revisions ───────────────────────────────────────────────────────────────

export async function listRevisions(articleId: string): Promise<BlogRevisionDoc[]> {
  const col = await blogRevisionsCol()
  const docs = (await col.find({ articleId }).sort({ createdAtMs: -1 }).limit(MAX_REVISIONS).toArray()) as BlogRevisionDoc[]
  return docs.map(({ _id, ...rest }) => rest)
}

export async function restoreRevision(articleId: string, revisionId: string, adminId: string): Promise<BlogArticleDoc> {
  const revisions = await blogRevisionsCol()
  const revision = (await revisions.findOne({ id: revisionId, articleId })) as BlogRevisionDoc | null
  if (!revision) throw new AppError("NOT_FOUND", "Revision not found.", 404)
  const existing = await getAdminArticle(articleId)
  if (!existing) throw new AppError("NOT_FOUND", "Article not found.", 404)
  await pushRevision(existing, adminId, "Before restore")
  const col = await blogArticlesCol()
  const restored: BlogArticleDoc = {
    ...existing,
    ...revision.snapshot,
    readingMinutes: readingMinutes(revision.snapshot.body),
    updatedAt: todayIso(),
    updatedAtMs: Date.now(),
    updatedBy: adminId,
  }
  await col.replaceOne({ id: articleId }, restored)
  invalidateBlogCache()
  revalidateBlogSurfaces(restored)
  return restored
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function listAdminCategories(): Promise<BlogCategoryDoc[]> {
  return publicCategories()
}

export async function upsertCategory(
  input: { slug?: string; name: string; description?: string; seoTitle?: string; seoDescription?: string; order?: number },
  id?: string,
): Promise<BlogCategoryDoc> {
  const col = await blogCategoriesCol()
  const slug = input.slug?.trim() || slugifyBlog(input.name)
  if (!slug) throw new AppError("VALIDATION", "Add a URL slug for this category.", 422)
  const now = Date.now()
  if (id) {
    const existing = (await col.findOne({ id })) as BlogCategoryDoc | null
    if (existing) {
      const updated: BlogCategoryDoc = {
        ...existing,
        ...input,
        // An omitted order keeps the current one — the sort must not break.
        order: input.order ?? existing.order,
        slug,
        updatedAtMs: now,
      }
      await col.replaceOne({ id }, updated)
      return updated
    }
    // A built-in pillar has no stored row yet. Writing one turns the edit
    // into a stored override that takes the pillar's place.
    const builtin = defaultCategories().find((category) => category.id === id)
    if (!builtin) throw new AppError("NOT_FOUND", "Category not found.", 404)
    const updated: BlogCategoryDoc = {
      ...builtin,
      ...input,
      order: input.order ?? builtin.order,
      slug,
      createdAtMs: builtin.createdAtMs,
      updatedAtMs: now,
    }
    await col.replaceOne({ id }, updated, { upsert: true })
    return updated
  }
  if (await col.findOne({ slug })) throw new AppError("VALIDATION", `Category "${slug}" already exists.`, 409)
  const doc: BlogCategoryDoc = {
    id: cryptoId(),
    slug,
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    order: input.order ?? 100,
    createdAtMs: now,
    updatedAtMs: now,
  }
  await col.insertOne(doc)
  return doc
}

export async function deleteCategory(id: string): Promise<void> {
  const col = await blogCategoriesCol()
  const existing = (await col.findOne({ id })) as BlogCategoryDoc | null
  const isBuiltin = id.startsWith(BUILTIN_CATEGORY_PREFIX)
  if (!existing) {
    if (isBuiltin) {
      throw new AppError(
        "VALIDATION",
        "Built-in categories cannot be deleted — rename the category instead.",
        409,
      )
    }
    throw new AppError("NOT_FOUND", "Category not found.", 404)
  }
  if (isBuiltin) {
    throw new AppError(
      "VALIDATION",
      "Built-in categories cannot be deleted — rename the category instead.",
      409,
    )
  }
  const articles = await blogArticlesCol()
  const inUse = await articles.countDocuments({ category: existing.slug, status: { $ne: "archived" } })
  if (inUse > 0) throw new AppError("VALIDATION", `${inUse} article(s) still use this category. Move them first.`, 409)
  await col.deleteOne({ id })
}

// ─── Redirects ───────────────────────────────────────────────────────────────

export async function listRedirects(): Promise<BlogRedirectDoc[]> {
  const col = await blogRedirectsCol()
  const docs = (await col.find({}).sort({ createdAtMs: -1 }).toArray()) as BlogRedirectDoc[]
  return docs.map(({ _id, ...rest }) => rest)
}

export async function upsertRedirect(from: string, toSlug: string, adminId: string, reason?: string): Promise<BlogRedirectDoc> {
  const normalized = normalizeRedirectPath(from)
  if (!normalized.startsWith("/blog/")) throw new AppError("VALIDATION", "Redirects must start with /blog/.", 422)
  if (normalized === `/blog/${toSlug}`) throw new AppError("VALIDATION", "A redirect cannot point at itself.", 422)
  const col = await blogRedirectsCol()
  const existing = (await col.findOne({ from: normalized })) as BlogRedirectDoc | null
  // Point straight at the final slug. When an article is renamed twice the
  // old entry would otherwise point at a slug that no longer exists.
  const chain = (await col.find({}).toArray()) as BlogRedirectDoc[]
  const resolved = resolveRedirect(`/blog/${toSlug}`, chain)
  const targetSlug = resolved.loop ? toSlug : (resolved.toSlug ?? toSlug)
  const doc: BlogRedirectDoc = {
    id: existing?.id ?? cryptoId(),
    from: normalized,
    toSlug: targetSlug,
    reason,
    createdAtMs: existing?.createdAtMs ?? Date.now(),
    createdBy: adminId,
  }
  await col.replaceOne({ from: normalized }, doc, { upsert: true })
  return doc
}

export async function deleteRedirect(id: string): Promise<void> {
  const col = await blogRedirectsCol()
  await col.deleteOne({ id })
}

// ─── Audits ──────────────────────────────────────────────────────────────────

export async function auditOne(id: string): Promise<BlogAuditReport> {
  const article = await getAdminArticle(id)
  if (!article) throw new AppError("NOT_FOUND", "Article not found.", 404)
  const others = (await listAdminArticles()).map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    description: entry.description,
  }))
  return auditArticle(article, { others })
}

export async function auditAll(): Promise<BlogAuditReport[]> {
  const articles = await listAdminArticles()
  const others = articles.map((entry) => ({ slug: entry.slug, title: entry.title, description: entry.description }))
  return articles.map((article) => auditArticle(article, { others }))
}

// ─── Performance ─────────────────────────────────────────────────────────────

interface BlogPerformanceRow {
  slug: string
  title: string
  status: BlogStatus
  views: number
  publishedAt: string
  daily: { date: string; views: number }[]
}

export async function blogPerformance(days = 30): Promise<{
  rows: BlogPerformanceRow[]
  totals: { views: number; articles: number; published: number }
  daily: { date: string; views: number }[]
}> {
  const articles = await listAdminArticles()
  const statsCol = await blogStatsCol()
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const stats = (await statsCol.find({ date: { $gte: since } }).toArray()) as BlogStatDoc[]
  const bySlug = new Map<string, { date: string; views: number }[]>()
  const byDate = new Map<string, number>()
  for (const stat of stats) {
    const list = bySlug.get(stat.slug) ?? []
    list.push({ date: stat.date, views: stat.views })
    bySlug.set(stat.slug, list)
    byDate.set(stat.date, (byDate.get(stat.date) ?? 0) + stat.views)
  }
  const rows: BlogPerformanceRow[] = articles.map((article) => ({
    slug: article.slug,
    title: article.title,
    status: article.status,
    views: article.views,
    publishedAt: article.publishedAt,
    daily: (bySlug.get(article.slug) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1)),
  }))
  rows.sort((a, b) => b.views - a.views)
  return {
    rows,
    totals: {
      views: articles.reduce((sum, article) => sum + article.views, 0),
      articles: articles.length,
      published: articles.filter((article) => article.status === "published").length,
    },
    daily: [...byDate.entries()].map(([date, views]) => ({ date, views })).sort((a, b) => (a.date < b.date ? -1 : 1)),
  }
}

export async function listNewsletter(): Promise<BlogNewsletterDoc[]> {
  const col = await blogNewsletterCol()
  const docs = (await col.find({}).sort({ createdAtMs: -1 }).toArray()) as BlogNewsletterDoc[]
  return docs.map(({ _id, ...rest }) => rest)
}

/**
 * The audience an announcement may be sent to.
 *
 * Unsubscribed readers are excluded here, not at the call site, so no sending
 * path can reach them by accident.
 */
export async function listNewsletterAudience(): Promise<{ recipients: BlogNewsletterDoc[]; unsubscribedCount: number }> {
  const docs = await listNewsletter()
  const recipients = docs.filter((doc) => !doc.unsubscribedAt)
  return { recipients, unsubscribedCount: docs.length - recipients.length }
}

/** Mark a subscriber as unsubscribed. Returns false when the address is unknown. */
export async function unsubscribeNewsletter(email: string): Promise<boolean> {
  const col = await blogNewsletterCol()
  const normalized = email.trim().toLowerCase()
  const existing = (await col.findOne({ email: normalized })) as BlogNewsletterDoc | null
  if (!existing) return false
  if (!existing.unsubscribedAt) {
    await col.updateOne({ id: existing.id }, { $set: { unsubscribedAt: Date.now() } })
  }
  return true
}

/** Look a subscriber up by the id that appears in an unsubscribe link. */
export async function getNewsletterSubscriber(id: string): Promise<BlogNewsletterDoc | null> {
  const col = await blogNewsletterCol()
  const doc = (await col.findOne({ id })) as BlogNewsletterDoc | null
  if (!doc) return null
  const { _id, ...rest } = doc
  return rest
}

/** The record of one announcement attempt. */
export async function recordCampaign(doc: BlogCampaignDoc): Promise<BlogCampaignDoc> {
  const col = await blogCampaignsCol()
  await col.insertOne(doc)
  return doc
}

/** Close out a campaign once its delivery attempt finished. */
export async function updateCampaign(id: string, patch: Partial<BlogCampaignDoc>): Promise<void> {
  const col = await blogCampaignsCol()
  await col.updateOne({ id }, buildUpdate({ ...(patch as Record<string, unknown>) }))
}

/** Recent announcement attempts, newest first. */
export async function listCampaigns(limit = 20): Promise<BlogCampaignDoc[]> {
  const col = await blogCampaignsCol()
  const docs = (await col.find({}).sort({ createdAtMs: -1 }).limit(limit).toArray()) as BlogCampaignDoc[]
  return docs.map(({ _id, ...rest }) => rest)
}

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: BlogSettingsDoc = {
  id: "blog-settings",
  indexNowEnabled: false,
  newsletterAutoAnnounce: false,
  updatedAtMs: 0,
}

export async function getBlogSettings(): Promise<BlogSettingsDoc> {
  try {
    const col = await blogSettingsCol()
    const doc = (await col.findOne({ id: "blog-settings" })) as BlogSettingsDoc | null
    return doc ?? DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function updateBlogSettings(patch: Partial<BlogSettingsDoc>): Promise<BlogSettingsDoc> {
  const col = await blogSettingsCol()
  const current = await getBlogSettings()
  const next: BlogSettingsDoc = { ...current, ...patch, id: "blog-settings", updatedAtMs: Date.now() }
  await col.replaceOne({ id: "blog-settings" }, next, { upsert: true })
  return next
}

// ─── Legacy import (one-time migration) ──────────────────────────────────────

export async function importLegacyArticles(adminId: string): Promise<{ imported: string[]; skipped: string[] }> {
  const col = await blogArticlesCol()
  const imported: string[] = []
  const skipped: string[] = []
  for (const legacy of legacyArticles()) {
    if (await col.findOne({ slug: legacy.slug })) {
      skipped.push(legacy.slug)
      continue
    }
    const doc: BlogArticleDoc = { ...legacy, id: cryptoId(), createdBy: adminId, updatedBy: adminId }
    await col.insertOne(doc)
    imported.push(doc.slug)
  }
  invalidateBlogCache()
  revalidateBlogSurfaces()
  return { imported, skipped }
}

// ─── Revalidation ────────────────────────────────────────────────────────────

/** Refresh every public surface that renders blog content so a publish is
 * visible without a redeploy. Mirrors the resources revalidation pattern. */
function revalidateBlogSurfaces(article?: { slug: string; category?: string }) {
  const paths = new Set([
    "/blog",
    "/sitemap.xml",
    "/seo/sitemap.xml",
    "/llms.txt",
    "/llms-full.txt",
  ])
  if (article) {
    paths.add(`/blog/${article.slug}`)
    if (article.category) paths.add(`/blog/category/${article.category}`)
  }
  for (const path of paths) {
    try {
      revalidatePath(path)
    } catch {
      // Best-effort: route handlers outside a request scope cannot revalidate.
    }
  }
}