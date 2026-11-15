import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { readJsonBody } from "@/lib/api/request-body"
import { getAttachmentForViewer } from "@/lib/feedback/service"

/**
 * GET /api/feedback/attachments/[id] — stream an audio/image attachment.
 * Owner or admin only; attachments are never public.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const doc = await getAttachmentForViewer(id, user.id, Boolean(user.isAdmin))
    return new NextResponse(new Uint8Array(doc.data), {
      headers: {
        "content-type": doc.mimeType,
        "content-length": String(doc.size),
        "content-disposition": `inline; filename="${doc.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "cache-control": "private, no-store",
      },
    })
  } catch (e) {
    return handleRouteError("api.feedback.attachments.get", e)
  }
}
