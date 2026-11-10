import type { ObjectId } from "mongodb"

/**
 * Per-user learning activity: which lessons were opened, saved, and marked
 * complete. One document per user + lesson (unique index), updated in place —
 * never duplicated and never used as a proxy for "understood".
 */

export const LESSON_ACTIVITY_ACTIONS = ["open", "save", "unsave", "complete", "uncomplete"] as const
export type LessonActivityAction = (typeof LESSON_ACTIVITY_ACTIONS)[number]

export interface UserLessonActivityDoc {
  _id?: ObjectId
  userId: string
  lessonRef: string
  saved: boolean
  completed: boolean
  lastOpenedAt?: number
  savedAt?: number
  completedAt?: number
  updatedAt: number
}

export interface LessonActivityView {
  saved: boolean
  completed: boolean
  lastOpenedAt?: number
  savedAt?: number
  completedAt?: number
  updatedAt: number
}

export type LessonActivityMap = Record<string, LessonActivityView>

const LIBRARY_LESSON_REF = /^(core:[a-z0-9-]+\/[a-z0-9-]+|les_[A-Za-z0-9_-]{1,100})$/

export function isLibraryLessonRef(value: string): boolean {
  return LIBRARY_LESSON_REF.test(value)
}

export function isLessonActivityAction(value: string): value is LessonActivityAction {
  return (LESSON_ACTIVITY_ACTIONS as readonly string[]).includes(value)
}

const EMPTY_VIEW: Omit<LessonActivityView, "updatedAt"> = { saved: false, completed: false }

/** Pure state transition so the same rules are used by the API and tests. */
export function nextActivityState(
  current: LessonActivityView | undefined,
  action: LessonActivityAction,
  now: number,
): LessonActivityView {
  const base: LessonActivityView = { ...EMPTY_VIEW, ...current, updatedAt: now }
  switch (action) {
    case "open":
      return { ...base, lastOpenedAt: now }
    case "save":
      return { ...base, saved: true, savedAt: now }
    case "unsave":
      return { ...base, saved: false }
    case "complete":
      return { ...base, completed: true, completedAt: now }
    case "uncomplete":
      return { ...base, completed: false, completedAt: undefined }
  }
}

export function completedLessonRefs(activity: Readonly<LessonActivityMap>): Set<string> {
  return new Set(Object.entries(activity).filter(([, view]) => view.completed).map(([ref]) => ref))
}

export function savedLessonRefs(activity: Readonly<LessonActivityMap>): string[] {
  return Object.entries(activity)
    .filter(([, view]) => view.saved)
    .sort((a, b) => (b[1].savedAt ?? 0) - (a[1].savedAt ?? 0))
    .map(([ref]) => ref)
}

/** Lessons opened and not completed, newest first — the "continue" row. */
export function inProgressLessonRefs(activity: Readonly<LessonActivityMap>, limit = 4): string[] {
  return Object.entries(activity)
    .filter(([, view]) => Boolean(view.lastOpenedAt) && !view.completed)
    .sort((a, b) => (b[1].lastOpenedAt ?? 0) - (a[1].lastOpenedAt ?? 0))
    .slice(0, limit)
    .map(([ref]) => ref)
}
