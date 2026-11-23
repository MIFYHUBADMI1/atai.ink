import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { publishCatalogProduct } from "@/lib/billing/catalog/authoring"

export const dynamic = "force-dynamic"

/** Publish the product's single draft. This never activates customer DB reads. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const admin = await requireAdmin()
    const { productId } = await params
    const body = await req.json().catch(() => ({}))
    const result = await publishCatalogProduct({
      productId,
      body,
      actor: { id: admin.id, email: admin.email },
    })
    return ok(result)
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.publish", error)
  }
}
