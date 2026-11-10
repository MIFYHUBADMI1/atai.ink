import Link from "next/link"
import { ArrowRight, BookOpen, CircleCheck, CircleDashed, Compass } from "lucide-react"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { ProjectComingSoon } from "@/components/workspace/project-coming-soon"
import { LessonCard } from "@/components/lessons/lesson-card"
import { LessonsPackPanel } from "@/components/lessons/lessons-pack-panel"
import { RecommendationLink } from "@/components/lessons/recommendation-link"
import { getCurrentUser } from "@/lib/auth/session"
import { isLessonsEnabledForUser, isPersonalLessonsEnabledForUser } from "@/lib/marketing/feature-flags"
import { lessonsForStage, libraryLessonMap } from "@/lib/lessons/store"
import { buildLessonsPosition } from "@/lib/lessons/position"
import { lessonContextFingerprint } from "@/lib/lessons/context"
import {
  listActiveGeneratedLessons,
  countArchivedGeneratedLessons,
} from "@/lib/lessons/generated-store"
import { getLessonsPackAffordability } from "@/lib/lessons/credits"
import { listPublishedLearningPaths } from "@/lib/lessons/paths-store"
import { computePathProgress, recommendedPathForStage, resolvePathLessons } from "@/lib/lessons/paths"
import { loadRecentLessonActivity } from "@/lib/lessons/activity-store"
import { completedLessonRefs } from "@/lib/lessons/activity"
import { requireOwnedProject } from "@/lib/workspace/require-owned-project"

/**
 * A project's Business Lessons. Everything above the fold is deterministic
 * and free: the position strip is derived from observed project state, the
 * stage library is the shared curriculum, and the personal pack is read from
 * storage. Only writing a fresh pack charges credits (founder-initiated POST).
 */
export default async function ProjectLessonsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const project = await requireOwnedProject(projectId, `/project/${projectId}/lessons`)
  const user = await getCurrentUser()

  if (!user || !isLessonsEnabledForUser(user.id, user.featurePreferences)) {
    return (
      <ProjectComingSoon
        projectId={project.id}
        projectName={project.name}
        kicker="Business lessons"
        title={`Lessons for ${project.name}`}
        description="This view will already know this product and what you are building. You will not have to re-explain the business. The experience is not available yet."
      />
    )
  }

  const position = buildLessonsPosition(project)
  const aiEnabled = isPersonalLessonsEnabledForUser(user.id, user.featurePreferences)
  const [stageLibrary, paths, lessonsById, activity] = await Promise.all([
    lessonsForStage(position.stage),
    listPublishedLearningPaths(),
    libraryLessonMap(),
    loadRecentLessonActivity(user.id),
  ])
  const lessons = aiEnabled ? await listActiveGeneratedLessons(project.id) : []
  const archivedCount = aiEnabled ? await countArchivedGeneratedLessons(project.id) : 0
  const { cost, available } = aiEnabled
    ? await getLessonsPackAffordability(user.id)
    : { cost: 0, available: 0 }
  const currentFingerprint = lessonContextFingerprint(project)

  const completedRefs = completedLessonRefs(activity)
  const recommended = recommendedPathForStage(paths, position.stage)
  const recommendedResolved = recommended ? resolvePathLessons(recommended, lessonsById) : []
  const recommendedProgress = computePathProgress(
    recommendedResolved.map((lesson) => lesson.id),
    completedRefs,
  )
  const recommendedNext = recommendedResolved.find((lesson) => !completedRefs.has(lesson.id)) ?? null

  const pack = lessons[0]
    ? {
        packId: lessons[0].packId,
        version: lessons[0].version,
        generatedAt: lessons[0].createdAt,
        contextSnapshot: lessons[0].contextSnapshot,
        stale: lessons[0].contextFingerprint !== currentFingerprint,
      }
    : null

  return (
    <DashboardShell title={project.name} projectId={project.id}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-12 pt-6 sm:gap-10 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
        <header className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Business lessons</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            What to learn now, for {project.name}
          </h1>
        </header>

        <PositionStrip position={position} />

        {recommended && recommendedResolved.length > 0 ? (
          <section
            aria-labelledby="recommended-path"
            className="rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="recommended-path" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <BookOpen className="size-5 shrink-0 text-primary" /> Recommended path
              </h2>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {recommendedProgress.completed}/{recommendedProgress.total} complete
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              <span className="font-semibold text-foreground">{recommended.title}</span> — {recommended.description}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Why now: {position.stageFocus}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-primary" style={{ width: `${recommendedProgress.percent}%` }} />
            </div>
            <RecommendationLink
              href={recommendedNext?.href ?? recommended.href}
              target={recommendedNext ? "lesson" : "path"}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {recommendedProgress.completed === 0 ? "Start this path" : "Continue"}
              {recommendedNext ? `: ${recommendedNext.title}` : ""} <ArrowRight className="size-4" />
            </RecommendationLink>
          </section>
        ) : null}

        {aiEnabled ? (
          <LessonsPackPanel
            projectId={project.id}
            hasSignal={Boolean(project.idea || project.specification)}
            cost={cost}
            available={available}
            pack={pack}
            lessons={lessons.map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              stage: lesson.stage,
              bodyMarkdown: lesson.bodyMarkdown,
              sources: lesson.sources,
              videos: lesson.videos,
              grounded: lesson.grounded,
              createdAt: lesson.createdAt,
            }))}
            archivedCount={archivedCount}
          />
        ) : (
          <section className="rounded-2xl border border-dashed border-border p-5">
            <p className="text-sm font-semibold">Personal AI lessons are switched off right now.</p>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              The free curated library below is unaffected. You can keep following paths and reading lessons without
              spending credits.
            </p>
            <Link href="/lessons" className="mt-3 inline-flex text-sm font-medium text-primary hover:underline">
              Browse the full business lessons library →
            </Link>
          </section>
        )}

        <section aria-labelledby="stage-library" className="flex min-w-0 flex-col gap-4">
          <div>
            <h2 id="stage-library" className="text-lg font-semibold tracking-tight">
              The {position.stageLabel.toLowerCase()} library
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{position.stageFocus}</p>
          </div>
          {stageLibrary.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {stageLibrary.map((lesson) => (
                <LessonCard key={lesson.id} lesson={lesson} />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border bg-transparent p-5 text-sm leading-6 text-muted-foreground">
              No lessons in this stage yet.
            </p>
          )}
        </section>
      </div>
    </DashboardShell>
  )
}

function PositionStrip({ position }: { position: ReturnType<typeof buildLessonsPosition> }) {
  return (
    <section
      aria-label="Where your business stands"
      className="rounded-2xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Compass className="size-5 shrink-0 text-primary" /> Where your business stands
        </h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {position.stageLabel}
          {position.planPercent !== null ? ` · plan ${position.planPercent}%` : ""}
        </p>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{position.stageFocus}</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">What you have done</p>
          <ul className="mt-2 space-y-1.5">
            {position.done.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">What remains</p>
          <ul className="mt-2 space-y-1.5">
            {position.remaining.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {position.nextSteps.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Next steps</p>
          <ol className="mt-2 space-y-1.5">
            {position.nextSteps.map((step, index) => (
              <li key={step.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 font-mono text-xs text-muted-foreground">{index + 1}.</span>
                <span>
                  <span className="font-medium">{step.title}</span>
                  {step.description ? <span className="text-muted-foreground"> — {step.description}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
