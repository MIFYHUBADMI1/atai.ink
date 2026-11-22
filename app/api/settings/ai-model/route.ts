import { z } from "zod"
import { requireUser } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { getCofounderTier, listCofounderTiers } from "@/lib/cofounder/model-catalog"
import { readCofounderModelTier, resolveCofounderModel, writeCofounderModelTier } from "@/lib/cofounder/model"

const PatchSchema = z.object({ tier: z.string().min(1).max(60) }).strict()

/**
 * GET /api/settings/ai-model — the founder's current co-founder tier pick, the
 * engine that would answer right now (env pin included), and the live catalog.
 * The catalog is here so a failure panel can offer a switch in place instead of
 * sending the founder to another page and back.
 * PATCH /api/settings/ai-model — switch engines (the named modes from the
 * admin-managed catalog). The choice applies on the very next co-founder
 * message and the very next intake read; nothing is retroactive.
 */
export async function GET() {
  try {
    const user = await requireUser()
    // `current` comes from the same resolver the co-founder and the intake read
    // use, so this screen can never claim an engine that is not the one running.
    const [stored, resolved, tiers] = await Promise.all([
      readCofounderModelTier(user.id),
      resolveCofounderModel(user.id),
      listCofounderTiers(),
    ])
    return ok({
      tier: stored ?? null,
      current: {
        tierId: resolved.tier.id,
        tierName: resolved.tier.name,
        modelId: resolved.modelId,
      },
      tiers,
    })
  } catch (e) {
    return handleRouteError("api.settings.ai-model.get", e)
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser()
    const body = PatchSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      return fail("VALIDATION", "Pick one of the available co-founder engines.", 422)
    }
    // Validate against the LIVE admin-managed catalog, not the built-in list.
    const tier = await getCofounderTier(body.data.tier)
    if (!tier) {
      return fail("VALIDATION", "Pick one of the available co-founder engines.", 422)
    }
    await writeCofounderModelTier(user.id, tier.id)
    return ok({ tier: tier.id, name: tier.name, creditsPerMessage: tier.creditsPerMessage })
  } catch (e) {
    return handleRouteError("api.settings.ai-model.patch", e)
  }
}
