import "server-only"

import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchor } from "@/lib/connected-business/anchor"
import { startIntakeRun } from "@/lib/existing-business/intake"

/**
 * POST /api/businesses/[businessId]/read — read the connected site again.
 *
 * This is the existing intake pipeline, reached through a business-addressed
 * route so the founder's browser never sees the anchor project id. The pipeline
 * still owns access, eligibility, rate limiting, the single-writer claim and
 * the credit charge; this route only translates.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")

    const { businessId } = await params
    const anchor = await resolveBusinessAnchor({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })

    const result = await startIntakeRun(anchor.projectId, { userId: user.id, allowReassessment: true })
    if (!result.ok) {
      const status = result.code === "INSUFFICIENT_CREDITS" ? 402 : 409
      return fail(result.code, result.message, status, undefined, result.meta)
    }

    return ok({ started: result.started, status: result.status })
  } catch (error) {
    return handleRouteError("api.businesses.read.post", error)
  }
}
