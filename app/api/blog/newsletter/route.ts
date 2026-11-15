import { NextRequest } from "next/server"
import { createHash } from "node:crypto"
import { clientIpBucketOrShared } from "@/lib/api/client-ip"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogNewsletterInputSchema } from "@/lib/blog/admin-schema"
import { normalizeNewsletterSource } from "@/lib/blog/content"
import { subscribeNewsletter } from "@/lib/blog/store"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req, 10_000)
    const parsed = blogNewsletterInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Enter a valid email address.", 422)
    }
    // The address itself is always limited — it is the thing being registered.
    await checkRateLimit({
      action: "blog_newsletter_email",
      identifier: createHash("sha256").update(`email:${parsed.data.email}`).digest("hex"),
      limit: 3,
      windowMs: 60 * 60_000,
    })
    // A verified address is limited per reader; without one the limit falls
    // back to a shared bucket so a spammer cannot flood the list, and a real
    // reader is never locked out by someone else's abuse.
    const { bucket, verified } = clientIpBucketOrShared(req)
    await checkRateLimit({
      action: verified ? "blog_newsletter_ip" : "blog_newsletter_shared",
      identifier: createHash("sha256").update(bucket).digest("hex"),
      limit: verified ? 5 : 60,
      windowMs: 60 * 60_000,
    })
    const result = await subscribeNewsletter(parsed.data.email, normalizeNewsletterSource(parsed.data.source))
    return ok(result, { status: result.alreadySubscribed ? 200 : 201 })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.blog.newsletter", error)
  }
}