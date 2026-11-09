import { describe, expect, it } from "vitest"
import {
  completedLessonRefs,
  inProgressLessonRefs,
  isLibraryLessonRef,
  nextActivityState,
  savedLessonRefs,
  type LessonActivityMap,
} from "@/lib/lessons/activity"
import {
  DEFAULT_LEARNING_PATHS,
  computePathProgress,
  recommendedPathForStage,
  resolvePathLessons,
  type LearningPathView,
} from "@/lib/lessons/paths"
import { learningPathObjectSchema } from "@/lib/lessons/path-schema"
import {
  CORE_LESSON_CATEGORY,
  LESSON_CATEGORY_SEED,
  categoryForCoreLesson,
  mergeLessonCategories,
} from "@/lib/lessons/taxonomy"
import { filterLearningPaths, filterLibraryLessons } from "@/lib/lessons/filter"
import type { CoreLessonView, CuratedLessonView, LibraryLessonView } from "@/lib/lessons/types"
import type { LearningPathCard } from "@/lib/lessons/paths"
import { coreLessonForResource } from "@/lib/lessons/curriculum"
import { getResourceById } from "@/lib/resources"

const categories = LESSON_CATEGORY_SEED

function coreLesson(overrides: Partial<CoreLessonView> = {}): CoreLessonView {
  return {
    id: "core:start/how-to-validate-a-business-idea",
    stage: "planning",
    categoryId: "ideas",
    title: "How to validate a business idea",
    summary: "Talk to real people before you build.",
    href: "/resources/start/how-to-validate-a-business-idea",
    readingMinutes: 8,
    difficulty: "beginner",
    whyNow: "You are about to commit credits.",
    source: "core",
    ...overrides,
  }
}

function adminLesson(overrides: Partial<CuratedLessonView> = {}): CuratedLessonView {
  return {
    id: "les_abc",
    stage: "planning",
    categoryId: "marketing",
    title: "Positioning for first customers",
    summary: "A practical positioning worksheet.",
    href: "/lessons/positioning",
    format: "video",
    topics: ["positioning", "brand"],
    difficulty: "intermediate",
    readingMinutes: 12,
    featured: false,
    source: "admin",
    ...overrides,
  }
}

describe("lesson activity", () => {
  it("applies each action without duplicating documents", () => {
    const now = 1_000
    const saved = nextActivityState(undefined, "save", now)
    expect(saved).toMatchObject({ saved: true, completed: false, savedAt: now })

    const completed = nextActivityState(saved, "complete", now + 1)
    expect(completed).toMatchObject({ saved: true, completed: true, completedAt: now + 1 })

    expect(nextActivityState(completed, "uncomplete", now + 2)).toMatchObject({
      completed: false,
      completedAt: undefined,
    })
    expect(nextActivityState(completed, "unsave", now + 3)).toMatchObject({ saved: false })
    expect(nextActivityState(undefined, "open", now + 4)).toMatchObject({ lastOpenedAt: now + 4 })
  })

  it("derives completed, saved, and in-progress sets", () => {
    const activity: LessonActivityMap = {
      "core:a/one": { saved: true, completed: true, lastOpenedAt: 10, completedAt: 9, updatedAt: 10 },
      "core:a/two": { saved: false, completed: false, lastOpenedAt: 20, updatedAt: 20 },
      "les_three": { saved: true, completed: false, savedAt: 30, lastOpenedAt: 5, updatedAt: 30 },
      "les_four": { saved: true, completed: false, savedAt: 15, updatedAt: 15 },
    }

    expect([...completedLessonRefs(activity)]).toEqual(["core:a/one"])
    expect(savedLessonRefs(activity)).toEqual(["les_three", "les_four", "core:a/one"])
    expect(inProgressLessonRefs(activity)).toEqual(["core:a/two", "les_three"])
    expect(inProgressLessonRefs(activity, 1)).toEqual(["core:a/two"])
  })

  it("accepts only library lesson refs", () => {
    expect(isLibraryLessonRef("core:start/how-to-validate-a-business-idea")).toBe(true)
    expect(isLibraryLessonRef("les_1234")).toBe(true)
    expect(isLibraryLessonRef("../../etc/passwd")).toBe(false)
    expect(isLibraryLessonRef("core:../../x")).toBe(false)
    expect(isLibraryLessonRef("bls_project_lesson")).toBe(false)
  })
})

