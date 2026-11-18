import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { businessStartingPointOf } from "@/lib/types/business-intake"
import { DomainServiceError, listProjectDomains, registerDomain, toDomainView } from "@/lib/domain/service"
import { buildIntakeView } from "@/lib/existing-business/view"
import type { BusinessDomainMethod } from "@/lib/types/business-intake"

/**
 * Domain OWNERSHIP records for a business (Phase 1.5). Deliberately separate
 * from `/api/projects/:id/domain`, which manages a deployed app's custom
 * domain through the hosting provider.
 *
 * GET returns the owner's own records including the challenge token display
 * copy — session-authenticated and ownership-gated, never public.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    const domains = await listProjectDomains(id)
    return ok({ domains: domains.map((doc) => toDomainView(doc, { includeToken: true })) })
  } catch (error) {
    return handleRouteError("projects.domains.get", error)
  }
}

/** Register a website domain for this business and open a verification challenge. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404)
    }
    if (businessStartingPointOf(project) !== "existing_business") {
      return fail("NOT_ELIGIBLE", "Domain verification belongs to an existing business in Atai.", 422)
    }
    await checkRateLimit({ action: "domain_register_user", identifier: user.id, limit: 10, windowMs: 60 * 60_000 })

    const body = await readJsonBody(req, 4096)
    const url = typeof body.url === "string" ? body.url.trim() : ""
    if (!url) return fail("VALIDATION", "Enter your website address to verify ownership.", 422)
    const method: BusinessDomainMethod | undefined =
      body.method === "html_file" ? "html_file" : body.method === "meta_tag" ? "meta_tag" : undefined

    const { doc, created } = await registerDomain({ userId: user.id, projectId: id, rawUrl: url, method })
    return ok(
      { domain: toDomainView(doc, { includeToken: true }), created, view: buildIntakeView(project, await listProjectDomains(id)) },
      { status: created ? 201 : 200 },
    )
  } catch (error) {
    if (error instanceof DomainServiceError) {
      return fail(error.code, error.message, error.status)
    }
    return handleRouteError("projects.domains.post", error)
  }
}
