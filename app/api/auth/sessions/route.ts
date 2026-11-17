import { ObjectId } from "mongodb"
import { requireUserWithSession, destroyCurrentSession } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { sessionsCol } from "@/lib/db/collections"

interface SessionInfo {
  id: string
  userAgent?: string
  createdAt: number
  lastSeenAt?: number
  expiresAt: number
  isCurrent: boolean
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  const parsed = new Date(String(value)).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

/** List live sessions for the current user. The current session is identified
 * by the server-side session row resolved from the auth cookie — never by
 * "most recent" ordering. */
export async function GET() {
  try {
    const { user, sessionId } = await requireUserWithSession()
    const col = await sessionsCol()
    const now = new Date()
    const sessions = await col
      .find({ userId: user.id, expiresAt: { $gt: now } })
      .sort({ lastSeenAt: -1, createdAt: -1 })
      .toArray()

    const result: SessionInfo[] = sessions.map((s) => ({
      id: s._id?.toString() ?? "unknown",
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: typeof s.lastSeenAt === "number" ? s.lastSeenAt : undefined,
      expiresAt: toMillis(s.expiresAt),
      isCurrent: s._id?.toString() === sessionId,
    }))

    return ok({ sessions: result })
  } catch (e) {
    return handleRouteError("api.auth.sessions.list", e)
  }
}

/**
 * DELETE /api/auth/sessions
 * - No `id` query param: revoke every session EXCEPT the current one.
 * - `?id=<sessionId>`: revoke one session owned by the current user. Revoking
 *   the current session signs the browser out and clears the cookie.
 */
export async function DELETE(req: Request) {
  try {
    const { user, sessionId } = await requireUserWithSession()
    const col = await sessionsCol()
    const targetId = new URL(req.url).searchParams.get("id")

    if (targetId) {
      if (!ObjectId.isValid(targetId)) return fail("VALIDATION", "Invalid session id.", 422)
      const target = await col.findOne({ _id: new ObjectId(targetId), userId: user.id })
      if (!target) return fail("NOT_FOUND", "Session not found.", 404)
      if (target._id.toString() === sessionId) {
        await destroyCurrentSession()
        return ok({ revoked: "current", message: "Current session signed out." })
      }
      await col.deleteOne({ _id: target._id, userId: user.id })
      return ok({ revoked: targetId, message: "Session revoked." })
    }

    await col.deleteMany({ userId: user.id, _id: { $ne: new ObjectId(sessionId) } })
    return ok({ revoked: "others", message: "All other sessions revoked." })
  } catch (e) {
    return handleRouteError("api.auth.sessions.delete", e)
  }
}
