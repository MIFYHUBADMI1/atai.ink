import { requireUser } from "@/lib/auth/session"
import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { stageAttachment } from "@/lib/feedback/service"

/** Hard cap on upload bodies — audio is capped tighter by settings inside
 * the service; this is the transport-level guard. */
const MAX_BODY = 12 * 1024 * 1024

/**
 * POST /api/feedback/attachments — stage an image (screenshot) or audio
 * (voice note) attachment. Stored server-side with a TTL; linked to a report
 * at submission time. Returns the attachment reference for the report body.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser()
    await checkRateLimit({ action: "feedback_attachment_min", identifier: user.id, limit: 6, windowMs: 60_000 })
    await checkRateLimit({ action: "feedback_attachment", identifier: user.id, limit: 30, windowMs: 60 * 60 * 1000 })

    const contentLength = Number(req.headers.get("content-length") ?? 0)
    if (contentLength > MAX_BODY) return fail("VALIDATION", "File is too large.", 413)

    const form = await req.formData()
    const file = form.get("file")
    const kind = form.get("kind")
    if (!(file instanceof File)) return fail("VALIDATION", "Attach a file.", 400)
    if (kind !== "image" && kind !== "audio") return fail("VALIDATION", "Invalid attachment kind.", 400)

    const durationRaw = form.get("durationSeconds")
    const durationSeconds = durationRaw ? Number(durationRaw) : undefined

    const data = Buffer.from(await file.arrayBuffer())
    const ref = await stageAttachment(user.id, {
      kind,
      fileName: file.name || "attachment",
      mimeType: file.type || "application/octet-stream",
      data,
      ...(Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
    })
    return ok(ref, { status: 201 })
  } catch (e) {
    return handleRouteError("api.feedback.attachments", e)
  }
}
