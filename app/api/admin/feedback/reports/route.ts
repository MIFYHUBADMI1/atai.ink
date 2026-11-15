import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { adminFeedbackStats, adminListReports } from "@/lib/feedback/service"
import type { FeedbackCategory, FeedbackSeverity, FeedbackStatus } from "@/lib/feedback/types"

/**
 * GET /api/admin/feedback/reports
 *   ?stats=1                       → aggregate dashboard numbers
 *   ?q=&status=&category=&severity=&route=&incidentId=&rewardStatus=&from=&to=&page=&sort=
 */
export async function GET(req: Request) {
  try {
    await requireAdmin()
    const url = new URL(req.url)
    if (url.searchParams.get("stats") === "1") {
      return ok(await adminFeedbackStats())
    }
    const num = (k: string) => {
      const v = url.searchParams.get(k)
      const n = v ? Number(v) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    const data = await adminListReports({
      q: url.searchParams.get("q") ?? undefined,
      status: (url.searchParams.get("status") ?? undefined) as FeedbackStatus | "all" | "needs_review" | undefined,
      category: (url.searchParams.get("category") ?? undefined) as FeedbackCategory | "all" | undefined,
      severity: (url.searchParams.get("severity") ?? undefined) as FeedbackSeverity | "all" | undefined,
      route: url.searchParams.get("route") ?? undefined,
      incidentId: url.searchParams.get("incidentId") ?? undefined,
      rewardStatus: (url.searchParams.get("rewardStatus") ?? undefined) as "all" | "rewarded" | "unrewarded" | undefined,
      from: num("from"),
      to: num("to"),
      page: num("page"),
      sort: (url.searchParams.get("sort") ?? undefined) as "newest" | "oldest" | "updated" | undefined,
    })
    return ok(data)
  } catch (e) {
    return handleRouteError("api.admin.feedback.reports.list", e)
  }
}
