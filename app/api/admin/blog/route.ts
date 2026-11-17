import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogArticleInputSchema } from "@/lib/blog/admin-schema"
import { blogStats, createArticle, listAdminArticles, toAdminView } from "@/lib/blog/store"
import { BLOG_STATUSES, type BlogArticleInput, type BlogStatus } from "@/lib/blog/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const params = req.nextUrl.searchParams
    const statusParam = params.get("status")
    const status = BLOG_STATUSES.includes(statusParam as BlogStatus) ? (statusParam as BlogStatus) : undefined
    const items = await listAdminArticles({
      status,
      category: params.get("category") || undefined,
      author: params.get("author") || undefined,
      query: params.get("q") || undefined,
    })
    return ok({ items, stats: await blogStats() })
  } catch (error) {
    return handleRouteError("api.admin.blog.list", error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 1_000_000)
    const parsed = blogArticleInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the article details.", 422)
    }
    const created = await createArticle(parsed.data as BlogArticleInput, admin.id)
    return ok({ item: toAdminView(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.create", error)
  }
}