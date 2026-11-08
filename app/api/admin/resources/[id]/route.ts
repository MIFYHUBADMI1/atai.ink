import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { resourceInputSchema } from "@/lib/resources/admin-schema"
import { slugifyResource } from "@/lib/resources/media"
import { revalidateResourceSurfaces } from "@/lib/resources/revalidate"
import {
  deleteAdminResource,
  getAdminResourceDoc,
  invalidateResourceCache,
  setAdminResourceStatus,
  toAdminView,
  updateAdminResource,
} from "@/lib/resources/store"
import type { AdminResourceInput } from "@/lib/resources/admin-types"

export const dynamic = "force-dynamic"

const patchSchema = resourceInputSchema.partial()

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const existing = await getAdminResourceDoc(id)
    if (!existing) return fail("NOT_FOUND", "Resource not found.", 404)

    const body = await readJsonBody(req, 512_000)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the resource details.", 422)
    }
    const patch: Partial<AdminResourceInput> = { ...parsed.data }
    if (parsed.data.slug !== undefined) patch.slug = parsed.data.slug || slugifyResource(parsed.data.title ?? existing.title)
    if (patch.slug === "") throw new AppError("VALIDATION", "Add a URL slug for this resource.", 422)

    const updated = await updateAdminResource(id, patch, admin.id)
    if (!updated) return fail("NOT_FOUND", "Resource not found.", 404)
    invalidateResourceCache()
    revalidateResourceSurfaces(updated)
    if (updated.category !== existing.category || updated.slug !== existing.slug) {
      revalidateResourceSurfaces(existing)
    }
    return ok({ item: toAdminView(updated) })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.resources.update", error)
  }
}

/** DELETE archives by default (removes it from the public library and keeps the
 * record reversible). `?hard=1` deletes the document permanently. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const existing = await getAdminResourceDoc(id)
    if (!existing) return fail("NOT_FOUND", "Resource not found.", 404)

    if (req.nextUrl.searchParams.get("hard") === "1") {
      await deleteAdminResource(id)
    } else {
      await setAdminResourceStatus(id, "archived", admin.id)
    }
    invalidateResourceCache()
    revalidateResourceSurfaces(existing)
    return ok({ id, deleted: req.nextUrl.searchParams.get("hard") === "1" })
  } catch (error) {
    return handleRouteError("api.admin.resources.delete", error)
  }
}
