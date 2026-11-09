import "server-only"

import { businessLessonsCol } from "@/lib/db/collections"
import { logger } from "@/lib/logging/logger"
import { cryptoId } from "@/lib/store/id"
import type { GeneratedLessonDoc, GeneratedLessonSnapshot, LessonSource, LessonStage } from "@/lib/lessons/types"

export interface GeneratedPackInput {
  userId: string
  projectId: string
  stage: LessonStage
  fingerprint: string
  snapshot: GeneratedLessonSnapshot
  lessons: Array<{
    topicKey: string
    title: string
    bodyMarkdown: string
    sources: LessonSource[]
    videos: { title: string; url: string }[]
    grounded: boolean
  }>
}

/** Newest version number currently stored for a project (0 when none). */
async function nextVersion(projectId: string): Promise<number> {
  const col = await businessLessonsCol()
  const latest = await col.find({ projectId }).sort({ version: -1 }).limit(1).next() as GeneratedLessonDoc | null
  return (latest?.version ?? 0) + 1
}

/**
 * Persist a generation run: archive the previous active pack, insert the new
 * one. History is never deleted — the founder can compare what the pack said
 * at the stage the business was at then. Returns the inserted active lessons.
 */
export async function insertGeneratedPack(input: GeneratedPackInput): Promise<GeneratedLessonDoc[]> {
  const col = await businessLessonsCol()
  const packId = `pack_${cryptoId()}`
  const version = await nextVersion(input.projectId)
  const now = Date.now()

  await col.updateMany({ projectId: input.projectId, status: "active" }, { $set: { status: "archived" } })

  const docs: GeneratedLessonDoc[] = input.lessons.map((lesson) => ({
    id: `bls_${cryptoId()}`,
    userId: input.userId,
    projectId: input.projectId,
    packId,
    version,
    topicKey: lesson.topicKey,
    title: lesson.title,
    stage: input.stage,
    bodyMarkdown: lesson.bodyMarkdown,
    sources: lesson.sources,
    videos: lesson.videos,
    grounded: lesson.grounded,
    contextFingerprint: input.fingerprint,
    contextSnapshot: input.snapshot,
    status: "active",
    createdAt: now,
  }))
  if (docs.length > 0) await col.insertMany(docs)
  logger.info("lessons.generated", "lesson pack stored", {
    projectId: input.projectId,
    packId,
    version,
    lessons: docs.length,
  })
  return docs
}

/** The founder's current active pack for a project (empty when none). */
export async function listActiveGeneratedLessons(projectId: string): Promise<GeneratedLessonDoc[]> {
  const col = await businessLessonsCol()
  return (await col
    .find({ projectId, status: "active" })
    .sort({ createdAt: 1 })
    .toArray()) as GeneratedLessonDoc[]
}

/** How many archived lessons exist (for the history disclosure). */
export async function countArchivedGeneratedLessons(projectId: string): Promise<number> {
  const col = await businessLessonsCol()
  return col.countDocuments({ projectId, status: "archived" })
}

/** One generated lesson, ownership-checked — the reader route's only access path. */
export async function getGeneratedLessonForUser(
  lessonId: string,
  userId: string,
  projectId: string,
): Promise<GeneratedLessonDoc | null> {
  const col = await businessLessonsCol()
  const doc = (await col.findOne({ id: lessonId, userId, projectId })) as GeneratedLessonDoc | null
  return doc
}
