import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { withAiProtection } from "@/lib/api/ai-protection"
import { checkProjectOwnership } from "@/lib/runtime/ownership"
import { isMarketStudioEnabled } from "@/lib/marketing/feature-flags"
import { capabilityAvailability } from "@/lib/runtime/router/adapters/availability"
import { readAiPlanDocuments, readOwnerGoals } from "@/lib/marketing/growth-overview"
import { readValuePropositionText } from "@/lib/analysis/plan-sections"
import { store } from "@/lib/store/store"
import {
  AD_STRATEGY_BOUNDS,
  ADS_STRATEGY_SLOT,
  getAdStrategy,
  strategyRecommendationBrief,
  upsertAdStrategy,
} from "@/lib/marketing/ads/strategy"
import { generateMarketContent } from "@/lib/marketing/studio/market-service"

/**
 * GET  /api/projects/[id]/ads/strategy — the founder's saved strategy (free).
 * PUT  /api/projects/[id]/ads/strategy — save founder-typed fields (free).
 * POST /api/projects/[id]/ads/strategy { action: "recommend" } — generate an
 *       AI recommendation draft through the studio pipeline (metered per call,
 *       stored in the content library, never merged into the strategy doc).
 */

const StrategySchema = z
  .object({
    positioning: z.string().max(AD_STRATEGY_BOUNDS.positioning).optional(),
    icp: z.string().max(AD_STRATEGY_BOUNDS.icp).optional(),
    geographies: z.string().max(AD_STRATEGY_BOUNDS.geographies).optional(),
    objectives: z.array(z.string().max(AD_STRATEGY_BOUNDS.listItem)).max(AD_STRATEGY_BOUNDS.listItems).optional(),
    channels: z.array(z.string().max(AD_STRATEGY_BOUNDS.listItem)).max(AD_STRATEGY_BOUNDS.listItems).optional(),
    budgetNote: z.string().max(AD_STRATEGY_BOUNDS.budgetNote).optional(),
    priorities: z.array(z.string().max(AD_STRATEGY_BOUNDS.listItem)).max(AD_STRATEGY_BOUNDS.listItems).optional(),
    brandVoice: z.string().max(AD_STRATEGY_BOUNDS.brandVoice).optional(),
    usps: z.string().max(AD_STRATEGY_BOUNDS.usps).optional(),
  })
  .strict()

const PostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recommend") }).strict(),
])

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const strategy = await getAdStrategy(id)
    return ok({ strategy })
  } catch (e) {
    return handleRouteError("api.projects.ads.strategy.get", e)
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    const parsed = StrategySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Check the strategy fields — something is out of bounds.", 422)

    const strategy = await upsertAdStrategy({ userId: user.id, projectId: id, strategy: parsed.data })
    return ok({ strategy })
  } catch (e) {
    return handleRouteError("api.projects.ads.strategy.put", e)
  }
}

export const POST = withAiProtection("studio", post)

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params

    await checkRateLimit({
      action: "ads_strategy_recommend",
      identifier: user.id,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    })

    const ownership = await checkProjectOwnership(user.id, id)
    if (!ownership.ok) return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)

    if (!isMarketStudioEnabled()) {
      return fail("FEATURE_DISABLED", "The AI studio isn't available right now.", 403)
    }

    if (!capabilityAvailability()["ai.text"]?.configured) {
      return fail("AI_UNAVAILABLE", "AI generation isn't configured on this deployment yet.", 503)
    }

    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Unknown action.", 422)

    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "Project not found.", 404)
    }

    const strategy = await getAdStrategy(id)
    const ownerGoals = readOwnerGoals(user)
    const marketingPlanDoc = readAiPlanDocuments(project).find((doc) => doc.id === "marketingPlan")
    const valueProp = readValuePropositionText(project.specification).trim()

    const brief = strategyRecommendationBrief({
      projectName: project.name,
      description: project.specification?.description,
      positioningFromPlan: marketingPlanDoc?.present ? marketingPlanDoc.text : valueProp,
      targetUsers: project.specification?.targetUsers,
      siteUrl:
        project.deployment?.status === "success" ? project.deployment?.productionUrl : undefined,
      ownerGoals,
      strategy: strategy
        ? {
            positioning: strategy.positioning,
            icp: strategy.icp,
            geographies: strategy.geographies,
            objectives: strategy.objectives,
            channels: strategy.channels,
            budgetNote: strategy.budgetNote,
            priorities: strategy.priorities,
            brandVoice: strategy.brandVoice,
            usps: strategy.usps,
          }
        : null,
    })

    const item = await generateMarketContent({
      userId: user.id,
      projectId: id,
      kind: "brief",
      brief,
      title: "Advertising strategy recommendations",
      kit: "ads",
      kitSlot: ADS_STRATEGY_SLOT,
    })

    return ok(item)
  } catch (e) {
    return handleRouteError("api.projects.ads.strategy.recommend", e)
  }
}
