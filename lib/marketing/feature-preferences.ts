import "server-only"
import { logger } from "@/lib/logging/logger"
import { usersCol } from "@/lib/db/collections"
import type { FeaturePreferences } from "@/lib/types/db"

export type FeaturePreferenceKey = keyof FeaturePreferences

/**
 * Founder-owned feature switches, stored on the user doc
 * (`featurePreferences`). Read here is FAIL-SOFT: any storage hiccup means
 * "no preference set" and the caller falls back to flag defaults, never a
 * thrown error in a page render or a co-founder tool turn.
 */
export async function readFeaturePreferences(userId: string): Promise<FeaturePreferences> {
  try {
    const col = await usersCol()
    const doc = await col.findOne({ id: userId }, { projection: { featurePreferences: 1 } })
    const prefs = doc?.featurePreferences
    if (!prefs || typeof prefs !== "object") return {}
    return prefs
  } catch (e) {
    logger.warn("marketing.feature-preferences", "Failed to read feature preferences; falling back to defaults", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    })
    return {}
  }
}

/** Merge-write a single switch. Reads the current object with a HARD read
 * (no fail-soft) so a flaky read can never clobber the other switches, and
 * only the three known keys are accepted; the value is forced through
 * `=== true` so nothing non-boolean lands in the doc. */
export async function writeFeaturePreference(
  userId: string,
  key: FeaturePreferenceKey,
  value: boolean,
): Promise<FeaturePreferences> {
  const col = await usersCol()
  const doc = await col.findOne({ id: userId }, { projection: { featurePreferences: 1 } })
  const current = doc?.featurePreferences && typeof doc.featurePreferences === "object" ? doc.featurePreferences : {}
  const next: FeaturePreferences = { ...current, [key]: value === true }
  const result = await col.updateOne(
    { id: userId },
    { $set: { featurePreferences: next, updatedAt: Date.now() } },
  )
  if (result.matchedCount === 0) {
    throw new Error(`Feature preference write matched no user for ${userId}`)
  }
  logger.info("marketing.feature-preferences", "Founder flipped a feature switch", { userId, key, value })
  return next
}
