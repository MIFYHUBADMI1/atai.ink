import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { createIncident, listIncidents } from "@/lib/feedback/service"
import { isFeedbackSeverity } from "@/lib/feedback/config"
import type { FeedbackSeverity } from "@/lib/feedback/types"

/** GET /api/admin/feedback/incidents?status= */
export async function GET(req: Request) {
  try {
    await requireAdmin()
    const status = new URL(req.url).searchParams.get("status") ?? undefined
    return ok(await listIncidents(status))
  } catch (e) {
    return handleRouteError("api.admin.feedback.incidents.list", e)
  }
}

/** POST /api/admin/feedback/incidents — group related reports into an incident. */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 32 * 1024)
    const severity = typeof body.severity === "string" ? body.severity : ""
    if (!isFeedbackSeverity(severity)) {
      return handleRouteError("api.admin.feedback.incidents.create", new (await import("@/lib/errors")).AppError("VALIDATION", "Choose a severity.", 400))
    }
    const incident = await createIncident(admin.id, {
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : undefined,
      severity: severity as FeedbackSeverity,
      reportIds: Array.isArray(body.reportIds) ? body.reportIds.filter((x): x is string => typeof x === "string") : undefined,
    })
    return ok(incident, { status: 201 })
  } catch (e) {
    return handleRouteError("api.admin.feedback.incidents.create", e)
  }
}
