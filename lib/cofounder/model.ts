import "server-only"
import type { LanguageModel } from "ai"
import { usersCol } from "@/lib/db/collections"
import { logger } from "@/lib/logging/logger"
import { openRouterChatModel } from "@/lib/analysis/model"
import { COFOUNDER_MODEL_TIERS, type CofounderModelTier } from "./models"
import { getCofounderTier, listCofounderTiers } from "./model-catalog"

/**
 * Per-user co-founder model resolution (the /settings/ai tier picker).
 *
 * The founder's choice is stored on the user doc (`cofounderModelTier`) and
 * read fresh on every turn — same fail-soft discipline as feature
 * preferences: a storage hiccup falls back to the default tier, never throws
 * inside an agent turn. The tier CATALOG itself is admin-managed
 * (model-catalog.ts); this file only resolves which engine a given founder
 * gets.
 */

export interface ResolvedCofounderModel {
  tier: CofounderModelTier
  modelId: string
  model: LanguageModel
}

/** Read the founder's stored tier id. Fail-soft → undefined (caller defaults). */
export async function readCofounderModelTier(userId: string): Promise<string | undefined> {
  try {
    const col = await usersCol()
    const doc = await col.findOne({ id: userId }, { projection: { cofounderModelTier: 1 } })
    const tier = doc?.cofounderModelTier
    return typeof tier === "string" ? tier : undefined
  } catch (e) {
    logger.warn("cofounder.model", "Failed to read model tier; using default", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    })
    return undefined
  }
}

/** Persist the founder's tier pick. Throws on unknown ids or a missing user —
 * the API route validates against the live catalog before calling, so a throw
 * here is a real bug. */
export async function writeCofounderModelTier(userId: string, tierId: string): Promise<CofounderModelTier> {
  const tier = await getCofounderTier(tierId)
  if (!tier) {
    throw new Error(`Unknown co-founder model tier: ${tierId}`)
  }
  const col = await usersCol()
  const result = await col.updateOne(
    { id: userId },
    { $set: { cofounderModelTier: tierId, updatedAt: Date.now() } },
  )
  if (result.matchedCount === 0) {
    throw new Error(`Model tier write matched no user for ${userId}`)
  }
  logger.info("cofounder.model", "Founder switched co-founder model tier", { userId, tierId })
  return tier
}

/** Resolve the model handle for one agent turn. Env override
 * COFOUNDER_MODEL_TIER lets the operator force a tier deployment-wide;
 * otherwise the founder's stored pick wins, then the first catalog tier. A
 * stored id that no longer exists in the catalog (deleted/disabled) falls
 * back to the default the same way. */
export async function resolveCofounderModel(userId: string): Promise<ResolvedCofounderModel> {
  const tiers = await listCofounderTiers()
  const fallback = tiers[0] ?? COFOUNDER_MODEL_TIERS[0]
  const envTier = process.env.COFOUNDER_MODEL_TIER
  const storedId = envTier || (await readCofounderModelTier(userId))
  const tier = (storedId && tiers.find((t) => t.id === storedId)) || fallback
  return { tier, modelId: tier.modelId, model: openRouterChatModel(tier.modelId) }
}

/** Catalog for API/UI serialization. */
export async function listCofounderModelTiers(): Promise<readonly CofounderModelTier[]> {
  return listCofounderTiers()
}

export { COFOUNDER_MODEL_TIERS as DEFAULT_COFUNDER_MODEL_TIERS }
