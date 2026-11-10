import "server-only"

import { lessonCategoriesCol } from "@/lib/db/collections"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import {
  LESSON_CATEGORY_SEED,
  mergeLessonCategories,
  sortLessonCategories,
  type LessonCategoryDoc,
  type LessonCategoryView,
} from "@/lib/lessons/taxonomy"

const CACHE_TTL_MS = 60_000
const FAILURE_BACKOFF_MS = 60_000

type Cache = { at: number; categories: LessonCategoryView[] }
type Failure = { until: number }

const globalForTaxonomy = globalThis as unknown as {
  __ataiLessonCategoryCache?: Cache
  __ataiLessonCategoryFailure?: Failure
}

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build"
}

/** All categories, including hidden ones (admin views need those). */
export async function listLessonCategories(): Promise<LessonCategoryView[]> {
  if (isBuildPhase()) return sortLessonCategories(LESSON_CATEGORY_SEED)

  const now = Date.now()
  const cached = globalForTaxonomy.__ataiLessonCategoryCache
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.categories

  const failure = globalForTaxonomy.__ataiLessonCategoryFailure
  if (failure && now < failure.until) return sortLessonCategories(LESSON_CATEGORY_SEED)

  try {
    const col = await lessonCategoriesCol()
    const docs = (await col.find({}).toArray()) as LessonCategoryDoc[]
    const categories = mergeLessonCategories(docs)
    globalForTaxonomy.__ataiLessonCategoryCache = { at: now, categories }
    globalForTaxonomy.__ataiLessonCategoryFailure = undefined
    return categories
  } catch (error) {
    globalForTaxonomy.__ataiLessonCategoryFailure = { until: now + FAILURE_BACKOFF_MS }
    logger.warn("lessons.taxonomy", "Could not load lesson categories; using defaults", {
      message: error instanceof Error ? error.message : String(error),
    })
    return sortLessonCategories(LESSON_CATEGORY_SEED)
  }
}

/** Categories founders may filter by. */
export async function listVisibleLessonCategories(): Promise<LessonCategoryView[]> {
  return (await listLessonCategories()).filter((category) => !category.hidden)
}

export function invalidateLessonCategoryCache() {
  globalForTaxonomy.__ataiLessonCategoryCache = undefined
  globalForTaxonomy.__ataiLessonCategoryFailure = undefined
}

export interface LessonCategoryPatch {
  name?: string
  description?: string
  order?: number
  hidden?: boolean
}

export async function updateLessonCategory(
  id: string,
  patch: LessonCategoryPatch,
  actorId: string,
): Promise<LessonCategoryView | null> {
  const seed = LESSON_CATEGORY_SEED.find((category) => category.id === id)
  if (!seed) throw new AppError("VALIDATION", "That lesson category does not exist.", 404)

  const update: Partial<LessonCategoryDoc> = {
    ...patch,
    id,
    updatedAtMs: Date.now(),
    updatedBy: actorId,
  }
  const col = await lessonCategoriesCol()
  await col.updateOne({ id }, { $set: update }, { upsert: true })
  invalidateLessonCategoryCache()

  return {
    id,
    name: patch.name?.trim() || seed.name,
    description: patch.description?.trim() || seed.description,
    order: patch.order ?? seed.order,
    hidden: patch.hidden ?? false,
  }
}
