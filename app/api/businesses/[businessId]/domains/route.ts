import "server-only"

import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchorProject } from "@/lib/connected-business/anchor"
import { DomainServiceError, listProjectDomains, registerDomain, toDomainView } from "@/lib/domain/service"
import { buildIntakeView, readHostnameOf } from "@/lib/existing-business/view"
import type { BusinessDomainMethod } from "@/lib/types/business-intake"

/**
 * Domain OWNERSHIP records for a connected business, addressed by business.
 * Deliberately separate from `/api/projects/:id/domain`, which manages a
 * deployed app's custom domain through the hosting provider.
 *
 * Membership-gated. The records belong to the account that owns the project,
 * so services receive `ownerId`; membership decides who may act.
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
    const domains = await listProjectDomains(project.id)
    return ok({ domains: domains.map((doc) => toDomainView(doc, { includeToken: true })) })
  } catch (error) {
    return handleRouteError("businesses.domains.get", error)
  }
}

/** Register a website domain for this business and open a verification challenge. */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await params

    const { project, ownerId } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "apps.manage",
    })
    await checkRateLimit({ action: "domain_register_user", identifier: user.id, limit: 10, windowMs: 60 * 60_000 })

    const body = await readJsonBody(req, 4096)
    const url = typeof body.url === "string" ? body.url.trim() : ""
    if (!url) return fail("VALIDATION", "Enter your website address to verify ownership.", 422)
    const method: BusinessDomainMethod | undefined =
      body.method === "html_file" ? "html_file" : body.method === "meta_tag" ? "meta_tag" : undefined

    // The address Atai read travels with the claim, so the record itself says
    // whether the co-founder's reading describes the site being verified.
    const readHostname = readHostnameOf(project)
    const { doc, created } = await registerDomain({
      userId: ownerId,
      projectId: project.id,
      rawUrl: url,
      method,
      ...(readHostname ? { readHostname } : {}),
    })
    return ok(
      {
        domain: toDomainView(doc, { includeToken: true, readHostname }),
        created,
        view: buildIntakeView(project, await listProjectDomains(project.id)),
      },
      { status: created ? 201 : 200 },
    )
  } catch (error) {
    if (error instanceof DomainServiceError) {
      return fail(error.code, error.message, error.status)
    }
    return handleRouteError("businesses.domains.post", error)
  }
}
