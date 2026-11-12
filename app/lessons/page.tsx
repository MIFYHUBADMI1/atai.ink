import type { Metadata } from "next"
import Link from "next/link"
import { GraduationCap } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { ComingSoonPage } from "@/components/workspace/coming-soon"
import { LessonsLibrary, type LessonStageSection } from "@/components/lessons/lessons-library"
import { getCurrentUser } from "@/lib/auth/session"
import { isLessonsEnabledForUser, isLessonsGloballyEnabled } from "@/lib/marketing/feature-flags"
import { lessonsForStage, libraryLessonMap } from "@/lib/lessons/store"
import { listVisibleLessonCategories } from "@/lib/lessons/taxonomy-store"
import { listPublishedLearningPaths } from "@/lib/lessons/paths-store"
import { computePathProgress, resolvePathLessons, type LearningPathCard } from "@/lib/lessons/paths"
import {
  completedLessonRefs,
  inProgressLessonRefs,
  savedLessonRefs,
} from "@/lib/lessons/activity"
import { loadRecentLessonActivity } from "@/lib/lessons/activity-store"
import { LESSON_STAGES, type LibraryLessonView } from "@/lib/lessons/types"

export const metadata: Metadata = {
  title: "Business lessons - Atai",
  description:
    "A free business learning library: stage-aware lessons, topic categories, ordered learning paths, saved lessons, and progress that follows your real business.",
}

const COMING_SOON = {
  kicker: "Business & growth",
  title: "Learn what you need, when you need it.",
  description:
    "Business Lessons will teach the next useful thing as you build — not a course you have to finish before you start.",
} as const

/**
 * The global Business Lessons library. Free, read-only: the in-code core
 * curriculum merged with operator-published lessons, grouped by business
 * stage, searchable by topic, and organized into learning paths. Personal AI
 * lessons live on each project's lessons page. Signed-out visitors browse the
 * same free library when the operator has opened it at deployment level; the
 * personal rows simply stay empty until they sign in.
 */
export default async function LessonsPage() {
  const user = await getCurrentUser()
  const enabled = user
    ? isLessonsEnabledForUser(user.id, user.featurePreferences)
    : isLessonsGloballyEnabled()
  if (!enabled) {
    return (
      <ComingSoonPage
        {...COMING_SOON}
        action={
          user ? undefined : (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                Create an account
              </Link>
            </div>
          )
        }
      />
    )
  }

  const [sections, categories, paths, lessonsById, activity] = await Promise.all([
    Promise.all(
      LESSON_STAGES.map(async (stage) => ({ stage, lessons: await lessonsForStage(stage) })),
    ) as Promise<LessonStageSection[]>,
    listVisibleLessonCategories(),
    listPublishedLearningPaths(),
    libraryLessonMap(),
    loadRecentLessonActivity(user?.id ?? ""),
  ])

  const completedRefs = completedLessonRefs(activity)
  const pathCards: LearningPathCard[] = paths.map((path) => {
    const resolved = resolvePathLessons(path, lessonsById)
    const progress = computePathProgress(
      resolved.map((lesson) => lesson.id),
      completedRefs,
    )
    const nextLesson = resolved.find((lesson) => !completedRefs.has(lesson.id))
    return {
      id: path.id,
      slug: path.slug,
      title: path.title,
      description: path.description,
      objectives: path.objectives,
      audience: path.audience,
      stage: path.stage,
      difficulty: path.difficulty,
      estimatedMinutes: path.estimatedMinutes,
      lessonCount: progress.total,
      completedCount: progress.completed,
      percent: progress.percent,
      nextLessonTitle: nextLesson?.title ?? null,
      href: path.href,
    }
  })

  const resolve = (refs: string[]): LibraryLessonView[] =>
    refs.map((ref) => lessonsById.get(ref)).filter((lesson): lesson is LibraryLessonView => Boolean(lesson))

  const continueLessons = resolve(inProgressLessonRefs(activity, 4))
  const savedLessons = resolve(savedLessonRefs(activity).slice(0, 4))

  return (
    <main className="min-h-svh bg-background text-foreground">
      <AppHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        <header className="max-w-2xl">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <GraduationCap className="size-4" /> Business lessons
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
            Learn the next useful thing — right when your business needs it.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            A free library for founders: the core lessons every business needs, lessons published by Atai, and ordered
            learning paths you can follow from idea to growth. Save lessons, mark progress, and search by the problem you
            are trying to solve. Each project also gets personal AI lessons written for where that business actually
            stands — open a project and choose{" "}
            <span className="font-medium text-foreground">Business lessons</span>.
          </p>
        </header>

        <div className="mt-10">
          <LessonsLibrary
            sections={sections}
            categories={categories}
            paths={pathCards}
            activity={activity}
            continueLessons={continueLessons}
            savedLessons={savedLessons}
          />
        </div>
      </div>
    </main>
  )
}
