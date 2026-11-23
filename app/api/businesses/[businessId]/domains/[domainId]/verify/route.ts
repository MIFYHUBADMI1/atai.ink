import "server-only"

import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchorProject } from "@/lib/connected-business/anchor"
import { DomainServiceError, verifyDomainOwnership } from "@/lib/domain/service"

/**
 * One real verification attempt, addressed by business. The service fetches
 * exactly one document from the founder's own host with the full SSRF policy,
 * compares against the stored token hash, and returns the resulting state. A
 * failure is reported as a stable founder-actionable code — never a fake
 * success.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string; domainId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId, domainId } = await params

    const { project, ownerId } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "apps.manage",
    })

    const body = await readJsonBody(req, 4096)
    const method = body.method === "html_file" ? "html_file" : body.method === "meta_tag" ? "meta_tag" : undefined
    const outcome = await verifyDomainOwnership({
      userId: ownerId,
      projectId: project.id,
      domainId,
      reverification: body.reverification === true,
      ...(method ? { method } : {}),
    })
    return ok({
      verified: outcome.view.status === "verified",
      domain: outcome.view,
      failure: outcome.failure ?? null,
    })
  } catch (error) {
    if (error instanceof DomainServiceError) {
      return fail(error.code, error.message, error.status)
    }
    return handleRouteError("businesses.domains.verify", error)
  }
}
