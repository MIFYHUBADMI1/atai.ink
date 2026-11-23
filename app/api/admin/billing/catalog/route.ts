import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { listCatalogProducts } from "@/lib/billing/catalog/service"

export const dynamic = "force-dynamic"

/** Read-only A7.0 catalog list. Authoring is intentionally not exposed yet. */
export async function GET() {
  try {
    await requireAdmin()
    return ok({ products: await listCatalogProducts() })
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.list", error)
  }
}
