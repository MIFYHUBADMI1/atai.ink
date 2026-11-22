import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { DomainServiceError, verifyDomainOwnership } from "@/lib/domain/service"

/**
 * One real verification attempt. The service fetches exactly one document
 * from the founder's own host with the full SSRF policy, compares against the
 * stored token hash, and returns the resulting state. A failure is reported
 * as a stable founder-actionable code — never a fake success.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; domainId: string }> }) {
  try {
    const user = await requireUser()
    const { id, domainId } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    const body = await readJsonBody(req, 4096)
    const method = body.method === "html_file" ? "html_file" : body.method === "meta_tag" ? "meta_tag" : undefined
    const outcome = await verifyDomainOwnership({
      userId: user.id,
      projectId: id,
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
    return handleRouteError("projects.domains.verify", error)
  }
}
