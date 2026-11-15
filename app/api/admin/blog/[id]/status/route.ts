import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogPublishInputSchema } from "@/lib/blog/admin-schema"
import { setArticleStatus, toAdminView } from "@/lib/blog/store"
import { submitToIndexNow } from "@/lib/blog/indexnow"
import { announceArticle, type AnnouncementResult } from "@/lib/blog/newsletter"
import { logger } from "@/lib/logging/logger"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await readJsonBody(req, 10_000)
    const parsed = blogPublishInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the publishing action.", 422)
    }
    const updated = await setArticleStatus(id, parsed.data.action, admin.id, parsed.data.scheduledFor)
    // Publishing makes the article eligible for discovery. A submission ping
    // is best-effort and never blocks the publish; it is not proof of indexing.
    let indexing: Awaited<ReturnType<typeof submitToIndexNow>> | undefined
    // The same applies to the newsletter announcement: a publish is never
    // blocked by mail, but the admin is told exactly what happened.
    let announcement: AnnouncementResult | undefined
    if (parsed.data.action === "publish") {
      indexing = await submitToIndexNow([`/blog/${updated.slug}`]).catch(() => undefined)
      announcement = await announceArticle(updated, { trigger: "publish", adminId: admin.id }).catch((error) => {
        logger.error("api.admin.blog.status", "newsletter announcement failed", {
          message: error instanceof Error ? error.message : String(error),
        })
        return {
          status: "failed",
          recipients: 0,
          sentCount: 0,
          failedCount: 0,
          skippedCount: 0,
          reason: "The announcement could not be prepared.",
        } satisfies AnnouncementResult
      })
    }
    return ok({ item: toAdminView(updated), indexing, announcement })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.status", error)
  }
}