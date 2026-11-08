import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { resourceInputSchema } from "@/lib/resources/admin-schema"
import { slugifyResource } from "@/lib/resources/media"
import { revalidateResourceSurfaces } from "@/lib/resources/revalidate"
import {
  createAdminResource,
  invalidateResourceCache,
  listAdminLibrary,
  toAdminView,
} from "@/lib/resources/store"
import type { AdminResourceInput } from "@/lib/resources/admin-types"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireAdmin()
    const items = await listAdminLibrary()
    return ok({
      items,
      stats: {
        total: items.length,
        published: items.filter((item) => item.status === "published").length,
        drafts: items.filter((item) => item.status === "draft").length,
        archived: items.filter((item) => item.status === "archived").length,
        featured: items.filter((item) => item.featured && item.status === "published").length,
        downloads: items.filter((item) => item.file).length,
        videos: items.filter((item) => item.youtubeUrl).length,
      },
    })
  } catch (error) {
    return handleRouteError("api.admin.resources.list", error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 512_000)
    const parsed = resourceInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the resource details.", 422)
    }
    const input: AdminResourceInput = {
      ...parsed.data,
      slug: parsed.data.slug || slugifyResource(parsed.data.title),
    }
    if (!input.slug) throw new AppError("VALIDATION", "Add a URL slug for this resource.", 422)
    const created = await createAdminResource(input, admin.id)
    invalidateResourceCache()
    revalidateResourceSurfaces(created)
    return ok({ item: toAdminView(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.resources.create", error)
  }
}
