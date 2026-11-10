import type { ObjectId } from "mongodb"
import type { LessonDifficulty, LibraryLessonView, LessonStage } from "@/lib/lessons/types"

/**
 * Learning paths — an ordered sequence of library lessons that teaches one
 * outcome. Defaults live in code and are idempotent; published paths are read
 * from MongoDB so admins can create, reorder, publish, and retire them.
 */

export const LEARNING_PATH_STATUSES = ["draft", "published", "archived"] as const
export type LearningPathStatus = (typeof LEARNING_PATH_STATUSES)[number]

export interface LearningPathDoc {
  _id?: ObjectId
  id: string
  slug: string
  title: string
  description: string
  objectives: string[]
  audience: string
  stage: LessonStage
  difficulty: LessonDifficulty
  estimatedMinutes: number
  /** Library lesson ids (`core:<category>/<slug>` or an admin lesson id). */
  lessonRefs: string[]
  status: LearningPathStatus
  featured: boolean
  order: number
  createdAt: number
  updatedAtMs: number
  createdBy: string
  updatedBy: string
}

export interface LearningPathView {
  id: string
  slug: string
  title: string
  description: string
  objectives: string[]
  audience: string
  stage: LessonStage
  difficulty: LessonDifficulty
  estimatedMinutes: number
  lessonRefs: string[]
  featured: boolean
  order: number
  href: string
}

export type LearningPathInput = Pick<
  LearningPathDoc,
  | "title"
  | "description"
  | "objectives"
  | "audience"
  | "stage"
  | "difficulty"
  | "estimatedMinutes"
  | "lessonRefs"
  | "featured"
  | "order"
> & {
  slug?: string
  status: LearningPathStatus
}

export const DEFAULT_LEARNING_PATHS: readonly LearningPathDoc[] = [
  {
    id: "path-validate-idea",
    slug: "validate-your-business-idea",
    title: "Validate your business idea",
    description:
      "Turn an assumption into evidence: understand the problem, interview real people, and decide what to build next.",
    objectives: [
      "State the problem and the customer in one sentence",
      "Run customer interviews without leading the witness",
      "Decide whether to build, change, or drop the idea",
    ],
    audience: "Founders who have an idea but no customer evidence yet.",
    stage: "planning",
    difficulty: "beginner",
    estimatedMinutes: 45,
    lessonRefs: [
      "core:start/how-to-validate-a-business-idea",
      "core:templates/customer-interview-template",
      "core:start/founder-fundamentals",
    ],
    status: "published",
    featured: true,
    order: 10,
    createdAt: 0,
    updatedAtMs: 0,
    createdBy: "system",
    updatedBy: "system",
  },
  {
    id: "path-first-launch",
    slug: "launch-your-first-product",
    title: "Launch your first product",
    description:
      "Scope a shippable first version, prepare the launch essentials, and put the product in front of real people.",
    objectives: [
      "Write requirements that keep the first version small",
      "Use a launch checklist so nothing essential is missing",
      "Run a launch that produces real users and feedback",
    ],
    audience: "Founders who are building or about to launch their first product.",
    stage: "building",
    difficulty: "intermediate",
    estimatedMinutes: 90,
    lessonRefs: [
      "core:build/product-requirements",
      "core:build/how-to-build-an-mvp",
      "core:templates/mvp-checklist",
      "core:launch/launch-checklist",
      "core:launch/how-to-launch-a-product",
    ],
    status: "published",
    featured: true,
    order: 20,
    createdAt: 0,
    updatedAtMs: 0,
    createdBy: "system",
    updatedBy: "system",
  },
  {
    id: "path-first-customers",
    slug: "find-your-first-customers",
    title: "Find your first customers",
    description:
      "Go from a live product to deliberate acquisition: launch properly, talk to early users, and land the first ten customers.",
    objectives: [
      "Choose one acquisition motion instead of five",
      "Run outreach that starts real conversations",
      "Turn early users into repeatable evidence",
    ],
    audience: "Founders whose product is live but has few or no customers.",
    stage: "live",
    difficulty: "beginner",
    estimatedMinutes: 60,
    lessonRefs: [
      "core:launch/how-to-launch-a-product",
      "core:launch/launch-checklist",
      "core:grow/find-early-customers",
    ],
    status: "published",
    featured: false,
    order: 30,
    createdAt: 0,
    updatedAtMs: 0,
    createdBy: "system",
    updatedBy: "system",
  },
  {
    id: "path-grow-repeatable",
    slug: "grow-a-repeatable-business",
    title: "Grow a repeatable business",
    description:
      "Turn ad-hoc wins into repeatable channels, use automation deliberately, and keep product scope honest as you grow.",
    objectives: [
      "Identify which acquisition work is actually repeatable",
      "Decide where automation genuinely saves time",
      "Keep new features tied to customer evidence",
    ],
    audience: "Founders with early traction who want growth without losing focus.",
    stage: "growing",
    difficulty: "advanced",
    estimatedMinutes: 75,
    lessonRefs: [
      "core:grow/find-early-customers",
      "core:ai/what-is-an-ai-agent",
      "core:build/how-to-build-an-mvp",
    ],
    status: "published",
    featured: false,
    order: 40,
    createdAt: 0,
    updatedAtMs: 0,
    createdBy: "system",
    updatedBy: "system",
  },
] as const

