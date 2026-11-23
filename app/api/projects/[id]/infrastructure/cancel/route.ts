import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { cancelInfrastructurePlan } from "@/lib/infrastructure/service"

/**
 * POST /api/projects/:id/infrastructure/cancel
 * Stop future renewal. Paid-through access remains until the stored expiry.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const result = await cancelInfrastructurePlan(id, user.id)
    if (!result.success) return fail("CANCEL_FAILED", result.message, 400)
    return ok({ message: result.message })
  } catch (e) {
    return handleRouteError("api.projects.infrastructure.cancel", e)
  }
}
