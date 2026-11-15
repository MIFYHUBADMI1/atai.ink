import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { duplicateArticle, toAdminView } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const copy = await duplicateArticle(id, admin.id)
    return ok({ item: toAdminView(copy) }, { status: 201 })
  } catch (error) {
    return handleRouteError("api.admin.blog.duplicate", error)
  }
}