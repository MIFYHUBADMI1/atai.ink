import { NextRequest } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { listLessonCategories, updateLessonCategory } from "@/lib/lessons/taxonomy-store"

export const dynamic = "force-dynamic"

const PatchSchema = z.object({
  id: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().min(10).max(300).optional(),
  order: z.number().int().min(0).max(10_000).optional(),
  hidden: z.boolean().optional(),
})

export async function GET() {
  try {
    await requireAdmin()
    return ok({ items: await listLessonCategories() })
  } catch (error) {
    return handleRouteError("api.admin.lesson_categories.list", error)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const parsed = PatchSchema.safeParse(await readJsonBody(req, 4096))
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the category details.", 422)
    }
    const { id, ...patch } = parsed.data
    const updated = await updateLessonCategory(id, patch, admin.id)
    if (!updated) return fail("NOT_FOUND", "Category not found.", 404)
    return ok({ item: updated })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.lesson_categories.update", error)
  }
}
