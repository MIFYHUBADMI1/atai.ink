import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { deleteRedirect } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    await deleteRedirect(id)
    return ok({ deleted: id })
  } catch (error) {
    return handleRouteError("api.admin.blog.redirects.delete", error)
  }
}