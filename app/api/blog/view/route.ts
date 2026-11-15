import { NextRequest } from "next/server"
import { createHash } from "node:crypto"
import { clientIpBucketOrShared } from "@/lib/api/client-ip"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogViewInputSchema } from "@/lib/blog/admin-schema"
import { recordArticleView } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

/** First-party article view beacon. Counts real page views only; the client
 * dedupes per session so refreshes don't inflate the number. */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req, 10_000)
    const parsed = blogViewInputSchema.safeParse(body)
    if (!parsed.success) throw new AppError("VALIDATION", "Unknown article.", 422)
    // A verified address limits the reader; an unverifiable one limits the
    // article instead, so one reader can never inflate a single page.
    const { bucket, verified } = clientIpBucketOrShared(req)
    const identifier = createHash("sha256")
      .update(verified ? bucket : `article:${parsed.data.slug}`)
      .digest("hex")
    await checkRateLimit({
      action: verified ? "blog_view_ip" : "blog_view_article",
      identifier,
      limit: verified ? 120 : 60,
      windowMs: 60_000,
    })
    await recordArticleView(parsed.data.slug)
    return ok({ recorded: true })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.blog.view", error)
  }
}