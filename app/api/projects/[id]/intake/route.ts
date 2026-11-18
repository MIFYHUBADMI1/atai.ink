import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { businessStartingPointOf } from "@/lib/types/business-intake"
import { listProjectDomains } from "@/lib/domain/service"
import { buildIntakeView } from "@/lib/existing-business/view"
import { intakeProgress, runBusinessIntake } from "@/lib/existing-business/intake"

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

    if (!reassess && intakeProgress(project.intake).status === "completed") {
      const domains = await listProjectDomains(id)
      return ok({ started: false, view: buildIntakeView(project, domains) })
    }

    // Fire-and-forget in the house style: the client polls GET for progress.
    void runBusinessIntake(id, { userId: user.id, allowReassessment: reassess })
    const domains = await listProjectDomains(id)
    return ok({ started: true, view: buildIntakeView(project, domains) }, { status: 202 })
  } catch (error) {
    return handleRouteError("projects.intake.post", error)
  }
}
