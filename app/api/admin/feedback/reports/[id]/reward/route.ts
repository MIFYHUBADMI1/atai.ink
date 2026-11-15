import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { approveReportReward } from "@/lib/feedback/service"

/**
 * POST /api/admin/feedback/reports/[id]/reward
 * Body: { amount? | tierId?, note? }
 * Grants permanent Atai Credits through the authoritative credit ledger.
 * Idempotent per report; self-approval is rejected.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await ctx.params
    const body = await readJsonBody(req, 8 * 1024)
    const amount = typeof body.amount === "number" ? body.amount : undefined
    const result = await approveReportReward(id, admin.id, {
      ...(amount !== undefined ? { amount } : {}),
      ...(typeof body.tierId === "string" ? { tierId: body.tierId } : {}),
      ...(typeof body.note === "string" ? { note: body.note } : {}),
    })
    return ok(result, { status: 201 })
  } catch (e) {
    return handleRouteError("api.admin.feedback.reports.reward", e)
  }
}
