import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { learningPathObjectSchema } from "@/lib/lessons/path-schema"
import { createLearningPath, listAdminLearningPaths } from "@/lib/lessons/paths-store"
import { allLibraryLessons } from "@/lib/lessons/store"

export const dynamic = "force-dynamic"

async function assertKnownLessons(refs: readonly string[]) {
  const known = new Set((await allLibraryLessons()).map((lesson) => lesson.id))
  const missing = refs.find((ref) => !known.has(ref))
  if (missing) {
    throw new AppError(
      "VALIDATION",
      "Only published lessons can be added to a path. Publish the lesson first.",
      422,
    )
  }
}

export async function GET() {
  try {
    await requireAdmin()
    const [items, lessons] = await Promise.all([listAdminLearningPaths(), allLibraryLessons()])
    return ok({
      items,
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        stage: lesson.stage,
        difficulty: lesson.difficulty,
        readingMinutes: lesson.readingMinutes,
        source: lesson.source,
      })),
    })
  } catch (error) {
    return handleRouteError("api.admin.learning_paths.list", error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const parsed = learningPathObjectSchema.safeParse(await readJsonBody(req, 32_000))
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the path details.", 422)
    }
    await assertKnownLessons(parsed.data.lessonRefs)
    const created = await createLearningPath(parsed.data, admin.id)
    return ok({ item: created }, { status: 201 })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.learning_paths.create", error)
  }
}
