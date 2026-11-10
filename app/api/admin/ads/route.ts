import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { isAdRequestStatus } from "@/lib/types/ads"
import { adminRequestStats, listAdRequestsAdmin } from "@/lib/marketing/ads/lifecycle"
import { adminRequestSummary } from "@/lib/marketing/ads/views"

export async function GET(req: Request) {
  try {
    await requireAdmin()
    const url = new URL(req.url)
    if (url.searchParams.get("stats") === "1") {
      return ok({ stats: await adminRequestStats() })
    }
    const statusRaw = url.searchParams.get("status") ?? "submitted"
    const status = statusRaw === "all" || isAdRequestStatus(statusRaw) ? statusRaw : "submitted"
    const result = await listAdRequestsAdmin({
      status,
      q: url.searchParams.get("q") ?? "",
      page: Number(url.searchParams.get("page") ?? "1") || 1,
      pageSize: Number(url.searchParams.get("pageSize") ?? "25") || 25,
    })
    return ok({
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      items: result.items.map(adminRequestSummary),
    })
  } catch (e) {
    return handleRouteError("api.admin.ads.list", e)
  }
}
