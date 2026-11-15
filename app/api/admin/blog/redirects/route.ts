import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogRedirectInputSchema } from "@/lib/blog/admin-schema"
import { listRedirects, upsertRedirect } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireAdmin()
    return ok({ items: await listRedirects() })
  } catch (error) {
    return handleRouteError("api.admin.blog.redirects.list", error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 50_000)
    const parsed = blogRedirectInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the redirect details.", 422)
    }
    const created = await upsertRedirect(parsed.data.from, parsed.data.toSlug, admin.id, parsed.data.reason)
    return ok({ item: created }, { status: 201 })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.redirects.create", error)
  }
}