import "server-only"

import { z } from "zod"

import { withAiProtection } from "@/lib/api/ai-protection"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchor } from "@/lib/connected-business/anchor"
import { auditableSiteUrl } from "@/lib/connected-business/site-url"
import { isFirecrawlConfigured } from "@/lib/integrations/firecrawl/client"
import { isSeoAuditEnabledForUser } from "@/lib/marketing/feature-flags"
import { runSeoAuditRequest } from "@/lib/marketing/seo/request"
import { getLatestSeoAudit } from "@/lib/marketing/seo/service"
import { store } from "@/lib/store/store"

/**
 * SEO visibility audit for a connected business.
 *
 * The audited address is the hostname the founder proved — never a URL from
 * the client — so the business cannot be tricked into auditing someone else's
 * site. Credits are charged to the acting member, which is the same rule every
 * other credit-consuming action follows.
 */

const BodySchema = z
  .object({ requestId: z.string().max(128).optional() })
  .strip()

function auditView(latest: Awaited<ReturnType<typeof getLatestSeoAudit>>) {
  if (!latest) return null
  return {
    id: latest.id,
    url: latest.url,
    status: latest.status,
    score: latest.score,
    auditScore: latest.auditScore ?? null,
    pagesCrawled: latest.pagesCrawled,
    findings: latest.findings,
    recommendations: latest.recommendations ?? [],
    recommendationsMeta: latest.recommendationsMeta ?? null,
    refund: latest.refund ?? null,
    error: latest.error ?? null,
    fromCache: latest.fromCache,
    createdAt: latest.createdAt,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "read")
    const { businessId } = await params

    const anchor = await resolveBusinessAnchor({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })

    if (!isSeoAuditEnabledForUser(user.id, user.featurePreferences)) {
      return ok({ enabled: false, latest: null })
    }
    return ok({ enabled: true, latest: auditView(await getLatestSeoAudit(anchor.projectId)) })
  } catch (e) {
    return handleRouteError("api.businesses.seoAudit.get", e)
  }
}

export const POST = withAiProtection("analysis", post)

async function post(req: Request, context: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await context.params

    await checkRateLimit({ action: "seo_audit_run", identifier: user.id, limit: 10, windowMs: 60 * 60 * 1000 })

    const anchor = await resolveBusinessAnchor({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })

    if (!isSeoAuditEnabledForUser(user.id, user.featurePreferences)) {
      return fail("FEATURE_DISABLED", "SEO visibility audits are switched off. Turn them on in Settings → Feature switches.", 403)
    }
    if (!isFirecrawlConfigured()) {
      return fail("FIRECRAWL_UNAVAILABLE", "The website analyzer isn't connected right now.", 503)
    }

    const project = await store.getProject(anchor.projectId)
    if (!project) return fail("UNAUTHORIZED_BUSINESS_ACCESS", "We couldn't find this business.", 404)

    const site = await auditableSiteUrl(project)
    if (!site) {
      return fail(
        "NOT_VERIFIED",
        "Prove your domain first — the audit reads only an address you have proved you own.",
        400,
      )
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail("VALIDATION", "Invalid request.", 422)

    return await runSeoAuditRequest({
      userId: user.id,
      projectId: anchor.projectId,
      projectName: project.name,
      url: site.url,
      ...(parsed.data.requestId ? { requestId: parsed.data.requestId } : {}),
      logTag: "api.businesses.seoAudit.post",
    })
  } catch (e) {
    return handleRouteError("api.businesses.seoAudit.post", e)
  }
}
