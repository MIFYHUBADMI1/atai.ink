import { getDb } from "@/lib/db/mongodb"
import { z } from "zod"
import { logger } from "@/lib/logging/logger"

/**
 * Admin-controlled active-session caps, stored in `app_settings` and layered
 * on top of code defaults — same pattern as billing runtime-config: a missing
 * or corrupt doc always falls back to the defaults, so a wiped collection can
 * never lock every account out of sign-in.
 *
 * - `userMaxActiveSessions`: cap for regular accounts. Beyond it, a sign-in
 *   must be confirmed with an emailed code before the oldest sessions are
 *   evicted.
 * - `adminMaxActiveSessions`: cap for admin accounts. `null` (the default)
 *   means unlimited — admins never receive the emailed-code flow; if a cap is
 *   set, going over it evicts the oldest sessions silently at sign-in.
 */

const SETTINGS_COLLECTION = "app_settings"
const SETTINGS_DOC_ID = "session_policy"
const CACHE_TTL_MS = 30_000

export const DEFAULT_USER_MAX_ACTIVE_SESSIONS = 2

const SessionPolicySchema = z.object({
  userMaxActiveSessions: z.number().int().min(1).max(50),
  adminMaxActiveSessions: z.number().int().min(1).max(50).nullable(),
})
export type SessionPolicy = z.infer<typeof SessionPolicySchema>

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  userMaxActiveSessions: DEFAULT_USER_MAX_ACTIVE_SESSIONS,
  adminMaxActiveSessions: null,
}

interface SessionPolicyDoc {
  _id: string
  userMaxActiveSessions?: number
  adminMaxActiveSessions?: number | null
  updatedAt?: number
}

let cache: { value: SessionPolicy; at: number } | null = null

/** Clear the in-process cache (called after an admin update). */
export function invalidateSessionPolicyCache(): void {
  cache = null
}

export async function getSessionPolicy(): Promise<SessionPolicy> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value

  let value: SessionPolicy = { ...DEFAULT_SESSION_POLICY }
  try {
    const db = await getDb()
    const doc = await db.collection<SessionPolicyDoc>(SETTINGS_COLLECTION).findOne({ _id: SETTINGS_DOC_ID })
    if (doc) {
      const parsed = SessionPolicySchema.safeParse({
        userMaxActiveSessions: doc.userMaxActiveSessions ?? DEFAULT_SESSION_POLICY.userMaxActiveSessions,
        adminMaxActiveSessions: doc.adminMaxActiveSessions === undefined
          ? DEFAULT_SESSION_POLICY.adminMaxActiveSessions
          : doc.adminMaxActiveSessions,
      })
      if (parsed.success) value = parsed.data
    }
  } catch (e) {
    // DB unavailable → defaults (retry soon, not after the full TTL).
    logger.warn("auth.session-policy", "failed to load session policy, using defaults", {
      message: e instanceof Error ? e.message : String(e),
    })
    cache = { value, at: now - CACHE_TTL_MS + 5_000 }
    return value
  }

  cache = { value, at: now }
  return value
}

/**
 * Cap for one account, or `null` for unlimited. `isAdmin` accounts fall to
 * the admin cap so a founder can work from many devices without the emailed
 * verification dance.
 */
export async function getMaxActiveSessionsForUser(user: { isAdmin?: boolean }): Promise<number | null> {
  const policy = await getSessionPolicy()
  return user.isAdmin ? policy.adminMaxActiveSessions : policy.userMaxActiveSessions
}

export async function saveSessionPolicy(next: SessionPolicy): Promise<SessionPolicy> {
  const db = await getDb()
  await db.collection<SessionPolicyDoc>(SETTINGS_COLLECTION).updateOne(
    { _id: SETTINGS_DOC_ID },
    {
      $set: {
        userMaxActiveSessions: next.userMaxActiveSessions,
        adminMaxActiveSessions: next.adminMaxActiveSessions,
        updatedAt: Date.now(),
      },
    },
    { upsert: true },
  )
  invalidateSessionPolicyCache()
  return (await getSessionPolicy())
}
