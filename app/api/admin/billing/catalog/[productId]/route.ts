import { requireAdmin } from "@/lib/auth/session"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { getCatalogProduct } from "@/lib/billing/catalog/service"
import { updateCatalogProduct } from "@/lib/billing/catalog/authoring"

export const dynamic = "force-dynamic"

/** Product detail. Mutations use the explicit authoring routes. */
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

/** Edit a product by creating a replacement draft version. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const admin = await requireAdmin()
    const { productId } = await params
    const body = await req.json().catch(() => ({}))
    const result = await updateCatalogProduct({
      productId,
      body,
      actor: { id: admin.id, email: admin.email },
    })
    return ok(result)
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.update", error)
  }
}
