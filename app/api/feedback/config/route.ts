import { requireUser } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { publicFeedbackConfig } from "@/lib/feedback/service"

/** GET /api/feedback/config — launcher/reporting settings for the signed-in user. */
export async function GET() {
  try {
    await requireUser()
    return ok(await publicFeedbackConfig())
  } catch (e) {
    return handleRouteError("api.feedback.config", e)
  }
}
