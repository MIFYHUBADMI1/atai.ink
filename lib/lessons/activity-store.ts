import "server-only"

import { userLessonsCol } from "@/lib/db/collections"
import { logger } from "@/lib/logging/logger"
import {
  nextActivityState,
  type LessonActivityAction,
  type LessonActivityMap,
  type LessonActivityView,
  type UserLessonActivityDoc,
} from "@/lib/lessons/activity"

const MAX_REFS_PER_READ = 500

function toView(doc: UserLessonActivityDoc): LessonActivityView {
  return {
    saved: Boolean(doc.saved),
    completed: Boolean(doc.completed),
    lastOpenedAt: doc.lastOpenedAt,
    savedAt: doc.savedAt,
    completedAt: doc.completedAt,
    updatedAt: doc.updatedAt,
  }
}

function toMap(docs: readonly UserLessonActivityDoc[]): LessonActivityMap {
  const map: LessonActivityMap = {}
  for (const doc of docs) map[doc.lessonRef] = toView(doc)
  return map
}

/**
 * Activity for a bounded set of lessons. A database problem must never break
 * the free library, so pages degrade to "no activity" instead of failing.
 */
export async function loadLessonActivity(userId: string, refs: readonly string[]): Promise<LessonActivityMap> {
  const unique = [...new Set(refs)].slice(0, MAX_REFS_PER_READ)
  if (!userId || unique.length === 0) return {}
  try {
    const col = await userLessonsCol()
    const docs = (await col
      .find({ userId, lessonRef: { $in: unique } })
      .toArray()) as UserLessonActivityDoc[]
    return toMap(docs)
  } catch (error) {
    logger.warn("lessons.activity", "Could not load lesson activity", {
      userId,
      message: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}

/** Recent activity for the whole library (continue + saved rows). */
export async function loadRecentLessonActivity(userId: string, limit = 100): Promise<LessonActivityMap> {
  if (!userId) return {}
  try {
    const col = await userLessonsCol()
    const docs = (await col
      .find({ userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray()) as UserLessonActivityDoc[]
    return toMap(docs)
  } catch (error) {
    logger.warn("lessons.activity", "Could not load recent lesson activity", {
      userId,
      message: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}

/** Apply one action atomically. The caller validates the lesson ref first. */
export async function applyLessonActivity(
  userId: string,
  lessonRef: string,
  action: LessonActivityAction,
): Promise<LessonActivityView> {
  const col = await userLessonsCol()
  const existing = (await col.findOne({ userId, lessonRef })) as UserLessonActivityDoc | null
  const next = nextActivityState(existing ? toView(existing) : undefined, action, Date.now())
  const update = {
    $set: {
      userId,
      lessonRef,
      saved: next.saved,
      completed: next.completed,
      lastOpenedAt: next.lastOpenedAt,
      savedAt: next.savedAt,
      completedAt: next.completedAt,
      updatedAt: next.updatedAt,
    },
  }

  try {
    await col.updateOne({ userId, lessonRef }, update, { upsert: true })
  } catch (error) {
    // Two first-time actions racing the unique index: fold into the winner.
    if (!(error instanceof Error && /E11000|duplicate key/i.test(error.message))) throw error
    await col.updateOne({ userId, lessonRef }, update)
  }
  return next
}
