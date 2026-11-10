import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, CircleCheck, CircleDashed, Clock, Compass, GraduationCap } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { ComingSoonPage } from "@/components/workspace/coming-soon"
import { LessonCompletionToggle } from "@/components/lessons/lesson-completion-toggle"
import { PathProgressTracker } from "@/components/lessons/path-progress-tracker"
import { getCurrentUser } from "@/lib/auth/session"
import { isLessonsEnabledForUser } from "@/lib/marketing/feature-flags"
import { libraryLessonMap } from "@/lib/lessons/store"
import { getPublishedLearningPath } from "@/lib/lessons/paths-store"
import { computePathProgress, resolvePathLessons } from "@/lib/lessons/paths"
import { loadLessonActivity } from "@/lib/lessons/activity-store"
import { completedLessonRefs } from "@/lib/lessons/activity"
import { LESSON_STAGE_META } from "@/lib/lessons/types"

const COMING_SOON = {
  kicker: "Business & growth",
  title: "Learn what you need, when you need it.",
  description:
    "Business Lessons will teach the next useful thing as you build — not a course you have to finish before you start.",
} as const

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const path = await getPublishedLearningPath(slug)
  if (!path) return { title: "Business lessons - Atai" }
  return {
    title: `${path.title} - Atai Business Lessons`,
    description: path.description,
  }
}

/**
 * A learning path: an ordered sequence with its objectives, audience, and
 * per-founder progress. Every step is still independently readable — the path
 * is a guide, not a gate.
 */
export default async function LearningPathPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await getCurrentUser()
  if (!user || !isLessonsEnabledForUser(user.id, user.featurePreferences)) {
    return <ComingSoonPage {...COMING_SOON} />
  }

  const path = await getPublishedLearningPath(slug)
  if (!path) notFound()

  const lessonsById = await libraryLessonMap()
  const lessons = resolvePathLessons(path, lessonsById)
  const activity = await loadLessonActivity(
    user.id,
    lessons.map((lesson) => lesson.id),
  )
  const completedRefs = completedLessonRefs(activity)
  const progress = computePathProgress(
    lessons.map((lesson) => lesson.id),
    completedRefs,
  )
  const nextLesson = lessons.find((lesson) => !completedRefs.has(lesson.id)) ?? null
  const stage = LESSON_STAGE_META[path.stage]

  return (
    <main className="min-h-svh bg-background text-foreground">
      <AppHeader />
      <PathProgressTracker
        slug={path.slug}
        stage={path.stage}
        total={progress.total}
        completed={progress.completed}
      />
      <article className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/lessons" className="hover:text-foreground">
                Business lessons
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li className="text-foreground">Learning path</li>
          </ol>
        </nav>

        <header className="mt-6 border-b border-border pb-8">
          <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <GraduationCap className="size-3.5" /> {stage.label} path
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 capitalize">{path.difficulty}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {path.estimatedMinutes} min
            </span>
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{path.title}</h1>
          <p className="mt-4 text-pretty text-base leading-7 text-muted-foreground">{path.description}</p>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Who it is for</dt>
              <dd className="mt-1 text-sm leading-6">{path.audience}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Progress</dt>
              <dd className="mt-1 text-sm leading-6">
                {progress.completed} of {progress.total} lessons complete
                <span className="ml-2 tabular-nums text-muted-foreground">{progress.percent}%</span>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                </div>
              </dd>
            </div>
          </dl>

          <div className="mt-6 rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-semibold">What you will learn</p>
            <ul className="mt-2 space-y-1.5">
              {path.objectives.map((objective) => (
                <li key={objective} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{objective}</span>
                </li>
              ))}
            </ul>
          </div>

          {nextLesson ? (
            <Link
              href={nextLesson.href}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Compass className="size-4" />
              {progress.completed === 0 ? "Start with" : "Continue with"}: {nextLesson.title}
            </Link>
          ) : (
            <p className="mt-6 inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="size-4" /> You have completed every lesson in this path.
            </p>
          )}
        </header>

        <section aria-labelledby="path-lessons" className="mt-10">
          <h2 id="path-lessons" className="text-lg font-semibold tracking-tight">
            The path
          </h2>
          <ol className="mt-4 flex flex-col gap-3">
            {lessons.map((lesson, index) => {
              const completed = completedRefs.has(lesson.id)
              return (
                <li key={lesson.id} className="flex min-w-0 items-start gap-2">
                  <Link
                    href={lesson.href}
                    className="group flex min-w-0 flex-1 items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs text-muted-foreground">
                      {completed ? (
                        <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="text-sm font-semibold leading-6">{lesson.title}</span>
                        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm leading-6 text-muted-foreground">
                        {lesson.summary}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" /> {lesson.readingMinutes} min
                        </span>
                        <span className="capitalize">{lesson.difficulty}</span>
                        {completed ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Completed</span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <CircleDashed className="size-3" /> Not started
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                  <LessonCompletionToggle
                    lessonRef={lesson.id}
                    initialCompleted={completed}
                    stage={lesson.stage}
                    categoryId={lesson.categoryId}
                  />
                </li>
              )
            })}
          </ol>

          {lessons.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">
              This path has no published lessons right now.
            </p>
          ) : null}
        </section>

        <footer className="mt-12 border-t border-border pt-6">
          <Link href="/lessons" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Back to all business lessons
          </Link>
        </footer>
      </article>
    </main>
  )
}
