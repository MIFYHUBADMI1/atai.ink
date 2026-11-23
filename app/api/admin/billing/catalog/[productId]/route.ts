import { requireAdmin } from "@/lib/auth/session"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { getCatalogProduct } from "@/lib/billing/catalog/service"

export const dynamic = "force-dynamic"

/** Read-only A7.0 product detail. No create/edit/publish/archive verbs. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    await requireAdmin()
    const { productId } = await params
    const product = await getCatalogProduct(productId)
    if (!product) return fail("NOT_FOUND", "Catalog product not found.", 404)
    return ok({ product })
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.detail", error)
  }
}
