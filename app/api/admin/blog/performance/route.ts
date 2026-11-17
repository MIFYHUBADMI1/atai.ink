import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { handleRouteError, ok } from "@/lib/api/respond"
import { blogPerformance } from "@/lib/blog/store"
import { bingWebmasterStatus, fetchSearchPerformance } from "@/lib/blog/search-console"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "30")
    const days = Number.isFinite(daysParam) ? Math.min(365, Math.max(1, Math.round(daysParam))) : 30
    // First-party views and search-console metrics are independent sources.
    // Each reports its own availability — neither is ever shown as zero when
    // it is actually missing.
    const [performance, search, bing] = await Promise.all([
      blogPerformance(days),
      fetchSearchPerformance({ days }),
      bingWebmasterStatus(),
    ])
    return ok({ ...performance, search, bing })
  } catch (error) {
    return handleRouteError("api.admin.blog.performance", error)
  }
}