export function isDefaultLearningPath(id: string): boolean {
  return DEFAULT_LEARNING_PATHS.some((path) => path.id === id)
}

export function toLearningPathView(doc: LearningPathDoc): LearningPathView {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    objectives: doc.objectives,
    audience: doc.audience,
    stage: doc.stage,
    difficulty: doc.difficulty,
    estimatedMinutes: doc.estimatedMinutes,
    lessonRefs: doc.lessonRefs,
    featured: doc.featured,
    order: doc.order,
    href: `/lessons/paths/${doc.slug}`,
  }
}

export function sortLearningPaths<T extends { featured?: boolean; order: number; title: string }>(paths: readonly T[]): T[] {
  return [...paths].sort((a, b) => {
    if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1
    return a.order - b.order || a.title.localeCompare(b.title)
  })
}

/** Resolve a path's refs to lessons in the stored order, dropping anything
 * unpublished or removed so the path never shows a dead step. */
export function resolvePathLessons(
  path: Pick<LearningPathDoc, "lessonRefs">,
  lessonsById: ReadonlyMap<string, LibraryLessonView>,
): LibraryLessonView[] {
  return path.lessonRefs
    .map((ref) => lessonsById.get(ref))
    .filter((lesson): lesson is LibraryLessonView => Boolean(lesson))
}

/** Serialized path summary for the library and admin surfaces. */
export interface LearningPathCard {
  id: string
  slug: string
  title: string
  description: string
  objectives: string[]
  audience: string
  stage: LessonStage
  difficulty: LessonDifficulty
  estimatedMinutes: number
  lessonCount: number
  completedCount: number
  percent: number
  nextLessonTitle: string | null
  href: string
}

export interface PathProgress {
  total: number
  completed: number
  percent: number
  nextRef: string | null
  started: boolean
}

/** Progress counts only lessons that still belong to the path. */
export function computePathProgress(
  lessonRefs: readonly string[],
  completedRefs: ReadonlySet<string>,
): PathProgress {
  const total = lessonRefs.length
  const completed = lessonRefs.filter((ref) => completedRefs.has(ref)).length
  const nextRef = lessonRefs.find((ref) => !completedRefs.has(ref)) ?? null
  return {
    total,
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    nextRef,
    started: completed > 0,
  }
}

/** The path a founder should be nudged toward at their stage, preferring a
 * featured path, then the earliest published path for that stage. */
export function recommendedPathForStage<
  T extends { stage: LessonStage; featured: boolean; order: number; title: string },
>(paths: readonly T[], stage: LessonStage): T | null {
  const inStage = sortLearningPaths(paths.filter((path) => path.stage === stage))
  return inStage[0] ?? null
}
