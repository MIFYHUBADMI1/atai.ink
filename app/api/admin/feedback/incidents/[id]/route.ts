import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { patchIncident } from "@/lib/feedback/service"

/** PATCH /api/admin/feedback/incidents/[id] — status, severity, membership, resolution. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await ctx.params
    const body = await readJsonBody(req, 32 * 1024)
    const result = await patchIncident(id, admin.id, {
      status: typeof body.status === "string" ? body.status : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      severity: typeof body.severity === "string" ? body.severity : undefined,
      resolution: typeof body.resolution === "string" ? body.resolution : undefined,
      assigneeId: typeof body.assigneeId === "string" ? body.assigneeId : undefined,
      reportIds: Array.isArray(body.reportIds) ? body.reportIds.filter((x): x is string => typeof x === "string") : undefined,
    })
    return ok(result)
  } catch (e) {
    return handleRouteError("api.admin.feedback.incidents.patch", e)
  }
}
