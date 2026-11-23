import "server-only"

import { handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchorProject } from "@/lib/connected-business/anchor"

/**
 * What the website read actually returned, addressed by business.
 * Membership-gated instead of owner-gated; the excerpt is the founder's own
 * public site, but it is their business record, not a public resource.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "read")
    const { businessId } = await params

    const { project } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })

    const website = project.intake?.website
    return ok({
      url: website?.url ?? null,
      pagesCrawled: website?.pagesCrawled ?? 0,
      fromCache: website?.fromCache === true,
      completedAt: website?.completedAt ?? null,
      reading: website?.reading ?? null,
    })
  } catch (error) {
    return handleRouteError("businesses.intake.reading", error)
  }
}
