import { requireAdmin } from "@/lib/auth/session"
import { fail, handleRouteError } from "@/lib/api/respond"
import { getAdRequestById } from "@/lib/marketing/ads/requests"
import { buildCampaignDossier, dossierToHtml } from "@/lib/marketing/ads/dossier"
import { logger } from "@/lib/logging/logger"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const request = await getAdRequestById(id)
    if (!request) return fail("VALIDATION", "We couldn't find that campaign request.", 404)

    const format = new URL(req.url).searchParams.get("format") ?? "json"
    const dossier = await buildCampaignDossier(request)
    const customerSafe = {
      ...dossier,
      timeline: dossier.timeline.filter((event) => event.visibility !== "internal"),
    }

    logger.info("marketing.ads.export", "admin exported campaign dossier", {
      requestId: id,
      adminId: admin.id,
      format,
    })

    if (format === "html" || format === "pdf") {
      const html = dossierToHtml(customerSafe)
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${safeName(request.id)}-brief.html"`,
        },
      })
    }

    return new Response(JSON.stringify(customerSafe, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${safeName(request.id)}.json"`,
      },
    })
  } catch (e) {
    return handleRouteError("api.admin.ads.export", e)
  }
}

function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
}
