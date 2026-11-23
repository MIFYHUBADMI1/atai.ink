import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { isBusinessWorkspaceEnabled } from "@/lib/business/flags"

export const dynamic = "force-dynamic"

/**
 * Whether the connected-business workspace is open for the caller.
 *
 * The sidebar needs this to decide whether to show the link, and a link to a
 * surface that answers 404 is worse than no link. It is not a gate and never
 * returns 404: the caller learns about their own access and nothing else.
 */
export async function GET() {
  try {
    const user = await requireUser()
    return ok({ enabled: await isBusinessWorkspaceEnabled(user.id) })
  } catch (error) {
    return handleRouteError("business.access", error)
  }
}
