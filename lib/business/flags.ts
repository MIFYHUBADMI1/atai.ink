import "server-only"

import { businessRolloutCol } from "@/lib/db/collections"
import { logger } from "@/lib/logging/logger"

/**
 * Connected-workspace rollout (D4).
 *
 * The switch is controlled from /admin/connected-business and stored in the
 * `business_rollout` collection. The env vars are the deployment fallback: they
 * apply only while no admin has saved a setting, so a deploy can still stage
 * the surface without touching production data.
 *
 * Two rules hold in every path:
 *
 *   - An unrecognised mode means `off`. A typo, a corrupted document or a
 *     failed read must never open a surface nobody approved.
 *   - The cohort is only consulted while the mode is `internal`. Widening to
 *     `all` does not delete it, and narrowing back restores it intact.
 *
 * @module lib/business/flags
 */

export type BusinessWorkspaceMode = "off" | "internal" | "all"

export const BUSINESS_ROLLOUT_ID = "connected-business"

/**
 * Short enough that an admin toggle takes effect promptly, long enough that a
 * page render does not re-read the switch for every request.
 */
const CACHE_TTL_MS = 5_000

export interface BusinessRollout {
  mode: BusinessWorkspaceMode
  cohort: readonly string[]
  /** `admin` when the stored document decides, otherwise the env fallback. */
  source: "admin" | "env" | "default"
  updatedAt?: number
  updatedBy?: string
}

export function parseBusinessWorkspaceMode(raw: string | null | undefined): BusinessWorkspaceMode {
  const value = (raw ?? "").trim().toLowerCase()
  return value === "internal" || value === "all" ? value : "off"
}

/** Trimmed, de-duplicated, sorted. Sorted so two equal cohorts compare equal. */
export function normaliseCohort(entries: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const entry of entries) {
    const id = entry.trim()
    if (id) unique.add(id)
  }
  return [...unique].sort()
}

export function resolveBusinessWorkspace(
  input: { mode: BusinessWorkspaceMode; cohort: readonly string[] },
  userId: string,
): boolean {
  if (input.mode === "off") return false
  if (input.mode === "all") return true
  return input.cohort.includes(userId)
}

/** What the deployment's env vars alone would do. Shown to admins so
 *  "clear override" has a visible meaning. */
export function deploymentRollout(): BusinessRollout {
  // An empty variable is not a configuration; it means the deployment never set
  // one. Reporting that honestly is what keeps the admin UI's source badge true.
  const raw = process.env.CONNECTED_WORKSPACE_V2?.trim()
  return {
    mode: parseBusinessWorkspaceMode(raw),
    cohort: normaliseCohort((process.env.CONNECTED_WORKSPACE_COHORT ?? "").split(",")),
    source: raw ? "env" : "default",
  }
}

let cache: { value: BusinessRollout; expiresAt: number } | null = null

export function resetBusinessRolloutCacheForTests(): void {
  cache = null
}

/**
 * The effective rollout. A database failure falls back to the env vars, which
 * fall back to `off` — a read that fails must not enable anything.
 */
export async function getBusinessRollout(): Promise<BusinessRollout> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value

  let value: BusinessRollout
  try {
    const doc = await (await businessRolloutCol()).findOne({ id: BUSINESS_ROLLOUT_ID })
    value = doc
      ? {
          mode: parseBusinessWorkspaceMode(doc.mode),
          cohort: normaliseCohort(doc.cohort ?? []),
          source: "admin",
          updatedAt: doc.updatedAt,
          updatedBy: doc.updatedBy,
        }
      : deploymentRollout()
  } catch (error) {
    logger.warn("business.rollout", "could not read the rollout setting, using the deployment fallback", {
      message: error instanceof Error ? error.message : String(error),
    })
    value = deploymentRollout()
    cache = { value, expiresAt: now + 1_000 }
    return value
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}

export async function businessWorkspaceMode(): Promise<BusinessWorkspaceMode> {
  return (await getBusinessRollout()).mode
}

export async function isBusinessWorkspaceEnabled(userId: string): Promise<boolean> {
  return resolveBusinessWorkspace(await getBusinessRollout(), userId)
}

/**
 * Writes the admin setting. `mode` and `cohort` are optional so a cohort edit
 * cannot silently flip the mode, and a mode change cannot silently wipe the
 * cohort.
 */
export async function updateBusinessRollout(
  input: { mode?: BusinessWorkspaceMode; cohort?: readonly string[] },
  adminId: string,
): Promise<BusinessRollout> {
  const patch: Record<string, unknown> = { updatedAt: Date.now(), updatedBy: adminId }
  if (input.mode !== undefined) patch.mode = input.mode
  if (input.cohort !== undefined) patch.cohort = normaliseCohort(input.cohort)

  // The document may not exist yet, and an upsert writes only what it is given.
  // Seeding the untouched half from the effective value is what keeps the
  // promise in this function's contract: adding a user to the cohort must not
  // switch the mode, and switching the mode must not empty the cohort.
  const current = await getBusinessRollout()
  const onInsert: Record<string, unknown> = {}
  if (input.mode === undefined) onInsert.mode = current.mode
  if (input.cohort === undefined) onInsert.cohort = [...current.cohort]

  await (await businessRolloutCol()).updateOne(
    { id: BUSINESS_ROLLOUT_ID },
    { $set: patch, $setOnInsert: onInsert },
    { upsert: true },
  )
  cache = null
  return getBusinessRollout()
}

/** Removes the admin override, returning control to the deployment env vars. */
export async function clearBusinessRollout(): Promise<BusinessRollout> {
  await (await businessRolloutCol()).deleteOne({ id: BUSINESS_ROLLOUT_ID })
  cache = null
  return getBusinessRollout()
}
