import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { adminUpdateSettings, getFeedbackSettings } from "@/lib/feedback/service"
import type { FeedbackSettingsDoc } from "@/lib/feedback/types"

/** GET /api/admin/feedback/settings */
export async function GET() {
  try {
    await requireAdmin()
    return ok(await getFeedbackSettings())
  } catch (e) {
    return handleRouteError("api.admin.feedback.settings.get", e)
  }
}

/** PATCH /api/admin/feedback/settings — launcher, reporting, and reward config. */
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 32 * 1024)
    const settings = await adminUpdateSettings(admin.id, body as Partial<FeedbackSettingsDoc>)
    return ok(settings)
  } catch (e) {
    return handleRouteError("api.admin.feedback.settings.patch", e)
  }
}
