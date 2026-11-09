import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRight, Clock, FileDown, GraduationCap, PlayCircle } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { ComingSoonPage } from "@/components/workspace/coming-soon"
import { MarkdownArticle } from "@/components/resources/markdown-article"
import { getCurrentUser } from "@/lib/auth/session"
import { isLessonsEnabledForUser } from "@/lib/marketing/feature-flags"
import { getPublishedLessonBySlug } from "@/lib/lessons/store"
import { LESSON_STAGE_META } from "@/lib/lessons/types"
import { formatFileSize, youTubeEmbedUrl, youTubeThumbnailUrl } from "@/lib/resources/media"

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
          </p>
        </header>

        {embedUrl ? (
          <figure className="mt-8">
            <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-black">
              <iframe
                src={embedUrl}
                title={lesson.title}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="size-full"
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
