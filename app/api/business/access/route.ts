import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { businessWorkspaceAccess } from "@/lib/business/flags"

export const dynamic = "force-dynamic"

/**
 * Whether the connected-business workspace is open for the caller.
 *
 * An account that has connected a business is always inside, whatever the
 * rollout cohort says (`businessWorkspaceAccess`). It is not a gate and never
 * returns 404: the caller learns about their own access and nothing else.
 */
export async function GET() {
  try {
    const user = await requireUser()
    return ok(await businessWorkspaceAccess(user.id))
  } catch (error) {
    return handleRouteError("business.access", error)
  }
}
