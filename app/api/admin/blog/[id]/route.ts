import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogArticleInputSchema } from "@/lib/blog/admin-schema"
import { deleteArticle, getAdminArticle, toAdminView, updateArticle } from "@/lib/blog/store"
import type { BlogArticleInput } from "@/lib/blog/types"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    const article = await getAdminArticle(id)
    if (!article) return fail("NOT_FOUND", "Article not found.", 404)
    return ok({ item: toAdminView(article) })
  } catch (error) {
    return handleRouteError("api.admin.blog.get", error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await readJsonBody(req, 1_000_000)
    const parsed = blogArticleInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the article details.", 422)
    }
    const updated = await updateArticle(id, parsed.data as BlogArticleInput, admin.id)
    return ok({ item: toAdminView(updated) })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.update", error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    await deleteArticle(id)
    return ok({ deleted: id })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.delete", error)
  }
}