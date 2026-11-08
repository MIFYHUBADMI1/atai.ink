import { requireUser } from "@/lib/auth/session"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { store } from "@/lib/store/store"
import { AppError } from "@/lib/errors"
import { withAiProtection } from "@/lib/api/ai-protection"
import { readOwnerGoals } from "@/lib/marketing/growth-overview"
import { generateCompetitionSnapshot } from "@/lib/marketing/competition-snapshot"

/**
 * POST /api/projects/[id]/market/competition-snapshot
 *
 * One-click competitor-landscape DRAFT, written strictly from the project's
 * plan. No request body. The response is the usual JSON envelope with the
 * draft item. Atai does not collect live market or competitor data; the draft
 * is planning context and is labelled as such everywhere it is shown.
 */
export const POST = withAiProtection("studio", post)

async function post(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params

    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    if (!isMarketStudioEnabled()) {
      return fail("FEATURE_DISABLED", "The AI content studio isn't available right now.", 403)
    }

    if (!Boolean(capabilityAvailability()["ai.text"]?.configured)) {
      return fail("AI_UNAVAILABLE", "Text generation isn't configured on this deployment yet.", 503)
    }

    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "Project not found.", 404)
    }
    if (!project.specification) {
      return fail("VALIDATION", "The competitor snapshot drafts from your plan — this project has no plan yet.", 409)
    }

    const item = await generateCompetitionSnapshot({
      userId: user.id,
      projectId: id,
      project,
      ownerGoals: readOwnerGoals(user),
    })
    return ok({
      id: item.id,
      title: item.title,
      body: item.body,
      creditsCharged: item.creditsCharged,
      createdAt: item.createdAt,
    })
  } catch (e) {
    if (e instanceof AppError && e.code === "VALIDATION") {
      return fail("VALIDATION", e.message, 409)
    }
    return handleRouteError("api.projects.market.competitionSnapshot", e)
  }
}
