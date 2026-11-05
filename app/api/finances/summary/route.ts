import type { NextRequest } from "next/server"
import { ok, handleRouteError } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { getPortfolioOverview, resolvePortfolioRange } from "@/lib/finances/platform-finances"

/**
 * Portfolio overview for the home dashboard (server-authoritative): one
 * bounded aggregation across all of the signed-in user's owned projects over
 * the requested window plus the equal-length window before it. The browser
 * renders these numbers; it never computes a total, a delta or a bucket.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser()
    const days = resolvePortfolioRange(request.nextUrl.searchParams.get("days"))
    return ok(await getPortfolioOverview(user.id, days))
  } catch (e) {
    return handleRouteError("api.finances.summary", e)
  }
}
