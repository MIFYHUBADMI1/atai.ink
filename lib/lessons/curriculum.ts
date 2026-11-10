import { getResourceById } from "@/lib/resources"
import { categoryForCoreLesson } from "@/lib/lessons/taxonomy"
import type { CoreLessonView, LessonStage } from "@/lib/lessons/types"

/**
 * The core business curriculum — identical for every business. Each stage
 * frames a short list of editorial catalog resources as lessons with a
 * stage-specific "why now". Nothing here is AI-generated or user-specific;
 * the per-project AI lessons layer builds on top of this.
 */

interface CoreCurriculumEntry {
  /** Catalog resource id (`category/slug`). */
  id: string
  whyNow: string
}

const CORE_CURRICULUM: Record<LessonStage, { lessons: CoreCurriculumEntry[] }> = {
  planning: {
    lessons: [
      {
        id: "start/how-to-validate-a-business-idea",
        whyNow: "You are about to commit time and credits — pressure-test the idea with real people first.",
      },
      {
        id: "start/founder-fundamentals",
        whyNow: "Lock the fundamentals: who it is for, the pain it removes, and why you are the one to build it.",
      },
      {
        id: "templates/customer-interview-template",
        whyNow: "Five real conversations this week beat a month of guessing.",
      },
      {
        id: "build/product-requirements",
        whyNow: "Turn what you learn into a scope you can actually hand to a build team.",
      },
    ],
  },
  building: {
    lessons: [
      {
        id: "build/how-to-build-an-mvp",
        whyNow: "The build is running — keep the scope honest to the first usable version.",
      },
      {
        id: "build/product-requirements",
        whyNow: "Re-read the plan: it should say what you need, not everything you could build.",
      },
      {
        id: "templates/mvp-checklist",
        whyNow: "A checklist keeps the first version shippable instead of endless.",
      },
      {
        id: "launch/launch-checklist",
        whyNow: "Domain, analytics, payments, terms — get them ready before launch day.",
      },
    ],
  },
  live: {
    lessons: [
      {
        id: "launch/how-to-launch-a-product",
        whyNow: "The app is live — now put it in front of real people deliberately.",
      },
      {
        id: "grow/find-early-customers",
        whyNow: "Do things that don't scale to land your first ten customers.",
      },
      {
        id: "launch/launch-checklist",
        whyNow: "Re-check the essentials now that real users are arriving.",
      },
    ],
  },
  growing: {
    lessons: [
      {
        id: "grow/find-early-customers",
        whyNow: "Turn manual outreach into a repeatable acquisition channel.",
      },
      {
        id: "ai/what-is-an-ai-agent",
        whyNow: "Automation and AI agents can multiply what a small team can do.",
      },
      {
        id: "build/how-to-build-an-mvp",
        whyNow: "New features deserve the same MVP discipline that got you here.",
      },
    ],
  },
}

function toView(entry: CoreCurriculumEntry, stage: LessonStage): CoreLessonView | null {
  const resource = getResourceById(entry.id)
  if (!resource) return null
  return {
    id: `core:${entry.id}`,
    stage,
    categoryId: categoryForCoreLesson(entry.id),
    title: resource.title,
    summary: resource.description,
    href: `/resources/${resource.category}/${resource.slug}`,
    readingMinutes: resource.readingMinutes,
    difficulty: resource.difficulty,
    whyNow: entry.whyNow,
    source: "core",
  }
}

/** Core lessons for one stage, in curriculum order. Catalog entries that no
 * longer exist are dropped rather than rendered as dead links. */
export function coreLessonsForStage(stage: LessonStage): CoreLessonView[] {
  return CORE_CURRICULUM[stage].lessons
    .map((entry) => toView(entry, stage))
    .filter((lesson): lesson is CoreLessonView => lesson !== null)
}

/** Every core lesson across all stages — the global library skeleton. */
export function allCoreLessons(): CoreLessonView[] {
  return (["planning", "building", "live", "growing"] as const).flatMap((stage) =>
    coreLessonsForStage(stage),
  )
}

/**
 * The core-curriculum lesson backed by a catalog resource (`category/slug`),
 * or null when the resource is not part of the curriculum. The resource page
 * uses this to show save/complete controls for lessons a founder can reach
 * directly from search or the library.
 */
export function coreLessonForResource(resourceId: string): CoreLessonView | null {
  return allCoreLessons().find((lesson) => lesson.id === `core:${resourceId}`) ?? null
}
