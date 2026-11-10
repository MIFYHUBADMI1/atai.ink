import { requireUser } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { listAdRequestsForUser } from "@/lib/marketing/ads/requests"

/**
 * GET /api/me/ads/requests — the founder's recent advertising requests across
 * their projects. Feeds the DERIVED notification inbox (no push collection):
 * each status change shows up here and the inbox renders it from live state.
 */
export async function GET() {
  try {
    const user = await requireUser()
    const requests = await listAdRequestsForUser(user.id, { limit: 20 })
    return ok({
      requests: requests.map((request) => ({
        id: request.id,
        projectId: request.projectId,
        projectName: request.business.name,
        status: request.status,
        updatedAt: request.updatedAt,
      })),
    })
  } catch (e) {
    return handleRouteError("api.me.ads.requests", e)
  }
}
