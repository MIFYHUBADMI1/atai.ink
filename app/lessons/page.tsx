import type { Metadata } from "next"
import { GraduationCap } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { ComingSoonPage } from "@/components/workspace/coming-soon"
import { LessonCard } from "@/components/lessons/lesson-card"
import { getCurrentUser } from "@/lib/auth/session"
import { isLessonsEnabledForUser } from "@/lib/marketing/feature-flags"
import { lessonsForStage } from "@/lib/lessons/store"
import {
  LESSON_STAGES,
  LESSON_STAGE_META,
  type LessonStage,
  type LibraryLessonView,
} from "@/lib/lessons/types"

export const metadata: Metadata = {
  title: "Business lessons - Atai",
  description:
    "A stage-aware curriculum for your business: the core lessons every founder needs, lessons published by Atai, and AI-written personal lessons that read where your business actually stands.",
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
 * stage. Personal AI lessons live on each project's lessons page. When the
 * feature is off for the signed-in founder (or nobody is signed in), this
 * route renders the exact coming-soon experience it always had.
 */
export default async function LessonsPage() {
  const user = await getCurrentUser()
  if (!user || !isLessonsEnabledForUser(user.id, user.featurePreferences)) {
    return <ComingSoonPage {...COMING_SOON} />
  }

  const sections = await Promise.all(
    LESSON_STAGES.map(async (stage) => ({ stage, lessons: await lessonsForStage(stage) })),
  )

  return (
    <main className="min-h-svh bg-background text-foreground">
      <AppHeader />
      <div className="mx-auto w-full max-w-5xl px-6 pb-20 pt-10 sm:px-8">
        <header className="max-w-2xl">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <GraduationCap className="size-4" /> Business lessons
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
            Learn the next useful thing — right when your business needs it.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            The library below follows the journey every business takes: planning, building, live, growing. Each stage
            holds the core lessons every founder needs plus lessons published by Atai. Your projects also get personal
            lessons written for where that business actually stands — open a project and choose{" "}
            <span className="font-medium text-foreground">Business lessons</span>.
          </p>
        </header>

        <div className="mt-10 flex flex-col gap-10">
          {sections.map(({ stage, lessons }) => (
            <StageSection key={stage} stage={stage} lessons={lessons} />
          ))}
        </div>
      </div>
    </main>
  )
}

function StageSection({ stage, lessons }: { stage: LessonStage; lessons: LibraryLessonView[] }) {
  const meta = LESSON_STAGE_META[stage]
  return (
    <section aria-labelledby={`stage-${stage}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
        <h2 id={`stage-${stage}`} className="text-xl font-semibold tracking-tight">
          {meta.label}
        </h2>
        <p className="text-sm text-muted-foreground">{meta.focus}</p>
      </div>
      {lessons.length > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {lessons.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} />
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-border bg-transparent p-5 text-sm leading-6 text-muted-foreground">
          No lessons in this stage yet.
        </p>
      )}
    </section>
  )
}
