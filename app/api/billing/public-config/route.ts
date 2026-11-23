import { ok, handleRouteError } from "@/lib/api/respond"
import { getPublicBillingConfig } from "@/lib/billing/public-config"

/** Public billing values used by marketing and help pages. No user data. */
export async function GET() {
  try {
    return ok(await getPublicBillingConfig(), {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    })
  } catch (e) {
    return handleRouteError("api.billing.public-config", e)
  }
}
