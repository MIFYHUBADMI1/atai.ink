import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { previewCatalogPublication } from "@/lib/billing/catalog/publication-preview"
import { mongoCatalogSeedStore } from "@/lib/billing/catalog/seed"

export const dynamic = "force-dynamic"

/** Read-only candidate preview. It never activates or mutates a publication. */
export async function GET(req: Request) {
  try {
    await requireAdmin()
    const version = new URL(req.url).searchParams.get("version") ?? undefined
    const store = await mongoCatalogSeedStore()
    const preview = await previewCatalogPublication({ store, version })
    return ok(preview)
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.publications.preview", error)
  }
}
