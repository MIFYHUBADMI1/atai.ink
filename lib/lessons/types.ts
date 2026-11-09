import type { ObjectId } from "mongodb"
import type { BusinessStage } from "@/lib/resources/business-intelligence"

/**
 * Business lessons — shared types.
 *
 * Three lesson sources feed the surface:
 *  - `core`     — the in-code curriculum (stage-framed references to the
 *                 editorial resource catalog; identical for every business).
 *  - `admin`    — founder-facing lessons the operator publishes from
 *                 /admin/lessons (articles, videos, PDFs, images, links),
 *                 stored in the `lessons` collection and merged over core.
 *  - `generated`— per-project AI lessons (the `business_lessons` collection),
 *                 scoped to one founder and one project.
 */

/** Identical union to `BusinessStage`; re-declared for a stable import surface. */
export type LessonStage = BusinessStage

export const LESSON_STAGES = ["planning", "building", "live", "growing"] as const satisfies readonly LessonStage[]

export const LESSON_STAGE_META: Record<LessonStage, { label: string; focus: string }> = {
  planning: { label: "Planning", focus: "Validate the idea before spending build credits." },
  building: { label: "Building", focus: "Scope tight, build the MVP, prepare launch while it builds." },
  live: { label: "Live", focus: "First users, first feedback, first revenue." },
  growing: { label: "Growing", focus: "Double down on what works and systematize it." },
}

export const LESSON_FORMATS = ["article", "video", "link", "file", "image"] as const
export type LessonFormat = (typeof LESSON_FORMATS)[number]

export const LESSON_FORMAT_LABEL: Record<LessonFormat, string> = {
  article: "Article",
  video: "Video",
  link: "Link",
  file: "Document",
  image: "Image",
}

export type LessonDifficulty = "beginner" | "intermediate" | "advanced"

export interface LessonFile {
  url: string
  name: string
  mimeType: string
  size: number
  provider: "imagekit" | "external"
}

export interface LessonSource {
  title: string
  url: string
  kind: "web" | "video" | "resource"
}

/** A stage-framed reference to an editorial catalog resource (in code). */
export interface CoreLessonView {
  id: string
  stage: LessonStage
  title: string
  summary: string
  href: string
  readingMinutes: number
  difficulty: LessonDifficulty
  /** Why this lesson matters right now, given the business stage. */
  whyNow: string
  source: "core"
}

/** An operator-published lesson rendered from the `lessons` collection. */
export interface CuratedLessonView {
  id: string
  stage: LessonStage
  title: string
  summary: string
  href: string
  format: LessonFormat
  topics: string[]
  difficulty: LessonDifficulty
  readingMinutes: number
  featured: boolean
  youtubeUrl?: string
  externalUrl?: string
  file?: LessonFile
  imageUrl?: string
  source: "admin"
}

export type LibraryLessonView = CoreLessonView | CuratedLessonView

/** One AI-generated lesson inside a per-project pack. */
export interface GeneratedLessonView {
  id: string
  title: string
  stage: LessonStage
  bodyMarkdown: string
  sources: LessonSource[]
  videos: { title: string; url: string }[]
  grounded: boolean
  createdAt: number
  href: string
}

/** Readable snapshot of where the business stood when the pack was written. */
export interface GeneratedLessonSnapshot {
  state: string
  stage: LessonStage
  planPercent: number | null
}

/**
 * Per-project AI lesson (`business_lessons` collection). A generation run
 * produces one PACK (three lessons sharing a packId and version); the run
 * archives the previous active pack — history is kept, never deleted, so the
 * founder can see how earlier advice fits the stage the business was at then.
 * `contextFingerprint` (state + full specification) marks the pack stale the
 * moment the business moves; regeneration is always founder-initiated.
 */
export interface GeneratedLessonDoc {
  _id?: ObjectId
  id: string
  userId: string
  projectId: string
  packId: string
  version: number
  topicKey: string
  title: string
  stage: LessonStage
  bodyMarkdown: string
  sources: LessonSource[]
  videos: { title: string; url: string }[]
  /** False when every web search failed — the lesson is then explicitly
   * labeled as ungrounded advice rather than silently pretending research. */
  grounded: boolean
  contextFingerprint: string
  contextSnapshot: GeneratedLessonSnapshot
  status: "active" | "archived"
  createdAt: number
}
