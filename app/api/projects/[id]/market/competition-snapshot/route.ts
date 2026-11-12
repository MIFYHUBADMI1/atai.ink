import { requireUser } from "@/lib/auth/session"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { isFirecrawlConfigured } from "@/lib/integrations/firecrawl/client"
import { store } from "@/lib/store/store"
import { AppError } from "@/lib/errors"
import { withAiProtection } from "@/lib/api/ai-protection"
import { readOwnerGoals } from "@/lib/marketing/growth-overview"
import { generateCompetitionSnapshot } from "@/lib/marketing/competition-snapshot"

/**
 * POST /api/projects/[id]/market/competition-snapshot
 *
 * One live-researched competitor snapshot. The run charges fixed research
 * credits (refunded if the run fails), derives search queries from the
 * founder's plan, searches the live web (web pages, news, the research
 * category, and Alexandria data-tool sources), and writes the analysis
 * grounded in those sources. Every source is returned with the snapshot so
 * the founder can verify each claim against its reference. No request body.
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

    if (!isFirecrawlConfigured()) {
      return fail(
        "AI_UNAVAILABLE",
        "Live web research isn't configured on this deployment yet — the snapshot needs it to search the live web.",
        503,
      )
    }

    if (!Boolean(capabilityAvailability()["ai.text"]?.configured)) {
      return fail("AI_UNAVAILABLE", "Text generation isn't configured on this deployment yet.", 503)
    }

    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "Project not found.", 404)
    }
    if (!project.specification) {
      return fail("VALIDATION", "The competitor snapshot builds on your plan — this project has no plan yet.", 409)
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
      contextHash: item.kitInput?.contextHash,
      ...(item.research ? { research: item.research } : {}),
    })
  } catch (e) {
    if (e instanceof AppError && e.code === "VALIDATION") {
      return fail("VALIDATION", e.message, 409)
    }
    return handleRouteError("api.projects.market.competitionSnapshot", e)
  }
}
