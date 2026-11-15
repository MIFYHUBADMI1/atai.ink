import { handleRouteError, ok } from "@/lib/api/respond"
import { getOnboardingVideoUrl } from "@/lib/site-settings"
import { youTubeEmbedUrl } from "@/lib/resources/media"

export const dynamic = "force-dynamic"

/**
 * GET /api/public/onboarding-video — the admin-configured onboarding video.
 * Public, read-only. Returns the raw URL plus a ready-to-embed URL when the
 * value is a recognizable YouTube link; other https URLs pass through as-is
 * (admins can paste an embed URL directly).
 */
export async function GET() {
  try {
    const url = await getOnboardingVideoUrl()
    if (!url) return ok({ url: null, embedUrl: null })
    return ok({ url, embedUrl: youTubeEmbedUrl(url) ?? url })
  } catch (error) {
    return handleRouteError("api.public.onboarding-video", error)
  }
}
