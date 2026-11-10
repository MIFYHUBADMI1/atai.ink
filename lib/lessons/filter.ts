import type {
  LibraryLessonView,
  LessonDifficulty,
  LessonFormat,
  LessonStage,
} from "@/lib/lessons/types"
import type { LearningPathCard } from "@/lib/lessons/paths"
import type { LessonCategoryView } from "@/lib/lessons/taxonomy"

export interface LessonFilter {
  query: string
  categoryId: string
  difficulty: "all" | LessonDifficulty
  format: "all" | LessonFormat
}

export interface LessonStageSection {
  stage: LessonStage
  lessons: LibraryLessonView[]
}

export interface FilteredLesson {
  lesson: LibraryLessonView
  stage: LessonStage
}

export function lessonFormatOf(lesson: LibraryLessonView): LessonFormat {
  return lesson.source === "admin" ? lesson.format : "article"
}

export function lessonTopicsOf(lesson: LibraryLessonView): string[] {
  return lesson.source === "admin" ? lesson.topics : []
}

export function lessonCategoryName(
  lesson: LibraryLessonView,
  categories: readonly LessonCategoryView[],
): string | undefined {
  return categories.find((category) => category.id === lesson.categoryId)?.name
}

export function matchesLessonQuery(
  lesson: LibraryLessonView,
  query: string,
  categories: readonly LessonCategoryView[],
): boolean {
  if (!query) return true
  return [
    lesson.title,
    lesson.summary,
    lessonCategoryName(lesson, categories) ?? "",
    ...lessonTopicsOf(lesson),
    lesson.source === "core" ? lesson.whyNow : "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(query)
}

/** Filter and flatten stage sections in their original order. */
export function filterLibraryLessons(
  sections: readonly LessonStageSection[],
  categories: readonly LessonCategoryView[],
  filter: LessonFilter,
): FilteredLesson[] {
  const query = filter.query.trim().toLowerCase()
  return sections.flatMap((section) =>
    section.lessons
      .filter((lesson) => {
        if (filter.categoryId !== "all" && lesson.categoryId !== filter.categoryId) return false
        if (filter.difficulty !== "all" && lesson.difficulty !== filter.difficulty) return false
        if (filter.format !== "all" && lessonFormatOf(lesson) !== filter.format) return false
        return matchesLessonQuery(lesson, query, categories)
      })
      .map((lesson) => ({ lesson, stage: section.stage })),
  )
}

export function filterLearningPaths(paths: readonly LearningPathCard[], query: string): LearningPathCard[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  return paths.filter((path) =>
    [path.title, path.description, path.audience, ...path.objectives]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  )
}
