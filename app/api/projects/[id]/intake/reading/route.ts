import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { ok, fail, handleRouteError } from "@/lib/api/respond"

/**
 * What the website read actually returned, for the founder to inspect.
 * Session-authenticated and ownership-gated: the excerpt is the founder's own
 * public site, but it is their business record, not a public resource.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    const website = project.intake?.website
    return ok({
      url: website?.url ?? null,
      pagesCrawled: website?.pagesCrawled ?? 0,
      fromCache: website?.fromCache === true,
      completedAt: website?.completedAt ?? null,
      reading: website?.reading ?? null,
    })
  } catch (error) {
    return handleRouteError("projects.intake.reading", error)
  }
}
