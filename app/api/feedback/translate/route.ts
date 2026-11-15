import { requireUser } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { readJsonBody } from "@/lib/api/request-body"
import { translateToEnglish } from "@/lib/feedback/service"

/**
 * POST /api/feedback/translate — render report text in clear English.
 * The ORIGINAL text is always kept by the client; a null result here means
 * "translation unavailable" and the UI falls back to manual editing.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser()
    await checkRateLimit({ action: "feedback_translate_min", identifier: user.id, limit: 5, windowMs: 60_000 })
    await checkRateLimit({ action: "feedback_translate", identifier: user.id, limit: 20, windowMs: 60 * 60 * 1000 })
    const body = await readJsonBody(req, 16 * 1024)
    const text = typeof body.text === "string" ? body.text.trim() : ""
    if (text.length < 3 || text.length > 6000) {
      return handleRouteError("api.feedback.translate", new (await import("@/lib/errors")).AppError("VALIDATION", "Nothing to translate.", 400))
    }
    const result = await translateToEnglish(text)
    if (!result) {
      const { fail } = await import("@/lib/api/respond")
      return fail("AI_UNAVAILABLE", "English conversion isn't available right now — you can edit the text manually.", 503)
    }
    return ok(result)
  } catch (e) {
    return handleRouteError("api.feedback.translate", e)
  }
}
