import { requireUser } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { readJsonBody } from "@/lib/api/request-body"
import { submitReport, getFeedbackSettings } from "@/lib/feedback/service"
import type { FeedbackDiagnostics, FeedbackTranscription } from "@/lib/feedback/types"

/**
 * GET /api/feedback/reports — the caller's own reports (paginated) plus
 * contribution stats. Ownership is enforced by the userId filter.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser()
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1)
    const { listMyReports } = await import("@/lib/feedback/service")
    return ok(await listMyReports(user.id, page))
  } catch (e) {
    return handleRouteError("api.feedback.reports.list", e)
  }
}

/**
 * POST /api/feedback/reports — submit a bug/issue report.
 * Body: { category, description, originalDescription?, detectedLanguage?,
 *         transcription?, attachments?, diagnostics, fingerprint? }
 * Diagnostics are re-sanitised server-side; the client snapshot is treated
 * as untrusted input.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser()
    const settings = await getFeedbackSettings()
    if (!settings.enabled || !settings.bugReportsEnabled) {
      return handleRouteError("api.feedback.reports.submit", new (await import("@/lib/errors")).AppError("VALIDATION", "Bug reporting is currently disabled.", 403))
    }
    // Abuse guard: tight per-minute cap plus a generous hourly cap.
    await checkRateLimit({ action: "feedback_submit_min", identifier: user.id, limit: 3, windowMs: 60_000 })
    await checkRateLimit({ action: "feedback_submit", identifier: user.id, limit: 10, windowMs: 60 * 60 * 1000 })

    const body = await readJsonBody(req, 64 * 1024)
    const result = await submitReport(user.id, {
      category: String(body.category ?? ""),
      description: String(body.description ?? ""),
      originalDescription: typeof body.originalDescription === "string" ? body.originalDescription : undefined,
      detectedLanguage: typeof body.detectedLanguage === "string" ? body.detectedLanguage : undefined,
      transcription: (body.transcription as FeedbackTranscription | undefined) ?? undefined,
      attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
      diagnostics: (body.diagnostics as FeedbackDiagnostics | undefined) ?? ({} as FeedbackDiagnostics),
      fingerprint: typeof body.fingerprint === "string" ? body.fingerprint : undefined,
    })
    return ok(result, { status: 201 })
  } catch (e) {
    return handleRouteError("api.feedback.reports.submit", e)
  }
}
