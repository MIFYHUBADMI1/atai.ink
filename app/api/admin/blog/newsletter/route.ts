import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { AppError } from "@/lib/errors"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { blogAnnouncementInputSchema } from "@/lib/blog/admin-schema"
import { getAdminArticle, getBlogSettings, listCampaigns, listNewsletter } from "@/lib/blog/store"
import { announceArticle } from "@/lib/blog/newsletter"
import { getResendFromAddress, isResendConfigured } from "@/lib/email/resend"

export const dynamic = "force-dynamic"

/**
 * One CSV cell.
 *
 * A value that starts with = + - @ is a formula in a spreadsheet, so it is
 * neutralised, and a line break would split the row. The subscription label
 * comes from a public form, so this is a real boundary — not a precaution.
 */
function csvCell(value: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, " ").trim()
  const guarded = /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned
  return /[",]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const items = await listNewsletter()
    if (new URL(req.url).searchParams.get("format") === "csv") {
      const rows = [
        "email,source,subscribedAt,status",
        ...items.map(
          (entry) =>
            [
              csvCell(entry.email),
              csvCell(entry.source),
              new Date(entry.createdAtMs).toISOString(),
              entry.unsubscribedAt ? "unsubscribed" : "subscribed",
            ].join(","),
        ),
      ]
      return new Response(rows.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="atai-newsletter.csv"`,
        },
      })
    }
    const [campaigns, settings] = await Promise.all([listCampaigns(), getBlogSettings()])
    return ok({
      items,
      total: items.length,
      subscribers: items.filter((entry) => !entry.unsubscribedAt).length,
      campaigns,
      autoAnnounce: settings.newsletterAutoAnnounce,
      // Honest integration state: a key and a sender are configured or they
      // are not — this is never a claim that a message was delivered.
      integration: { configured: isResendConfigured(), from: getResendFromAddress() ?? null },
    })
  } catch (error) {
    return handleRouteError("api.admin.blog.newsletter", error)
  }
}

/**
 * Announce a published article to the newsletter list now.
 *
 * A manual send ignores the automatic-announcement toggle: the admin asked
 * for it. The reply reports exactly what the provider accepted.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await readJsonBody(req, 10_000)
    const parsed = blogAnnouncementInputSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Choose an article to announce.", 422)
    }
    const article = await getAdminArticle(parsed.data.articleId)
    if (!article) throw new AppError("NOT_FOUND", "We couldn't find that article.", 404)
    if (article.status !== "published") {
      throw new AppError("VALIDATION", "Only a published article can be announced.", 409)
    }
    const announcement = await announceArticle(article, { trigger: "manual", adminId: admin.id })
    return ok({ announcement })
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") return fail(error.code, error.message, error.status)
    return handleRouteError("api.admin.blog.newsletter.announce", error)
  }
}
