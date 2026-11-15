import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { adminGetReport, adminPatchReport } from "@/lib/feedback/service"

/** GET /api/admin/feedback/reports/[id] — full report detail incl. diagnostics, audit, rewards. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await ctx.params
    return ok(await adminGetReport(id))
  } catch (e) {
    return handleRouteError("api.admin.feedback.reports.detail", e)
  }
}

/**
 * PATCH /api/admin/feedback/reports/[id]
 * Body: { status?, severity?, assigneeId?, incidentId?, internalNote?, publicResponse?, reason? }
 * Every mutation is authorised server-side and written to the audit trail.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await ctx.params
    const body = await readJsonBody(req, 16 * 1024)
    const result = await adminPatchReport(id, admin.id, {
      status: typeof body.status === "string" ? body.status : undefined,
      severity: typeof body.severity === "string" ? body.severity : undefined,
      assigneeId: body.assigneeId === null ? null : typeof body.assigneeId === "string" ? body.assigneeId : undefined,
      incidentId: body.incidentId === null ? null : typeof body.incidentId === "string" ? body.incidentId : undefined,
      internalNote: typeof body.internalNote === "string" ? body.internalNote : undefined,
      publicResponse: typeof body.publicResponse === "string" ? body.publicResponse : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    })
    return ok(result)
  } catch (e) {
    return handleRouteError("api.admin.feedback.reports.patch", e)
  }
}
