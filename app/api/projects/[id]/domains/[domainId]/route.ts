import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import {
  DomainServiceError,
  regenerateChallenge,
  releaseDomain,
  setDomainMethod,
  toDomainView,
} from "@/lib/domain/service"
import type { BusinessDomainMethod } from "@/lib/types/business-intake"

/**
 * Owner actions on one verification challenge: switch method, regenerate the
 * token (invalidating the previous one immediately), or release the claim.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; domainId: string }> }) {
  try {
    const user = await requireUser()
    const { id, domainId } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    await checkRateLimit({ action: "domain_manage_user", identifier: user.id, limit: 30, windowMs: 60 * 60_000 })

    const body = await readJsonBody(req, 4096)
    const action = typeof body.action === "string" ? body.action : ""
    const method: BusinessDomainMethod | undefined =
      body.method === "html_file" ? "html_file" : body.method === "meta_tag" ? "meta_tag" : undefined
    const scope = { userId: user.id, projectId: id, domainId }

    let doc
    if (action === "set_method") {
      if (!method) return fail("VALIDATION", "Choose the meta tag or the HTML file method.", 422)
      doc = await setDomainMethod({ ...scope, method })
    } else if (action === "regenerate") {
      doc = await regenerateChallenge({ ...scope, method })
    } else if (action === "release") {
      doc = await releaseDomain({ ...scope, reason: typeof body.reason === "string" ? body.reason.slice(0, 200) : undefined })
    } else {
      return fail("VALIDATION", "Choose an action: set_method, regenerate or release.", 422)
    }

    return ok({ domain: toDomainView(doc, { includeToken: action !== "release" }) })
  } catch (error) {
    if (error instanceof DomainServiceError) {
      return fail(error.code, error.message, error.status)
    }
    return handleRouteError("projects.domains.patch", error)
  }
}
