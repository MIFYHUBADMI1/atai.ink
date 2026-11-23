import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { activateCatalogPublication } from "@/lib/billing/catalog/activation"

export const dynamic = "force-dynamic"

/** Explicitly activate one candidate. Customer DB reads remain gated. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ version: string }> },
) {
  try {
    const admin = await requireAdmin()
    const { version } = await params
    const body = await req.json().catch(() => ({}))
    const result = await activateCatalogPublication({
      version,
      body,
      actor: { id: admin.id, email: admin.email },
    })
    return ok(result)
  } catch (error) {
    return handleRouteError("api.admin.billing.catalog.publications.activate", error)
  }
}
