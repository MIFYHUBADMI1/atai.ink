import { getCurrentUser } from "@/lib/auth/session"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { resolvePublicCommercialCatalog } from "@/lib/billing/catalog/published-resolver"
import { adviseUpgrade, parseRequiredCredits } from "@/lib/billing/upgrade-options"
import { fail, handleRouteError, ok } from "@/lib/api/respond"

/**
 * What should this founder buy, given what the interrupted action costs?
 *
 * Read-only and priced from the same catalog as /pricing. Kept server-side so
 * the credit-gate overlay never bundles billing config.
 */
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return fail("UNAUTHORIZED", "Sign in to see your credit options.", 401)

    const required = parseRequiredCredits(new URL(req.url).searchParams.get("required"))
    const [available, catalog] = await Promise.all([
      getAvailableCredits(user.id),
      resolvePublicCommercialCatalog(),
    ])

    return ok(
      adviseUpgrade({
        required,
        available,
        plans: catalog.plans,
        packs: catalog.packs,
      }),
    )
  } catch (e) {
    return handleRouteError("api.billing.upgrade-options", e)
  }
}
