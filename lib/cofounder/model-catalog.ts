import "server-only"

/**
 * Admin-managed AI co-founder engine catalog.
 *
 * The tiers founders see in /settings/ai live in the `cofounder_model_tiers`
 * collection — the admin edits names, descriptions, model ids and credit
 * costs from /admin/cofounder-models and the change is live on the next
 * co-founder message. The built-in COFOUNDER_MODEL_TIERS in ./models is only
 * the seed/fallback: an empty collection is populated from it once, and any
 * storage failure falls back to it so the agent never loses its model.
 */

import { cofounderModelTiersCol } from "@/lib/db/collections"
import { logger } from "@/lib/logging/logger"
import {
  COFOUNDER_MODEL_TIERS,
  type CofounderModelTier,
  type CofounderModelTierDoc,
} from "./models"

function toPublic(tier: CofounderModelTier): CofounderModelTier {
  return {
    id: tier.id,
    name: tier.name,
    strength: tier.strength,
    modelId: tier.modelId,
    creditsPerMessage: tier.creditsPerMessage,
  }
}

let seeded = false

/** All enabled tiers in display order. Seeds the collection from the built-in
 * catalog on first use. Fail-soft: any DB error returns the built-in catalog
 * so the agent and settings page keep working. */
export async function listCofounderTiers(): Promise<CofounderModelTier[]> {
  try {
    const col = await cofounderModelTiersCol()
    if (!seeded) {
      seeded = true
      const count = await col.countDocuments()
      if (count === 0) {
        const now = Date.now()
        await col.insertMany(
          COFOUNDER_MODEL_TIERS.map((t, i) => ({
            ...t,
            position: i,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          })),
        )
        logger.info("cofounder.catalog", "seeded default model tiers", { count: COFOUNDER_MODEL_TIERS.length })
      }
    }
    const docs = await col.find({ enabled: true }).sort({ position: 1, createdAt: 1 }).toArray()
    if (docs.length === 0) return COFOUNDER_MODEL_TIERS.map(toPublic)
    return docs.map(toPublic)
  } catch (e) {
    logger.warn("cofounder.catalog", "tier catalog read failed; using built-in defaults", {
      error: e instanceof Error ? e.message : String(e),
    })
    return COFOUNDER_MODEL_TIERS.map(toPublic)
  }
}

export async function getCofounderTier(id: string): Promise<CofounderModelTier | undefined> {
  const tiers = await listCofounderTiers()
  return tiers.find((t) => t.id === id)
}

export interface TierInput {
  name: string
  strength: string
  modelId: string
  creditsPerMessage: number
}

function validateTierInput(input: TierInput): TierInput {
  const name = input.name.trim()
  const strength = input.strength.trim()
  const modelId = input.modelId.trim()
  const credits = Math.max(0, Math.round(input.creditsPerMessage))
  if (!name || name.length > 60) throw new Error("Tier name must be 1–60 characters.")
  if (!strength || strength.length > 300) throw new Error("Strength description must be 1–300 characters.")
  if (!/^[a-z0-9][a-z0-9._/-]{1,80}$/i.test(modelId)) throw new Error("Enter a valid OpenRouter model id.")
  if (!Number.isFinite(credits) || credits > 10000) throw new Error("Credit cost must be 0–10,000.")
  return { name, strength, modelId, creditsPerMessage: credits }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "engine"
}

/** Fields whose change is worth telling founders about. */
const USER_VISIBLE_FIELDS = ["name", "strength", "modelId", "creditsPerMessage"] as const

function userVisibleChanged(before: CofounderModelTierDoc, after: TierInput & { id: string }): boolean {
  return USER_VISIBLE_FIELDS.some((f) => before[f] !== after[f])
}

/** Create a tier. Returns the public tier. Caller (route) triggers the
 * founder notification — kept here-free so the service stays testable. */
export async function createCofounderTier(input: TierInput): Promise<CofounderModelTierDoc> {
  const clean = validateTierInput(input)
  const col = await cofounderModelTiersCol()
  const now = Date.now()
  const last = await col.find().sort({ position: -1 }).limit(1).toArray()
  const base = slugify(clean.name)
  let id = base
  let n = 2
  while (await col.findOne({ id })) {
    id = `${base}-${n++}`
  }
  const doc: CofounderModelTierDoc = {
    id,
    ...clean,
    position: (last[0]?.position ?? -1) + 1,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
  await col.insertOne(doc)
  logger.info("cofounder.catalog", "tier created", { id, by: "admin" })
  return doc
}

/** Update user-visible fields (and position). Returns the updated doc, or
 * null when the id doesn't exist. `changed` tells the route whether a founder
 * notification is warranted. */
export async function updateCofounderTier(
  id: string,
  patch: Partial<TierInput> & { position?: number; enabled?: boolean },
): Promise<{ doc: CofounderModelTierDoc; changed: boolean } | null> {
  const col = await cofounderModelTiersCol()
  const before = await col.findOne({ id })
  if (!before) return null
  const $set: Record<string, unknown> = { updatedAt: Date.now() }
  if (patch.name !== undefined || patch.strength !== undefined || patch.modelId !== undefined || patch.creditsPerMessage !== undefined) {
    const merged = validateTierInput({
      name: patch.name ?? before.name,
      strength: patch.strength ?? before.strength,
      modelId: patch.modelId ?? before.modelId,
      creditsPerMessage: patch.creditsPerMessage ?? before.creditsPerMessage,
    })
    Object.assign($set, merged)
  }
  if (patch.position !== undefined && Number.isFinite(patch.position)) $set.position = Math.round(patch.position)
  if (patch.enabled !== undefined) $set.enabled = patch.enabled === true
  const after = { ...before, ...$set } as CofounderModelTierDoc
  const changed = userVisibleChanged(before, after)
  await col.updateOne({ id }, { $set })
  logger.info("cofounder.catalog", "tier updated", { id, changed })
  return { doc: after, changed }
}

/** Delete a tier. Refuses to remove the last enabled tier — the founder picker
 * and the agent both need at least one engine. Stored user picks pointing at
 * a deleted id fall back to the default tier automatically. */
export async function deleteCofounderTier(id: string): Promise<"deleted" | "not_found" | "last_tier"> {
  const col = await cofounderModelTiersCol()
  const target = await col.findOne({ id })
  if (!target) return "not_found"
  const enabledCount = await col.countDocuments({ enabled: true })
  if (target.enabled && enabledCount <= 1) return "last_tier"
  await col.deleteOne({ id })
  logger.info("cofounder.catalog", "tier deleted", { id })
  return "deleted"
}
