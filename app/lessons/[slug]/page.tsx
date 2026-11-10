import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Clock, FileDown, GraduationCap, PlayCircle } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { ComingSoonPage } from "@/components/workspace/coming-soon"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import { LessonActivityBar } from "@/components/lessons/lesson-activity-bar"
import { TrackedVideoEmbed } from "@/components/lessons/tracked-video-embed"
import { getCurrentUser } from "@/lib/auth/session"
import { isLessonsEnabledForUser } from "@/lib/marketing/feature-flags"
import { allLibraryLessons, getPublishedLessonBySlug } from "@/lib/lessons/store"
import { listPublishedLearningPaths } from "@/lib/lessons/paths-store"
import { loadLessonActivity } from "@/lib/lessons/activity-store"
import { LESSON_STAGE_META } from "@/lib/lessons/types"
import { formatFileSize, markdownHeadings, youTubeEmbedUrl, youTubeThumbnailUrl } from "@/lib/resources/media"

const COMING_SOON = {
  kicker: "Business & growth",
  title: "Learn what you need, when you need it.",
  description:
    "Business Lessons will teach the next useful thing as you build — not a course you have to finish before you start.",
} as const

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const lesson = await getPublishedLessonBySlug(slug)
  if (!lesson) return { title: "Business lessons - Atai" }
  return {
    title: `${lesson.title} - Atai Business Lessons`,
    description: lesson.summary,
  }
}

/**
 * Reader for an operator-published business lesson. Same gating as the
 * library: signed-out or feature-off founders see the exact coming-soon
 * experience; the published lesson itself is free to read.
 */
