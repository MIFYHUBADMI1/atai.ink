import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogCategoryInputSchema } from "@/lib/blog/admin-schema"
import { listAdminCategories, upsertCategory } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireAdmin()
    return ok({ items: await listAdminCategories() })
  } catch (error) {
    return handleRouteError("api.admin.blog.categories.list", error)
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await readJsonBody(req, 50_000)
    const parsed = blogCategoryInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the category details.", 422)
    }
    const created = await upsertCategory(parsed.data)
    return ok({ item: created }, { status: 201 })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.categories.create", error)
  }
}