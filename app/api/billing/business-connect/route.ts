import { requireUser } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { store } from "@/lib/store/store"
import { getExistingBusinessCosts } from "@/lib/billing/runtime-config"
import { getAvailableCredits } from "@/lib/billing/credit-service"
import { assessmentEngineSurcharge, buildIntakeRecord, businessJourneyCost } from "@/lib/existing-business/intake"

/**
 * GET /api/billing/business-connect[?projectId=…]
 *
 * The price of finishing an existing business (read + first read) and what the
 * signed-in founder can pay of it. With a project it quotes only what is still
 * unpaid, so a founder who already paid for the read is never asked for it
 * twice. The wizard asks before creating anything, so a founder with an empty
 * balance is told the whole number up front instead of discovering it one
 * failed stage at a time.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser()
    const projectId = new URL(req.url).searchParams.get("projectId")

    if (projectId) {
      const project = await store.getProject(projectId)
      if (!project || project.userId !== user.id) return fail("NOT_FOUND", undefined, 404)
      return ok(await businessJourneyCost(project, project.intake ?? buildIntakeRecord({})))
    }

    const costs = await getExistingBusinessCosts()
    const available = await getAvailableCredits(user.id)
    const surcharge = await assessmentEngineSurcharge(user.id)
    const required = costs.readCost + costs.assessmentCost + surcharge.cost
    return ok({
      readCost: costs.readCost,
      assessmentCost: costs.assessmentCost,
      engineCost: surcharge.cost,
      engineName: surcharge.name,
      required,
      available,
      shortfall: Math.max(0, required - available),
    })
  } catch (e) {
    return handleRouteError("api.billing.business-connect", e)
  }
}
