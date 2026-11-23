import "server-only"

import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchorProject } from "@/lib/connected-business/anchor"
import {
  DomainServiceError,
  regenerateChallenge,
  releaseDomain,
  setDomainMethod,
  toDomainView,
} from "@/lib/domain/service"
import type { BusinessDomainMethod } from "@/lib/types/business-intake"

/**
 * Member actions on one verification challenge: switch method, regenerate the
 * token (invalidating the previous one immediately), or release the claim.
 * The records belong to the owning account, so services receive `ownerId`.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ businessId: string; domainId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId, domainId } = await params

    const { project, ownerId } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "apps.manage",
    })
    await checkRateLimit({ action: "domain_manage_user", identifier: user.id, limit: 30, windowMs: 60 * 60_000 })

    const body = await readJsonBody(req, 4096)
    const action = typeof body.action === "string" ? body.action : ""
    const method: BusinessDomainMethod | undefined =
      body.method === "html_file" ? "html_file" : body.method === "meta_tag" ? "meta_tag" : undefined
    const scope = { userId: ownerId, projectId: project.id, domainId }

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
    return handleRouteError("businesses.domains.patch", error)
  }
}
