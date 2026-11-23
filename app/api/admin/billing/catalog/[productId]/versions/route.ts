import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { createCatalogVersion } from "@/lib/billing/catalog/authoring"

export const dynamic = "force-dynamic"

/** Start a new draft version from the product's current published version. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const admin = await requireAdmin()
    const { productId } = await params
    const body = await req.json().catch(() => ({}))
    const result = await createCatalogVersion({
      productId,
      body,
      actor: { id: admin.id, email: admin.email },
    })
    return ok(result, { status: 201 })
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.version.create", error)
  }
}