describe("learning paths", () => {
  it("computes progress only for lessons still in the path", () => {
    const refs = ["core:a/one", "core:a/two", "core:a/three"]
    expect(computePathProgress(refs, new Set(["core:a/two", "core:not/in-path"]))).toEqual({
      total: 3,
      completed: 1,
      percent: 33,
      nextRef: "core:a/one",
      started: true,
    })
    expect(computePathProgress(refs, new Set(refs))).toMatchObject({ percent: 100, nextRef: null })
    expect(computePathProgress([], new Set())).toEqual({
      total: 0,
      completed: 0,
      percent: 0,
      nextRef: null,
      started: false,
    })
  })

  it("resolves lessons in path order and drops missing ones", () => {
    const lessons: LibraryLessonView[] = [
      coreLesson({ id: "core:a/one" }),
      adminLesson({ id: "les_abc" }),
    ]
    const map = new Map(lessons.map((lesson) => [lesson.id, lesson]))
    const resolved = resolvePathLessons(
      { lessonRefs: ["les_abc", "core:missing/x", "core:a/one"] },
      map,
    )
    expect(resolved.map((lesson) => lesson.id)).toEqual(["les_abc", "core:a/one"])
  })

  it("prefers a featured path at the founder's stage", () => {
    const paths: LearningPathView[] = [
      {
        ...pathView("early", "planning", false, 5),
      },
      {
        ...pathView("featured", "planning", true, 50),
      },
      {
        ...pathView("other-stage", "live", true, 1),
      },
    ]
    expect(recommendedPathForStage(paths, "planning")?.title).toBe("featured")
    expect(recommendedPathForStage(paths, "building")).toBeNull()
  })

  it("ships default paths whose refs point at real catalog lessons", () => {
    for (const path of DEFAULT_LEARNING_PATHS) {
      expect(path.lessonRefs.length).toBeGreaterThan(0)
      for (const ref of path.lessonRefs) {
        expect(ref.startsWith("core:")).toBe(true)
        expect(getResourceById(ref.slice("core:".length))).not.toBeNull()
      }
    }
    const slugs = DEFAULT_LEARNING_PATHS.map((path) => path.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe("lesson filters", () => {
  const sections = [
    {
      stage: "planning" as const,
      lessons: [coreLesson(), adminLesson()],
    },
  ]

  it("searches title, summary, topics, and category names", () => {
    expect(
      filterLibraryLessons(sections, categories, {
        query: "validate",
        categoryId: "all",
        difficulty: "all",
        format: "all",
      }),
    ).toHaveLength(1)
    expect(
      filterLibraryLessons(sections, categories, {
        query: "brand",
        categoryId: "all",
        difficulty: "all",
        format: "all",
      })[0]?.lesson.id,
    ).toBe("les_abc")
    expect(
      filterLibraryLessons(sections, categories, {
        query: "marketing and branding",
        categoryId: "all",
        difficulty: "all",
        format: "all",
      })[0]?.lesson.id,
    ).toBe("les_abc")
  })

  it("filters category, difficulty, and format together", () => {
    expect(
      filterLibraryLessons(sections, categories, {
        query: "",
        categoryId: "ideas",
        difficulty: "all",
        format: "all",
      }).map((entry) => entry.lesson.id),
    ).toEqual(["core:start/how-to-validate-a-business-idea"])

    expect(
      filterLibraryLessons(sections, categories, {
        query: "",
        categoryId: "all",
        difficulty: "intermediate",
        format: "video",
      }).map((entry) => entry.lesson.id),
    ).toEqual(["les_abc"])

    expect(
      filterLibraryLessons(sections, categories, {
        query: "",
        categoryId: "all",
        difficulty: "beginner",
        format: "video",
      }),
    ).toHaveLength(0)
  })

  it("matches learning paths by query", () => {
    const paths: LearningPathCard[] = [
      {
        id: "path-1",
        slug: "validate-your-business-idea",
        title: "Validate your business idea",
        description: "Interview customers before building.",
        objectives: ["Talk to buyers"],
        audience: "First-time founders",
        stage: "planning",
        difficulty: "beginner",
        estimatedMinutes: 45,
        lessonCount: 3,
        completedCount: 0,
        percent: 0,
        nextLessonTitle: "How to validate a business idea",
        href: "/lessons/paths/validate-your-business-idea",
      },
    ]
    expect(filterLearningPaths(paths, "buyers")).toHaveLength(1)
    expect(filterLearningPaths(paths, "pricing")).toHaveLength(0)
    expect(filterLearningPaths(paths, "")).toHaveLength(0)
  })
})

describe("lesson taxonomy", () => {
  it("maps every core lesson to a known category", () => {
    for (const categoryId of Object.values(CORE_LESSON_CATEGORY)) {
      expect(categories.some((category) => category.id === categoryId)).toBe(true)
    }
    expect(categoryForCoreLesson("start/how-to-validate-a-business-idea")).toBe("ideas")
    expect(categoryForCoreLesson("unknown/lesson")).toBe("foundations")
  })

  it("merges stored overrides over defaults and ignores unknown ids", () => {
    const merged = mergeLessonCategories([
      {
        id: "ideas",
        name: "Idea testing",
        description: "  ",
        order: 5,
        hidden: true,
        updatedAtMs: 1,
        updatedBy: "admin",
      },
      {
        id: "retired",
        name: "Retired",
        description: "Should never appear",
        order: 1,
        hidden: false,
        updatedAtMs: 1,
        updatedBy: "admin",
      },
    ])
    expect(merged.find((category) => category.id === "ideas")).toMatchObject({
      name: "Idea testing",
      hidden: true,
      order: 5,
    })
    expect(merged.some((category) => category.id === "retired")).toBe(false)
    expect(merged).toHaveLength(LESSON_CATEGORY_SEED.length)
    // order 5 beats every seed order, so the override sorts first
    expect(merged[0]?.id).toBe("ideas")
    // a blank stored description falls back to the curated seed copy
    expect(merged.find((category) => category.id === "ideas")?.description).toBe(
      LESSON_CATEGORY_SEED.find((category) => category.id === "ideas")?.description,
    )
  })

  it("resolves the curriculum lesson behind a resource page", () => {
    expect(coreLessonForResource("start/how-to-validate-a-business-idea")?.id).toBe(
      "core:start/how-to-validate-a-business-idea",
    )
    expect(coreLessonForResource("start/how-to-validate-a-business-idea")?.href).toBe(
      "/resources/start/how-to-validate-a-business-idea",
    )
    expect(coreLessonForResource("nonexistent/resource")).toBeNull()
  })
})

describe("learning path validation", () => {
  const valid = {
    title: "Validate your idea",
    description: "A practical path for testing a business idea before you build.",
    objectives: ["Talk to ten buyers"],
    audience: "First-time founders",
    stage: "planning" as const,
    difficulty: "beginner" as const,
    estimatedMinutes: 45,
    lessonRefs: ["core:start/how-to-validate-a-business-idea"],
    status: "draft" as const,
    featured: false,
    order: 10,
  }

  it("accepts a well-formed path", () => {
    expect(learningPathObjectSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects duplicate lessons, bad slugs, and unknown refs", () => {
    expect(
      learningPathObjectSchema.safeParse({
        ...valid,
        lessonRefs: [valid.lessonRefs[0], valid.lessonRefs[0]],
      }).success,
    ).toBe(false)
    expect(learningPathObjectSchema.safeParse({ ...valid, slug: "Not A Slug" }).success).toBe(false)
    expect(
      learningPathObjectSchema.safeParse({ ...valid, lessonRefs: ["https://example.com/lesson"] }).success,
    ).toBe(false)
  })
})

function pathView(title: string, stage: LearningPathView["stage"], featured: boolean, order: number): LearningPathView {
  return {
    id: `path-${title}`,
    slug: title,
    title,
    description: "Description long enough for a path.",
    objectives: ["Objective"],
    audience: "Founders",
    stage,
    difficulty: "beginner",
    estimatedMinutes: 30,
    lessonRefs: ["core:start/how-to-validate-a-business-idea"],
    featured,
    order,
    href: `/lessons/paths/${title}`,
  }
}
