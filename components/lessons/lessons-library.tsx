"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Bookmark,
  CircleCheck,
  Clock,
  Compass,
  GraduationCap,
  Search,
  X,
} from "lucide-react"
import { LessonCard } from "@/components/lessons/lesson-card"
import {
  LESSON_FORMAT_LABEL,
  LESSON_STAGE_META,
  type LibraryLessonView,
  type LessonDifficulty,
  type LessonFormat,
  type LessonStage,
} from "@/lib/lessons/types"
import type { LessonCategoryView } from "@/lib/lessons/taxonomy"
import type { LearningPathCard } from "@/lib/lessons/paths"
import type { LessonActivityMap } from "@/lib/lessons/activity"
import {
  filterLearningPaths,
  filterLibraryLessons,
  lessonCategoryName,
  type LessonStageSection,
} from "@/lib/lessons/filter"
import { cn } from "@/lib/utils"

export type { LessonStageSection }

const DIFFICULTIES: LessonDifficulty[] = ["beginner", "intermediate", "advanced"]
const FORMATS: LessonFormat[] = ["article", "video", "link", "file", "image"]

export function LessonsLibrary({
  sections,
  categories,
  paths,
  activity,
  continueLessons,
  savedLessons,
}: {
  sections: LessonStageSection[]
  categories: LessonCategoryView[]
  paths: LearningPathCard[]
  activity: LessonActivityMap
  continueLessons: LibraryLessonView[]
  savedLessons: LibraryLessonView[]
}) {
  const [query, setQuery] = useState("")
  const [categoryId, setCategoryId] = useState("all")
  const [difficulty, setDifficulty] = useState<"all" | LessonDifficulty>("all")
  const [format, setFormat] = useState<"all" | LessonFormat>("all")

  const normalizedQuery = query.trim().toLowerCase()
  const filtering = Boolean(normalizedQuery) || categoryId !== "all" || difficulty !== "all" || format !== "all"

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  )

  const results = useMemo(
    () =>
      filterLibraryLessons(sections, categories, {
        query: normalizedQuery,
        categoryId,
        difficulty,
        format,
      }),
    [sections, categories, normalizedQuery, categoryId, difficulty, format],
  )

  const pathResults = useMemo(() => filterLearningPaths(paths, normalizedQuery), [paths, normalizedQuery])

  function clearFilters() {
    setQuery("")
    setCategoryId("all")
    setDifficulty("all")
    setFormat("all")
  }

  return (
    <div className="flex flex-col gap-12">
      <section aria-label="Search and filter lessons" className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lessons, paths, and topics"
            aria-label="Search lessons"
            className="h-12 w-full rounded-2xl border border-border bg-card pl-10 pr-11 text-base outline-none placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 sm:text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setCategoryId("all")}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
              categoryId === "all"
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            All topics
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
                categoryId === category.id
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Level
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as "all" | LessonDifficulty)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
            >
              <option value="all">All levels</option>
              {DIFFICULTIES.map((value) => (
                <option key={value} value={value} className="capitalize">
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Format
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as "all" | LessonFormat)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
            >
              <option value="all">All formats</option>
              {FORMATS.map((value) => (
                <option key={value} value={value}>
                  {LESSON_FORMAT_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          {filtering ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </section>

      {filtering ? (
        <section aria-live="polite" className="flex flex-col gap-8">
          <p className="text-sm text-muted-foreground">
            {results.length} {results.length === 1 ? "lesson" : "lessons"}
            {pathResults.length > 0
              ? ` · ${pathResults.length} ${pathResults.length === 1 ? "path" : "paths"}`
              : ""}
          </p>

          {pathResults.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">Learning paths</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {pathResults.map((path) => (
                  <PathCard key={path.id} path={path} />
                ))}
              </div>
            </div>
          ) : null}

          {results.length === 0 && pathResults.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6">
              <p className="font-medium">Nothing matched those filters.</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Try a broader keyword, or clear the filters to browse by business stage.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {results.map(({ lesson, stage }) => (
                <li key={lesson.id}>
                  <LessonRow
                    lesson={lesson}
                    stage={stage}
                    categoryName={categoryNames.get(lesson.categoryId)}
                    state={activity[lesson.id]}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {continueLessons.length > 0 ? (
            <section aria-labelledby="continue-learning">
              <div className="flex items-center justify-between gap-2">
                <h2 id="continue-learning" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <Compass className="size-5 text-primary" /> Continue learning
                </h2>
                <span className="text-xs text-muted-foreground">Opened, not finished</span>
              </div>
              <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
                {continueLessons.map((lesson) => (
                  <li key={lesson.id}>
                    <LessonRow
                      lesson={lesson}
                      stage={lesson.stage}
                      categoryName={categoryNames.get(lesson.categoryId)}
                      state={activity[lesson.id]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {savedLessons.length > 0 ? (
            <section aria-labelledby="saved-lessons">
              <div className="flex items-center justify-between gap-2">
                <h2 id="saved-lessons" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <Bookmark className="size-5 text-primary" /> Saved for later
                </h2>
                <span className="text-xs text-muted-foreground">{savedLessons.length} saved</span>
              </div>
              <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
                {savedLessons.map((lesson) => (
                  <li key={lesson.id}>
                    <LessonRow
                      lesson={lesson}
                      stage={lesson.stage}
                      categoryName={categoryNames.get(lesson.categoryId)}
                      state={activity[lesson.id]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {paths.length > 0 ? (
            <section aria-labelledby="learning-paths">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="learning-paths" className="text-lg font-semibold tracking-tight">
                  Learning paths
                </h2>
                <p className="text-sm text-muted-foreground">Ordered sequences that teach one outcome.</p>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {paths.map((path) => (
                  <PathCard key={path.id} path={path} />
                ))}
              </div>
            </section>
          ) : null}

          {sections.map(({ stage, lessons }) => (
            <StageSection key={stage} stage={stage} lessons={lessons} categories={categories} activity={activity} />
          ))}
        </>
      )}
    </div>
  )
}

function StageSection({
  stage,
  lessons,
  categories,
  activity,
}: {
  stage: LessonStage
  lessons: LibraryLessonView[]
  categories: LessonCategoryView[]
  activity: LessonActivityMap
}) {
  const meta = LESSON_STAGE_META[stage]
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  return (
    <section aria-labelledby={`stage-${stage}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
        <h2 id={`stage-${stage}`} className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <GraduationCap className="size-5 text-muted-foreground" /> {meta.label}
        </h2>
        <p className="text-sm text-muted-foreground">{meta.focus}</p>
      </div>
      {lessons.length > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {lessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              categoryName={categoryNames.get(lesson.categoryId)}
              saved={activity[lesson.id]?.saved}
              completed={activity[lesson.id]?.completed}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">
          No lessons in this stage yet.
        </p>
      )}
    </section>
  )
}

function LessonRow({
  lesson,
  stage,
  categoryName,
  state,
}: {
  lesson: LibraryLessonView
  stage: LessonStage
  categoryName?: string
  state?: { saved: boolean; completed: boolean }
}) {
  return (
    <Link
      href={lesson.href}
      className="group flex min-w-0 flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold leading-6">{lesson.title}</p>
        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{lesson.summary}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {lesson.readingMinutes} min
        </span>
        <span>{LESSON_STAGE_META[stage].label}</span>
        {categoryName ? <span>{categoryName}</span> : null}
        <span className="capitalize">{lesson.difficulty}</span>
        {state?.completed ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CircleCheck className="size-3" /> Completed
          </span>
        ) : state?.saved ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <Bookmark className="size-3" /> Saved
          </span>
        ) : null}
      </p>
    </Link>
  )
}

function PathCard({ path }: { path: LearningPathCard }) {
  return (
    <Link
      href={path.href}
      className="group flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-border px-2 py-0.5 font-mono uppercase tracking-[0.12em]">
          {LESSON_STAGE_META[path.stage].label}
        </span>
        <span className="capitalize">{path.difficulty}</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {path.estimatedMinutes} min
        </span>
        <span>
          {path.lessonCount} {path.lessonCount === 1 ? "lesson" : "lessons"}
        </span>
      </div>
      <h3 className="mt-3 text-base font-semibold leading-6 tracking-tight">{path.title}</h3>
      <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-muted-foreground">{path.description}</p>

      {path.lessonCount > 0 ? (
        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {path.completedCount} of {path.lessonCount} complete
            </span>
            <span className="tabular-nums">{path.percent}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${path.percent}%` }} />
          </div>
          <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary">
            {path.completedCount === 0 ? "Start this path" : path.percent === 100 ? "Review this path" : "Continue this path"}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </p>
        </div>
      ) : null}
    </Link>
  )
}
