import type { ObjectId } from "mongodb"
import type { LessonDifficulty, LessonFile, LessonFormat, LessonStage } from "@/lib/lessons/types"

export const LESSON_STATUSES = ["draft", "published", "archived"] as const

export type LessonStatus = (typeof LESSON_STATUSES)[number]

/**
 * Operator-published business lesson, persisted in MongoDB (`lessons`).
 * The in-code curriculum is NOT editable here — an admin document is its own
 * additional lesson, stage-tagged, merged into the stage libraries at read.
 */
export interface LessonDoc {
  _id?: ObjectId
  id: string
  slug: string
  stage: LessonStage
  categoryId: string
  format: LessonFormat
  title: string
  summary: string
  topics: string[]
  difficulty: LessonDifficulty
  readingMinutes: number
  contentMarkdown?: string
  imageUrl?: string
  youtubeUrl?: string
  externalUrl?: string
  file?: LessonFile
  featured: boolean
  status: LessonStatus
  /** ISO date (YYYY-MM-DD) used for the byline. */
  publishedAt: string
  /** ISO date (YYYY-MM-DD) of the last content edit. */
  updatedAt: string
  createdAt: number
  updatedAtMs: number
  createdBy: string
  updatedBy: string
}

export type AdminLessonInput = Omit<LessonDoc, "_id" | "id" | "createdAt" | "updatedAtMs" | "createdBy" | "updatedBy" | "publishedAt" | "updatedAt" | "slug"> & {
  slug?: string
  publishedAt?: string
  updatedAt?: string
}

/** What the admin list endpoint returns (no Mongo `_id`). */
export type AdminLessonView = Omit<LessonDoc, "_id"> & {
  href: string
}
