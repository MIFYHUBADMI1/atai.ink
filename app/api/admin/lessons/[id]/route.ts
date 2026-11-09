import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { lessonObjectSchema } from "@/lib/lessons/admin-schema"
import { revalidateLessonSurfaces } from "@/lib/lessons/revalidate"
import {
  deleteAdminLesson,
  getAdminLessonDoc,
  invalidateLessonCache,
  setAdminLessonStatus,
  toAdminLessonView,
  updateAdminLesson,
} from "@/lib/lessons/store"

export const dynamic = "force-dynamic"

const patchSchema = lessonObjectSchema.partial()

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const existing = await getAdminLessonDoc(id)
    if (!existing) return fail("NOT_FOUND", "Lesson not found.", 404)

    const body = await readJsonBody(req, 512_000)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the lesson details.", 422)
    }
    const patch = { ...parsed.data }
    if (parsed.data.slug !== undefined) patch.slug = parsed.data.slug || undefined

    const updated = await updateAdminLesson(id, patch, admin.id)
    if (!updated) return fail("NOT_FOUND", "Lesson not found.", 404)
    invalidateLessonCache()
    revalidateLessonSurfaces(updated.slug)
    if (updated.slug !== existing.slug) revalidateLessonSurfaces(existing.slug)
    return ok({ item: toAdminLessonView(updated) })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.lessons.update", error)
  }
}

/** DELETE archives by default (removes it from the founder libraries and keeps
 * the record reversible). `?hard=1` deletes the document permanently. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const existing = await getAdminLessonDoc(id)
    if (!existing) return fail("NOT_FOUND", "Lesson not found.", 404)

    if (req.nextUrl.searchParams.get("hard") === "1") {
      await deleteAdminLesson(id)
    } else {
      await setAdminLessonStatus(id, "archived", admin.id)
    }
    invalidateLessonCache()
    revalidateLessonSurfaces(existing.slug)
    return ok({ id, deleted: req.nextUrl.searchParams.get("hard") === "1" })
  } catch (error) {
    return handleRouteError("api.admin.lessons.delete", error)
  }
}
