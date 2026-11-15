import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { listRevisions, restoreRevision, toAdminView } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    return ok({ items: await listRevisions(id) })
  } catch (error) {
    return handleRouteError("api.admin.blog.revisions.list", error)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await readJsonBody(req, 10_000)
    const revisionId = typeof body.revisionId === "string" ? body.revisionId : ""
    if (!revisionId) throw new AppError("VALIDATION", "Pick a revision to restore.", 422)
    const restored = await restoreRevision(id, revisionId, admin.id)
    return ok({ item: toAdminView(restored) })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.revisions.restore", error)
  }
}