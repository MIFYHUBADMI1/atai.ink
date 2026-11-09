import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { lessonInputSchema } from "@/lib/lessons/admin-schema"
import { revalidateLessonSurfaces } from "@/lib/lessons/revalidate"
import {
  createAdminLesson,
  invalidateLessonCache,
  listAdminLessonDocs,
  toAdminLessonView,
} from "@/lib/lessons/store"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireAdmin()
    const items = await listAdminLessonDocs()
    return ok({
      items,
      stats: {
        total: items.length,
        published: items.filter((item) => item.status === "published").length,
        drafts: items.filter((item) => item.status === "draft").length,
        archived: items.filter((item) => item.status === "archived").length,
        featured: items.filter((item) => item.featured && item.status === "published").length,
        files: items.filter((item) => item.file).length,
        videos: items.filter((item) => item.youtubeUrl).length,
      },
    })
  } catch (error) {
    return handleRouteError("api.admin.lessons.list", error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 512_000)
    const parsed = lessonInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the lesson details.", 422)
    }
    const created = await createAdminLesson(parsed.data, admin.id)
    invalidateLessonCache()
    revalidateLessonSurfaces(created.slug)
    return ok({ item: toAdminLessonView(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.lessons.create", error)
  }
}
