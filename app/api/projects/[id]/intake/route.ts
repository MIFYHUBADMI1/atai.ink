import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { businessStartingPointOf } from "@/lib/types/business-intake"
import { listProjectDomains } from "@/lib/domain/service"
import { buildIntakeView } from "@/lib/existing-business/view"
import { startIntakeRun } from "@/lib/existing-business/intake"

// The crawl and the model call run after the response; this is the budget
// that keeps them alive on a serverless platform.
export const maxDuration = 300

/**
 * Existing-business intake status + run control (Phase 1 Part G/H).
 * GET is the honest progress view the workspace polls; POST starts (or resumes)
 * the background run. The run itself holds the single-writer claim, so a
 * double-submit cannot crawl or charge twice.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    const domains = await listProjectDomains(id)
    return ok(buildIntakeView(project, domains))
  } catch (error) {
    return handleRouteError("projects.intake.get", error)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    if (businessStartingPointOf(project) !== "existing_business") {
      return fail("NOT_ELIGIBLE", "This business was not initialized as an existing business.", 422)
    }
    const body = await readJsonBody(req, 4096)
    const reassess = body.action === "reassess"

    // Await the decision, not the run: a rate limit or a run already in flight
    // must reach the founder as a sentence, not as a page that silently does
    // nothing when they press the button again.
    const result = await startIntakeRun(id, { userId: user.id, allowReassessment: reassess })
    if (!result.ok) {
      const status = result.code === "RATE_LIMITED" ? 429 : result.code === "INTAKE_IN_PROGRESS" ? 409 : 422
      return fail(result.code, result.message, status)
    }

    const domains = await listProjectDomains(id)
    const fresh = (await store.getProject(id)) ?? project
    return ok(
      { started: result.started, view: buildIntakeView(fresh, domains) },
      { status: result.started ? 202 : 200 },
    )
  } catch (error) {
    return handleRouteError("projects.intake.post", error)
  }
}