export default async function LessonReaderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await getCurrentUser()
  if (!user || !isLessonsEnabledForUser(user.id, user.featurePreferences)) {
    return <ComingSoonPage {...COMING_SOON} />
  }

  const lesson = await getPublishedLessonBySlug(slug)
  if (!lesson) notFound()

  const embedUrl = youTubeEmbedUrl(lesson.youtubeUrl)
  const thumbnail = youTubeThumbnailUrl(lesson.youtubeUrl)
  const stage = LESSON_STAGE_META[lesson.stage]

  const [activity, allLessons, paths] = await Promise.all([
    loadLessonActivity(user.id, [lesson.id]),
    allLibraryLessons(),
    listPublishedLearningPaths(),
  ])
  const activityState = activity[lesson.id]
  const toc = markdownHeadings(lesson.contentMarkdown)
  const stageLessons = allLessons.filter((item) => item.stage === lesson.stage)
  const lessonIndex = stageLessons.findIndex((item) => item.id === lesson.id)
  const previousLesson = lessonIndex > 0 ? stageLessons[lessonIndex - 1] : null
  const nextLesson =
    lessonIndex >= 0 && lessonIndex < stageLessons.length - 1 ? stageLessons[lessonIndex + 1] : null
  const relatedLessons = allLessons
    .filter((item) => item.id !== lesson.id && item.categoryId === lesson.categoryId)
    .slice(0, 3)
  const lessonPaths = paths.filter((path) => path.lessonRefs.includes(lesson.id)).slice(0, 2)

  return (
    <main className="min-h-svh bg-background text-foreground">
      <AppHeader />
      <article className="mx-auto w-full max-w-3xl px-6 pb-20 pt-10 sm:px-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap gap-2">
            <li>
              <Link href="/lessons" className="hover:text-foreground">
                Business lessons
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li className="text-foreground">{lesson.title}</li>
          </ol>
        </nav>

        <header className="mt-6 border-b border-border pb-8">
          <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <GraduationCap className="size-3.5" /> {stage.label} stage
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 capitalize">{lesson.difficulty}</span>
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{lesson.title}</h1>
          <p className="mt-4 text-pretty text-base leading-7 text-muted-foreground">{lesson.summary}</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> {lesson.readingMinutes} min
            </span>
            <span>Published by Atai</span>
            {lesson.topics.length > 0 ? <span>{lesson.topics.slice(0, 4).join(" · ")}</span> : null}
            {lesson.updatedAt ? <span>Updated {lesson.updatedAt}</span> : null}
          </p>
          <LessonActivityBar
            lessonRef={lesson.id}
            initialSaved={Boolean(activityState?.saved)}
            initialCompleted={Boolean(activityState?.completed)}
            analytics={{
              kind: "curated",
              stage: lesson.stage,
              categoryId: lesson.categoryId,
              surface: "lesson_reader",
            }}
          />
          {lessonPaths.length > 0 ? (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Part of:
              {lessonPaths.map((path) => (
                <Link
                  key={path.id}
                  href={path.href}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground hover:bg-accent"
                >
                  <BookOpen className="size-3" /> {path.title}
                </Link>
              ))}
            </p>
          ) : null}
        </header>

        {toc.length >= 3 ? (
          <nav aria-label="On this page" className="mt-6 rounded-2xl border border-border bg-muted/30 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">On this page</p>
            <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {toc.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className="text-sm leading-6 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {embedUrl ? (
          <figure className="mt-8">
            <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-black">
              <TrackedVideoEmbed
                src={embedUrl}
                title={lesson.title}
                lessonRef={lesson.id}
                analytics={{
                  kind: "curated",
                  stage: lesson.stage,
                  categoryId: lesson.categoryId,
                  surface: "lesson_reader",
                }}
              />
            </div>
            {lesson.youtubeUrl ? (
              <figcaption className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <PlayCircle className="size-3.5" />
                <a href={lesson.youtubeUrl} target="_blank" rel="noreferrer noopener" className="hover:text-foreground">
                  Watch on YouTube
                </a>
              </figcaption>
            ) : null}
          </figure>
        ) : thumbnail ? (
          <figure className="mt-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnail}
              alt={lesson.title}
              loading="lazy"
              className="h-auto w-full rounded-2xl border border-border"
            />
          </figure>
        ) : null}

        {lesson.imageUrl ? (
          <figure className="mt-8">
            {/* Admin-uploaded images stay external, lazy, and isolated. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lesson.imageUrl} alt={lesson.title} loading="lazy" className="h-auto w-full rounded-2xl border border-border" />
          </figure>
        ) : null}

        {lesson.file ? (
          <a
            href={lesson.file.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-8 flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/40"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileDown className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{lesson.file.name}</span>
              <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {[formatFileSize(lesson.file.size), lesson.file.mimeType].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
              Download <ArrowUpRight className="size-4" />
            </span>
          </a>
        ) : null}

        {lesson.externalUrl ? (
          <a
            href={lesson.externalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-6 inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Open the original lesson <ArrowUpRight className="size-4" />
          </a>
        ) : null}

        {lesson.contentMarkdown ? (
          <div className="mt-8">
            <MarkdownArticle markdown={lesson.contentMarkdown} />
          </div>
        ) : null}

        {relatedLessons.length > 0 ? (
          <section aria-labelledby="related-lessons" className="mt-12 border-t border-border pt-8">
            <h2 id="related-lessons" className="text-lg font-semibold tracking-tight">
              Related lessons
            </h2>
            <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
              {relatedLessons.map((related) => (
                <li key={related.id}>
                  <Link
                    href={related.href}
                    className="group flex min-w-0 items-start justify-between gap-3 px-4 py-3 hover:bg-accent/40"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-6">{related.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-sm leading-6 text-muted-foreground">
                        {related.summary}
                      </span>
                    </span>
                    <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <nav aria-label="Lesson navigation" className="mt-10 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
          {previousLesson ? (
            <Link
              href={previousLesson.href}
              className="group rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/30"
            >
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowLeft className="size-3.5" /> Previous
              </span>
              <span className="mt-1 block text-sm font-medium leading-6">{previousLesson.title}</span>
            </Link>
          ) : (
            <span aria-hidden />
          )}
          {nextLesson ? (
            <Link
              href={nextLesson.href}
              className="group rounded-2xl border border-border bg-card p-4 text-right transition-colors hover:border-primary/30 hover:bg-accent/30 sm:col-start-2"
            >
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                Next <ArrowRight className="size-3.5" />
              </span>
              <span className="mt-1 block text-sm font-medium leading-6">{nextLesson.title}</span>
            </Link>
          ) : null}
        </nav>

        <div className="mt-12 rounded-2xl border border-border bg-muted/40 p-5">
          <p className="text-sm font-semibold">Keep going</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your project&rsquo;s Business Lessons page adds personal lessons written for where{" "}
            <em>your</em> business stands right now — what is done, what remains, and how to move forward.
          </p>
          <Link href="/projects" className="mt-3 inline-flex text-sm font-medium text-primary hover:underline">
            Open your projects →
          </Link>
        </div>
      </article>
    </main>
  )
}
