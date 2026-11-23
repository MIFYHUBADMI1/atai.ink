import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { archiveCatalogProduct } from "@/lib/billing/catalog/authoring"

export const dynamic = "force-dynamic"

/** Archive the product identity. Versions, Dodo mappings and history remain. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const admin = await requireAdmin()
    const { productId } = await params
    const body = await req.json().catch(() => ({}))
    const result = await archiveCatalogProduct({
      productId,
      body,
      actor: { id: admin.id, email: admin.email },
    })
    return ok(result)
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.archive", error)
  }
}
