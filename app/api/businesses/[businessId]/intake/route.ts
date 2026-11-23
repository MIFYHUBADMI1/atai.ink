import "server-only"

import { fail, failInsufficientCredits, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchorProject } from "@/lib/connected-business/anchor"
import { listProjectDomains } from "@/lib/domain/service"
import { startIntakeRun } from "@/lib/existing-business/intake"
import { buildIntakeView } from "@/lib/existing-business/view"
import { store } from "@/lib/store/store"

// The crawl and the model call run after the response; this is the budget
// that keeps them alive on a serverless platform.
export const maxDuration = 300

/**
 * Intake status + run control, addressed by business.
 *
 * The same pipeline as `/api/projects/[id]/intake`, authorised by membership
 * instead of project ownership so the business surface never has to carry the
 * anchor project id. The run still holds the single-writer claim, so a double
 * submit cannot crawl or charge twice, and the acting member pays.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "read")
    const { businessId } = await params

    const { project } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })

    const domains = await listProjectDomains(project.id)
    return ok(buildIntakeView(project, domains))
  } catch (error) {
    return handleRouteError("businesses.intake.get", error)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await params

    const { project } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })

    const body = await readJsonBody(req, 4096)
    const reassess = body.action === "reassess"

    // Await the decision, not the run: a rate limit or a run already in flight
    // must reach the founder as a sentence, not as a page that silently does
    // nothing when they press the button again.
    const result = await startIntakeRun(project.id, { userId: user.id, allowReassessment: reassess })
    if (!result.ok) {
      // The numbers travel with the refusal so the founder is shown the
      // balance, the price and the gap instead of a sentence alone.
      if (result.code === "INSUFFICIENT_CREDITS" && result.meta) {
        return failInsufficientCredits({
          required: Number(result.meta.required ?? 0),
          available: Number(result.meta.available ?? 0),
          message: result.message,
          meta: result.meta,
        })
      }
      const status =
        result.code === "RATE_LIMITED"
          ? 429
          : result.code === "INTAKE_IN_PROGRESS" || result.code === "BUSINESS_ALREADY_CONNECTED"
            ? 409
            : 422
      return fail(result.code, result.message, status, undefined, result.meta)
    }

    const domains = await listProjectDomains(project.id)
    const fresh = await store.getProject(project.id)
    if (!fresh) return fail("BUSINESS_NOT_MIGRATED", "This business has no connected site yet.", 404)
    return ok(
      { started: result.started, view: buildIntakeView(fresh, domains) },
      { status: result.started ? 202 : 200 },
    )
  } catch (error) {
    return handleRouteError("businesses.intake.post", error)
  }
}
