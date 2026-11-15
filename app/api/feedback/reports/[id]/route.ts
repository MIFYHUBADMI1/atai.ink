import { requireUser } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { getMyReport } from "@/lib/feedback/service"

/** GET /api/feedback/reports/[id] — the caller's own report detail. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    return ok(await getMyReport(user.id, id))
  } catch (e) {
    return handleRouteError("api.feedback.reports.detail", e)
  }
}
