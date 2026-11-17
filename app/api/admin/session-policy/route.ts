import { requireAdmin } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { getSessionPolicy, saveSessionPolicy } from "@/lib/auth/session-policy"
import { logger } from "@/lib/logging/logger"

/** Admin endpoint: read the active-session caps. */
export async function GET() {
  try {
    await requireAdmin()
    return ok(await getSessionPolicy())
  } catch (e) {
    return handleRouteError("api.admin.session_policy.get", e)
  }
}

/**
 * Admin endpoint: update the active-session caps.
 * `userMaxActiveSessions` applies to every regular account (email-code
 * confirmation past the cap). `adminMaxActiveSessions` applies to admin
 * accounts only; send `null` for unlimited (the default).
 */
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin()
    const body = (await req.json().catch(() => ({}))) as {
      userMaxActiveSessions?: unknown
      adminMaxActiveSessions?: unknown
    }

    const current = await getSessionPolicy()
    const next = { ...current }

    if (body.userMaxActiveSessions !== undefined) {
      const v = body.userMaxActiveSessions
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 50) {
        return fail("VALIDATION", "User session cap must be a whole number between 1 and 50.", 422)
      }
      next.userMaxActiveSessions = v
    }

    if (body.adminMaxActiveSessions !== undefined) {
      const v = body.adminMaxActiveSessions
      if (v !== null) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 50) {
          return fail("VALIDATION", "Admin session cap must be a whole number between 1 and 50, or null for unlimited.", 422)
        }
      }
      next.adminMaxActiveSessions = v
    }

    const saved = await saveSessionPolicy(next)
    logger.info("admin.session_policy", "updated session caps", {
      adminId: admin.id,
      userMaxActiveSessions: saved.userMaxActiveSessions,
      adminMaxActiveSessions: saved.adminMaxActiveSessions,
    })

    return ok(saved)
  } catch (e) {
    return handleRouteError("api.admin.session_policy.patch", e)
  }
}
