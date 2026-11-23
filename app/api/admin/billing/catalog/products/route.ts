import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { createCatalogProduct } from "@/lib/billing/catalog/authoring"

export const dynamic = "force-dynamic"

/** Create a stable product identity with its initial draft version. */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const result = await createCatalogProduct({
      body,
      actor: { id: admin.id, email: admin.email },
    })
    return ok(result, { status: 201 })
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.create", error)
  }
}
