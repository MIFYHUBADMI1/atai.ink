import { requireUser } from "@/lib/auth/session"
import { fail, failInsufficientCredits, handleRouteError, ok } from "@/lib/api/respond"
import { sendProjectFollowup } from "@/lib/projects/project-actions"
import { logger } from "@/lib/logging/logger"

/**
 * POST /api/projects/[id]/agent — follow-up edit instruction to the builder.
 * Thin REST wrapper over the shared sendProjectFollowup service (rate limit,
 * guards, guideline-wrapped prompt, credits); the Co-founder's
 * request_followup_edit tool executes the same implementation.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params

    const body = (await req.json().catch(() => ({}))) as { prompt?: string }
    const prompt = (body.prompt ?? "").trim()
    if (prompt.length < 2) return fail("VALIDATION", "Please describe the change you want.", 422)

    const result = await sendProjectFollowup(user.id, id, prompt)
    if (!result.ok) {
      logger.warn("api.projects.agent", "follow-up rejected", {
        projectId: id,
        code: result.code,
        status: result.status,
        message: result.message,
      })
      if (result.code === "INSUFFICIENT_CREDITS") {
        return failInsufficientCredits({
          required: result.required ?? 0,
          available: result.available ?? 0,
          message: result.message,
        })
      }
      return fail(result.code, result.message ?? "The edit couldn't be started.", result.status)
    }

    return ok({
      buildRunId: result.buildRunId,
      state: "building",
      creditsCharged: result.creditsCharged,
      tier: result.tier,
    })
  } catch (e) {
    return handleRouteError("api.projects.agent", e)
  }
}
