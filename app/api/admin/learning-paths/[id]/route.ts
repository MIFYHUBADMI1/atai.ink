import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { learningPathPatchSchema } from "@/lib/lessons/path-schema"
import { deleteLearningPath, listAdminLearningPaths, updateLearningPath } from "@/lib/lessons/paths-store"
import { allLibraryLessons } from "@/lib/lessons/store"

export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const parsed = learningPathPatchSchema.safeParse(await readJsonBody(req, 32_000))
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the path details.", 422)
    }
    if (parsed.data.lessonRefs) {
      const known = new Set((await allLibraryLessons()).map((lesson) => lesson.id))
      // A lesson may have been unpublished after the path was written; keep
      // it editable rather than forcing the admin to silently drop it.
      const existing = (await listAdminLearningPaths()).find((path) => path.id === id)
      for (const ref of existing?.lessonRefs ?? []) known.add(ref)
      const missing = parsed.data.lessonRefs.find((ref) => !known.has(ref))
      if (missing) {
        throw new AppError(
          "VALIDATION",
          "Only published lessons can be added to a path. Publish the lesson first.",
          422,
        )
      }
    }
    const updated = await updateLearningPath(id, parsed.data, admin.id)
    if (!updated) return fail("NOT_FOUND", "Learning path not found.", 404)
    return ok({ item: updated })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.learning_paths.update", error)
  }
}

/** DELETE archives by default (reversible). Built-in paths can only be
 * archived; `?hard=1` permanently deletes an admin-created path. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const hard = req.nextUrl.searchParams.get("hard") === "1"

    if (hard) {
      await deleteLearningPath(id)
      return ok({ id, deleted: true })
    }
    const updated = await updateLearningPath(id, { status: "archived" }, admin.id)
    if (!updated) return fail("NOT_FOUND", "Learning path not found.", 404)
    return ok({ id, deleted: false })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.learning_paths.delete", error)
  }
}
