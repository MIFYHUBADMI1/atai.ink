import "server-only"

import { learningPathsCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { cryptoId } from "@/lib/store/id"
import { slugifyResource } from "@/lib/resources/media"
import {
  DEFAULT_LEARNING_PATHS,
  isDefaultLearningPath,
  sortLearningPaths,
  toLearningPathView,
  type LearningPathDoc,
  type LearningPathInput,
  type LearningPathView,
} from "@/lib/lessons/paths"

const CACHE_TTL_MS = 60_000
const FAILURE_BACKOFF_MS = 60_000

type Cache = { at: number; docs: LearningPathDoc[] }
type Failure = { until: number }

const globalForPaths = globalThis as unknown as {
  __ataiLearningPathCache?: Cache
  __ataiLearningPathFailure?: Failure
}

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build"
}

function defaults(): LearningPathDoc[] {
  return DEFAULT_LEARNING_PATHS.map((path) => ({ ...path }))
}

/** Defaults overlaid by stored documents, plus stored-only paths. */
function mergePaths(docs: readonly LearningPathDoc[]): LearningPathDoc[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const merged = DEFAULT_LEARNING_PATHS.map((path) => byId.get(path.id) ?? path)
  for (const doc of docs) {
    if (!isDefaultLearningPath(doc.id)) merged.push(doc)
  }
  return sortLearningPaths(merged)
}

async function readPathDocs(): Promise<LearningPathDoc[]> {
  if (isBuildPhase()) return defaults()

  const now = Date.now()
  const cached = globalForPaths.__ataiLearningPathCache
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.docs

  const failure = globalForPaths.__ataiLearningPathFailure
  if (failure && now < failure.until) return defaults()

  try {
    const col = await learningPathsCol()
    const docs = (await col.find({}).toArray()) as LearningPathDoc[]
    globalForPaths.__ataiLearningPathCache = { at: now, docs }
    globalForPaths.__ataiLearningPathFailure = undefined
    return docs
  } catch (error) {
    globalForPaths.__ataiLearningPathFailure = { until: now + FAILURE_BACKOFF_MS }
    logger.warn("lessons.paths", "Could not load learning paths; using defaults", {
      message: error instanceof Error ? error.message : String(error),
    })
    return defaults()
  }
}

export function invalidateLearningPathCache() {
  globalForPaths.__ataiLearningPathCache = undefined
  globalForPaths.__ataiLearningPathFailure = undefined
}

export async function listPublishedLearningPaths(): Promise<LearningPathView[]> {
  const docs = await readPathDocs()
  return mergePaths(docs)
    .filter((path) => path.status === "published")
    .map(toLearningPathView)
}

export async function getPublishedLearningPath(slug: string): Promise<LearningPathView | null> {
  const docs = await readPathDocs()
  const found = mergePaths(docs).find((path) => path.status === "published" && path.slug === slug)
  return found ? toLearningPathView(found) : null
}

export type AdminLearningPathView = Omit<LearningPathDoc, "_id"> & { isDefault: boolean }

export async function listAdminLearningPaths(): Promise<AdminLearningPathView[]> {
  const stored = new Map((await readPathDocs()).map((doc) => [doc.id, doc]))
  const merged = mergePaths([...stored.values()])
  return merged
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.order - b.order)
    .map(({ _id: _ignored, ...path }) => ({ ...path, isDefault: isDefaultLearningPath(path.id) }))
}

async function assertUniqueSlug(slug: string, exceptId?: string) {
  const col = await learningPathsCol()
  const stored = (await col.findOne({ slug })) as LearningPathDoc | null
  if (stored && stored.id !== exceptId) {
    throw new AppError("VALIDATION", "A learning path with that slug already exists.", 409)
  }
  const defaultClash = DEFAULT_LEARNING_PATHS.find((path) => path.slug === slug && path.id !== exceptId)
  if (defaultClash && defaultClash.id !== exceptId) {
    const override = await col.findOne({ id: defaultClash.id })
    if (!override) throw new AppError("VALIDATION", "A learning path with that slug already exists.", 409)
  }
}

export async function createLearningPath(input: LearningPathInput, actorId: string): Promise<LearningPathDoc> {
  const slug = input.slug || slugifyResource(input.title)
  if (!slug) throw new AppError("VALIDATION", "Add a URL slug for this learning path.", 422)
  await assertUniqueSlug(slug)
  const now = Date.now()
  const doc: LearningPathDoc = {
    ...input,
    slug,
    id: `path_${cryptoId()}`,
    createdAt: now,
    updatedAtMs: now,
    createdBy: actorId,
    updatedBy: actorId,
  }
  const col = await learningPathsCol()
  await col.insertOne(doc)
  invalidateLearningPathCache()
  return doc
}

async function readWritablePath(id: string): Promise<LearningPathDoc | null> {
  const col = await learningPathsCol()
  const stored = (await col.findOne({ id })) as LearningPathDoc | null
  if (stored) return stored
  const fallback = DEFAULT_LEARNING_PATHS.find((path) => path.id === id)
  return fallback ? { ...fallback } : null
}

export async function updateLearningPath(
  id: string,
  patch: Partial<LearningPathInput>,
  actorId: string,
): Promise<LearningPathDoc | null> {
  const base = await readWritablePath(id)
  if (!base) return null

  const nextSlug =
    patch.slug !== undefined ? patch.slug || slugifyResource(patch.title ?? base.title) : base.slug
  if (!nextSlug) throw new AppError("VALIDATION", "Add a URL slug for this learning path.", 422)
  if (nextSlug !== base.slug) await assertUniqueSlug(nextSlug, id)

  const next: LearningPathDoc = {
    ...base,
    ...patch,
    id,
    slug: nextSlug,
    updatedAtMs: Date.now(),
    updatedBy: actorId,
  }
  const col = await learningPathsCol()
  await col.replaceOne({ id }, next, { upsert: true })
  invalidateLearningPathCache()
  return next
}

/** Hard delete for admin-created paths. Defaults can only be archived so the
 * curated library cannot lose its starting paths by accident. */
export async function deleteLearningPath(id: string): Promise<boolean> {
  if (isDefaultLearningPath(id)) {
    throw new AppError("VALIDATION", "Built-in paths can be archived but not deleted.", 422)
  }
  const col = await learningPathsCol()
  const result = await col.deleteOne({ id })
  invalidateLearningPathCache()
  return result.deletedCount > 0
}
