import { track } from "@vercel/analytics"

/**
 * Learning analytics — a small, privacy-conscious set of custom events in
 * Vercel Web Analytics (same transport as the start funnel). Only editorial
 * identifiers (lesson ref, path slug, stage, category) and coarse surfaces are
 * sent: never prompts, project ids, emails, or anything a founder wrote.
 *
 * "Opened" is exactly that. It is not evidence of understanding, and no event
 * here is labelled learned/understood.
 */

type AnalyticsValue = string | number | boolean | null | undefined

export const LESSON_ANALYTICS = {
  opened: "lesson_opened",
  completed: "lesson_completed",
  uncompleted: "lesson_uncompleted",
  saved: "resource_saved",
  unsaved: "resource_unsaved",
  pathStarted: "learning_path_started",
  pathCompleted: "learning_path_completed",
  videoOpened: "video_opened",
  recommendationAccepted: "recommendation_accepted",
} as const

export interface LessonAnalyticsContext {
  kind: "core" | "curated"
  stage?: string
  categoryId?: string
  surface: "lesson_reader" | "resource_reader" | "path"
}

function emit(name: string, properties: Record<string, AnalyticsValue>): void {
  if (typeof window === "undefined") return
  try {
    track(name, properties)
  } catch {
    /* Analytics must never break learning. */
  }
}

function contextProps(lessonRef: string, context: LessonAnalyticsContext) {
  return {
    lesson_ref: lessonRef,
    lesson_kind: context.kind,
    stage: context.stage ?? "unknown",
    category: context.categoryId ?? "unknown",
    surface: context.surface,
  }
}

export function trackLessonOpened(lessonRef: string, context: LessonAnalyticsContext): void {
  emit(LESSON_ANALYTICS.opened, contextProps(lessonRef, context))
}

export function trackLessonCompleted(lessonRef: string, context: LessonAnalyticsContext): void {
  emit(LESSON_ANALYTICS.completed, contextProps(lessonRef, context))
}

export function trackLessonUncompleted(lessonRef: string, context: LessonAnalyticsContext): void {
  emit(LESSON_ANALYTICS.uncompleted, contextProps(lessonRef, context))
}

export function trackResourceSaved(lessonRef: string, saved: boolean, context: LessonAnalyticsContext): void {
  emit(saved ? LESSON_ANALYTICS.saved : LESSON_ANALYTICS.unsaved, contextProps(lessonRef, context))
}

export function trackVideoOpened(lessonRef: string, context: LessonAnalyticsContext): void {
  emit(LESSON_ANALYTICS.videoOpened, contextProps(lessonRef, context))
}

export function trackPathStarted(slug: string, stage: string): void {
  emit(LESSON_ANALYTICS.pathStarted, { path_slug: slug, stage })
}

export function trackPathCompleted(slug: string, stage: string): void {
  emit(LESSON_ANALYTICS.pathCompleted, { path_slug: slug, stage })
}

export function trackRecommendationAccepted(surface: string, target: "path" | "lesson"): void {
  emit(LESSON_ANALYTICS.recommendationAccepted, { surface, target })
}
