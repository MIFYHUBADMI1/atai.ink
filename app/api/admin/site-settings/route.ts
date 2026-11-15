import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { isHttpsUrl } from "@/lib/resources/media"
import { getOnboardingVideoUrl, getSiteSettings, updateSiteSettings } from "@/lib/site-settings"

export const dynamic = "force-dynamic"

/** GET /api/admin/site-settings — admin view of site-wide settings. */
export async function GET() {
  try {
    await requireAdmin()
    const [settings, effectiveVideoUrl] = await Promise.all([getSiteSettings(), getOnboardingVideoUrl()])
    return ok({ settings, effectiveVideoUrl })
  } catch (error) {
    return handleRouteError("api.admin.site-settings.get", error)
  }
}

/**
 * PATCH /api/admin/site-settings
 * Body: { "onboardingVideoUrl": "https://…" | null }
 * null or "" clears the override (the env fallback applies again).
 */
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 10_000)

    if (!("onboardingVideoUrl" in body)) {
      throw new AppError("VALIDATION", "Nothing to update — send onboardingVideoUrl.", 422)
    }

    const raw = body.onboardingVideoUrl
    if (raw !== null && typeof raw !== "string") {
      throw new AppError("VALIDATION", "onboardingVideoUrl must be a URL string or null.", 422)
    }

    const trimmed = typeof raw === "string" ? raw.trim() : ""
    if (trimmed && !isHttpsUrl(trimmed)) {
      throw new AppError("VALIDATION", "Use a full https:// URL (e.g. a YouTube watch or share link).", 422)
    }
    if (trimmed.length > 500) {
      throw new AppError("VALIDATION", "That URL is too long.", 422)
    }

    const settings = await updateSiteSettings({ onboardingVideoUrl: trimmed || undefined }, admin.id)
    return ok({ settings, effectiveVideoUrl: await getOnboardingVideoUrl() })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.site-settings.update", error)
  }
}
