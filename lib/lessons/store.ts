import "server-only"

import { lessonsCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { cryptoId } from "@/lib/store/id"
import { slugifyResource } from "@/lib/resources/media"
import { coreLessonsForStage, allCoreLessons } from "@/lib/lessons/curriculum"
import { LESSON_CATEGORY_FALLBACK } from "@/lib/lessons/taxonomy"
import type { AdminLessonInput, AdminLessonView, LessonDoc } from "@/lib/lessons/admin-types"
import type { CuratedLessonView, LibraryLessonView, LessonStage } from "@/lib/lessons/types"

const CACHE_TTL_MS = 60_000
const FAILURE_BACKOFF_MS = 60_000

type Cache = {
  at: number
  docs: LessonDoc[]
}

type Failure = {
  until: number
}

const globalForLessons = globalThis as unknown as {
  __ataiLessonCache?: Cache
  __ataiLessonFailure?: Failure
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build"
}

function toCuratedView(doc: LessonDoc): CuratedLessonView {
  return {
    id: doc.id,
    stage: doc.stage,
    categoryId: doc.categoryId || LESSON_CATEGORY_FALLBACK,
    title: doc.title,
    summary: doc.summary,
    href: `/lessons/${doc.slug}`,
    format: doc.format,
    topics: doc.topics,
    difficulty: doc.difficulty,
    readingMinutes: doc.readingMinutes,
    featured: doc.featured,
    youtubeUrl: doc.youtubeUrl,
    externalUrl: doc.externalUrl,
    file: doc.file,
    imageUrl: doc.imageUrl,
    source: "admin",
  }
}

/** Published admin lessons merged over the in-code core curriculum for a
 * stage. Featured lessons first, then admin lessons, then core. */
export async function lessonsForStage(stage: LessonStage): Promise<LibraryLessonView[]> {
  const docs = await readPublishedDocs()
  const curated = docs
    .filter((doc) => doc.stage === stage)
    .map(toCuratedView)
  const merged: LibraryLessonView[] = [...curated, ...coreLessonsForStage(stage)]
  const featuredOf = (lesson: LibraryLessonView) => (lesson.source === "admin" ? lesson.featured : false)
  return merged.sort((a, b) => {
    if (featuredOf(a) && !featuredOf(b)) return -1
    if (!featuredOf(a) && featuredOf(b)) return 1
    if (a.source === "admin" && b.source === "core") return -1
    if (a.source === "core" && b.source === "admin") return 1
    return 0
  })
}

export async function getPublishedLessonBySlug(slug: string): Promise<LessonDoc | null> {
  const docs = await readPublishedDocs()
  return docs.find((doc) => doc.slug === slug) ?? null
}

async function readPublishedDocs(): Promise<LessonDoc[]> {
  if (isBuildPhase()) return []
  const now = Date.now()
  const cached = globalForLessons.__ataiLessonCache
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.docs

  const failure = globalForLessons.__ataiLessonFailure
  if (failure && now < failure.until) return []

  try {
    const col = await lessonsCol()
    // Featured first, then newest — the cap keeps the library (and the
    // browser payload built from it) bounded no matter how large the
    // collection grows.
    const docs = (await col
      .find({ status: "published" })
      .sort({ featured: -1, updatedAtMs: -1 })
      .limit(500)
      .toArray()) as LessonDoc[]
    globalForLessons.__ataiLessonCache = { at: now, docs }
    globalForLessons.__ataiLessonFailure = undefined
    return docs
  } catch (error) {
    globalForLessons.__ataiLessonFailure = { until: now + FAILURE_BACKOFF_MS }
    logger.warn("lessons.store", "Could not load published lessons", {
      message: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export function invalidateLessonCache() {
  globalForLessons.__ataiLessonCache = undefined
  globalForLessons.__ataiLessonFailure = undefined
}

/** Every published library lesson (core curriculum + operator lessons). */
export async function allLibraryLessons(): Promise<LibraryLessonView[]> {
  const docs = await readPublishedDocs()
  return [...docs.map(toCuratedView), ...allCoreLessons()]
}

/** Published lessons indexed by their stable library id — the resolver used
 * by learning paths and per-user activity. */
export async function libraryLessonMap(): Promise<Map<string, LibraryLessonView>> {
  const lessons = await allLibraryLessons()
  return new Map(lessons.map((lesson) => [lesson.id, lesson]))
}

/** True only for a lesson a founder can actually open right now. */
export async function isPublishedLessonRef(ref: string): Promise<boolean> {
  return (await libraryLessonMap()).has(ref)
}

// ─── Admin operations ────────────────────────────────────────────────────────

export async function listAdminLessonDocs(): Promise<LessonDoc[]> {
  const col = await lessonsCol()
  return (await col.find({}).sort({ updatedAtMs: -1 }).toArray()) as LessonDoc[]
}

export async function getAdminLessonDoc(id: string): Promise<LessonDoc | null> {
  const col = await lessonsCol()
  return (await col.findOne({ id })) as LessonDoc | null
}

export function toAdminLessonView(doc: LessonDoc): AdminLessonView {
  return {
    id: doc.id,
    slug: doc.slug,
    stage: doc.stage,
    categoryId: doc.categoryId || LESSON_CATEGORY_FALLBACK,
    format: doc.format,
    title: doc.title,
    summary: doc.summary,
    topics: doc.topics,
    difficulty: doc.difficulty,
    readingMinutes: doc.readingMinutes,
    contentMarkdown: doc.contentMarkdown,
    imageUrl: doc.imageUrl,
    youtubeUrl: doc.youtubeUrl,
    externalUrl: doc.externalUrl,
    file: doc.file,
    featured: doc.featured,
    status: doc.status,
    publishedAt: doc.publishedAt,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    updatedAtMs: doc.updatedAtMs,
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
    href: `/lessons/${doc.slug}`,
  }
}

async function assertUniqueSlug(slug: string, exceptId?: string) {
  const col = await lessonsCol()
  const existing = await col.findOne({ slug })
  if (existing && (existing as LessonDoc).id !== exceptId) {
    throw new AppError("VALIDATION", "A lesson with that slug already exists.", 409)
  }
}

export async function createAdminLesson(input: AdminLessonInput, actorId: string): Promise<LessonDoc> {
  const slug = input.slug || slugifyResource(input.title)
  if (!slug) throw new AppError("VALIDATION", "Add a URL slug for this lesson.", 422)
  await assertUniqueSlug(slug)
  const now = Date.now()
  const doc: LessonDoc = {
    ...input,
    slug,
    id: `les_${cryptoId()}`,
    publishedAt: input.publishedAt || today(),
    updatedAt: input.updatedAt || today(),
    createdAt: now,
    updatedAtMs: now,
    createdBy: actorId,
    updatedBy: actorId,
  }
  const col = await lessonsCol()
  await col.insertOne(doc)
  invalidateLessonCache()
  return doc
}

export async function updateAdminLesson(
  id: string,
  patch: Partial<AdminLessonInput>,
  actorId: string,
): Promise<LessonDoc | null> {
  const existing = await getAdminLessonDoc(id)
  if (!existing) return null
  const nextSlug = patch.slug !== undefined ? patch.slug || slugifyResource(patch.title ?? existing.title) : existing.slug
  if (nextSlug !== existing.slug) await assertUniqueSlug(nextSlug, id)
  const update: Partial<LessonDoc> = {
    ...patch,
    slug: nextSlug,
    updatedAt: today(),
    updatedAtMs: Date.now(),
    updatedBy: actorId,
  }
  if (patch.status === "published" && !existing.publishedAt) update.publishedAt = today()
  if (patch.publishedAt === "") update.publishedAt = today()
  const col = await lessonsCol()
  await col.updateOne({ id }, { $set: update })
  invalidateLessonCache()
  return { ...existing, ...update }
}

export async function setAdminLessonStatus(
  id: string,
  status: LessonDoc["status"],
  actorId: string,
): Promise<LessonDoc | null> {
  return updateAdminLesson(id, { status }, actorId)
}

export async function deleteAdminLesson(id: string): Promise<boolean> {
  const col = await lessonsCol()
  const result = await col.deleteOne({ id })
  invalidateLessonCache()
  return result.deletedCount > 0
}
