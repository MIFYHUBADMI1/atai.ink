import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { auditAll, auditOne } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await readJsonBody(req, 10_000).catch(() => ({}) as Record<string, unknown>)
    const articleId = typeof body.articleId === "string" ? body.articleId : ""
    if (articleId) return ok({ report: await auditOne(articleId) })
    return ok({ reports: await auditAll() })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.audit", error)
  }
}