import { requireUser } from "@/lib/auth/session"
import { store } from "@/lib/store/store"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { readAnalyticsConsent, setAnalyticsConsent } from "@/lib/analytics/consent"
import { isAnalyticsInsightsEnabledForUser } from "@/lib/analytics/feature-flags"

/**
 * GET/PATCH /api/projects/:id/analytics-consent
 *
 * The founder's per-project permission for the co-founder to read product
 * analytics. Default OFF. Only the owner may read or flip it; the value is
 * stored on the project and enforced by the `get_product_analytics` tool.
 * This route never reads analytics data itself — it only manages consent.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)
    }
    const consent = readAnalyticsConsent(project)
    return ok({
      enabled: consent.enabled,
      updatedAt: consent.updatedAt || null,
      featureAvailable: isAnalyticsInsightsEnabledForUser(user.id),
    })
  } catch (e) {
    return handleRouteError("api.projects.analytics-consent.get", e)
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await params
    const project = await store.getProject(id)
    if (!project || project.userId !== user.id) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)
    }

    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown }
    if (typeof body.enabled !== "boolean") {
      return fail("VALIDATION", "enabled must be a boolean.", 422)
    }

    const consent = await setAnalyticsConsent(id, user.id, body.enabled)
    if (!consent) {
      return fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this project.", 404)
    }

    return ok({
      enabled: consent.enabled,
      updatedAt: consent.updatedAt,
      message: consent.enabled
        ? "Your co-founder can now read this project's product analytics."
        : "Your co-founder can no longer read this project's product analytics.",
    })
  } catch (e) {
    return handleRouteError("api.projects.analytics-consent.patch", e)
  }
}