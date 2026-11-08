import { NextRequest } from "next/server"
import { handleRouteError, ok } from "@/lib/api/respond"
import { publicSummaries } from "@/lib/resources/store"

export const dynamic = "force-dynamic"

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400"

/** GET /api/public/resources — published library summaries for client surfaces
 * (docs bridge, future search). Full article text stays on its own page. */
export async function GET(_req: NextRequest) {
  try {
    const items = await publicSummaries()
    return ok(
      {
        items,
        updatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    )
  } catch (error) {
    return handleRouteError("api.public.resources", error)
  }
}
