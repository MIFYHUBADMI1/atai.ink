import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { invalidateEntitlements, invalidateForUser } from "@/lib/billing/entitlements"

/**
 * Admin: force-invalidate cached entitlements for a user or workspace.
 *
 * The entitlement service keeps a short-lived (≤60s) cache with event-driven
 * invalidation (ADR-8). Webhooks/grants/downgrades invalidate automatically;
 * this route is the manual escape hatch for the console when an operator needs
 * a change to take effect immediately (e.g. after a manual DB correction).
 *
 * POST body: { userId?: string; workspaceId?: string }  (at least one required)
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin()
    const body = (await request.json().catch(() => ({}))) as {
      userId?: string
      workspaceId?: string
    }

    const invalidated: string[] = []

    if (typeof body.userId === "string" && body.userId.length > 0) {
      invalidateForUser(body.userId)
      invalidated.push(`user:${body.userId}`)
    }
    if (typeof body.workspaceId === "string" && body.workspaceId.length > 0) {
      invalidateEntitlements({ kind: "workspace", workspaceId: body.workspaceId })
      invalidated.push(`workspace:${body.workspaceId}`)
    }

    if (invalidated.length === 0) {
      return ok({ invalidated, message: "No userId or workspaceId supplied; nothing to invalidate." })
    }

    return ok({ invalidated })
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.invalidate", e)
  }
}
