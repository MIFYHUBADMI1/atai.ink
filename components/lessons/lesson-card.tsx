import Link from "next/link"
import { ArrowUpRight, Clock } from "lucide-react"
import {
  LESSON_FORMAT_LABEL,
  type CoreLessonView,
  type CuratedLessonView,
  type LibraryLessonView,
} from "@/lib/lessons/types"
import { cn } from "@/lib/utils"

function isCurated(lesson: LibraryLessonView): lesson is CuratedLessonView {
  return lesson.source === "admin"
}

const DIFFICULTY_STYLE: Record<CoreLessonView["difficulty"], string> = {
  beginner: "text-emerald-600 dark:text-emerald-400",
  intermediate: "text-amber-600 dark:text-amber-400",
  advanced: "text-rose-600 dark:text-rose-400",
}

export function LessonCard({ lesson }: { lesson: LibraryLessonView }) {
  const curated = isCurated(lesson)
  return (
    <Link
      href={lesson.href}
      className="group flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h4 className="text-base font-semibold leading-6 tracking-tight">{lesson.title}</h4>
        <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>
      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{lesson.summary}</p>
      {lesson.source === "core" ? (
        <p className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-6 text-foreground">
          {lesson.whyNow}
        </p>
      ) : null}
      <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {lesson.readingMinutes} min
        </span>
        <span className={cn("capitalize", DIFFICULTY_STYLE[lesson.difficulty])}>{lesson.difficulty}</span>
        {curated ? (
          <span className="font-mono uppercase tracking-[0.12em]">{LESSON_FORMAT_LABEL[lesson.format]}</span>
        ) : (
          <span className="font-mono uppercase tracking-[0.12em]">Core curriculum</span>
        )}
        {curated && lesson.topics.length > 0 ? (
          <span className="min-w-0 truncate">{lesson.topics.slice(0, 3).join(" · ")}</span>
        ) : null}
      </p>
    </Link>
  )
}
