import { NextRequest } from "next/server"
import { getNewsletterSubscriber, unsubscribeNewsletter } from "@/lib/blog/store"
import { escapeHtml } from "@/lib/blog/newsletter-template"

export const dynamic = "force-dynamic"

/**
 * Unsubscribing from the Atai Insights newsletter.
 *
 * The link carries the subscriber id — a random value that only the owner of
 * the address ever sees. GET asks for confirmation; POST performs the
 * unsubscribe, which is also what a one-click mail client does.
 */

function page(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:48px 16px;">
      <div style="background:#ffffff;border-radius:16px;border:1px solid #e4e4e7;padding:32px 28px;">
        <p style="margin:0 0 4px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6366f1;font-weight:700;">
          Atai Insights
        </p>
        <h1 style="margin:0 0 12px 0;font-size:22px;color:#18181b;font-weight:700;">${escapeHtml(title)}</h1>
        ${body}
        <p style="margin:24px 0 0 0;font-size:12px;color:#a1a1aa;">
          <a href="/blog" style="color:#6366f1;">Browse the guides on Atai</a>
        </p>
      </div>
    </div>
  </body>
</html>`
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
}

async function readSubscriberId(req: NextRequest): Promise<string | null> {
  const fromQuery = new URL(req.url).searchParams.get("id")
  if (fromQuery) return fromQuery
  const contentType = req.headers.get("content-type") ?? ""
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { id?: unknown }
      return typeof body?.id === "string" ? body.id : null
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData()
      const value = form.get("id")
      return typeof value === "string" ? value : null
    }
  } catch {
    return null
  }
  return null
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id")
  if (!id) {
    return page("Unsubscribe", "<p style=\"font-size:15px;line-height:1.7;color:#3f3f46;\">That unsubscribe link is not valid.</p>")
  }
  const subscriber = await getNewsletterSubscriber(id)
  if (!subscriber) {
    return page(
      "Unsubscribe",
      "<p style=\"font-size:15px;line-height:1.7;color:#3f3f46;\">We couldn't find that subscription — it may already have been removed.</p>",
    )
  }
  return page(
    "Stop sending me guides",
    `<p style="font-size:15px;line-height:1.7;color:#3f3f46;">You will stop receiving new guides from Atai Insights at <strong>${escapeHtml(subscriber.email)}</strong>.</p>
     <form method="post" action="/api/blog/newsletter/unsubscribe" style="margin:24px 0 0 0;">
       <input type="hidden" name="id" value="${escapeHtml(subscriber.id)}" />
       <button type="submit" style="padding:14px 28px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;border:0;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;">
         Confirm unsubscribe
       </button>
     </form>`,
  )
}

export async function POST(req: NextRequest) {
  const id = await readSubscriberId(req)
  if (!id) {
    return page("Unsubscribe", "<p style=\"font-size:15px;line-height:1.7;color:#3f3f46;\">That unsubscribe link is not valid.</p>")
  }
  const subscriber = await getNewsletterSubscriber(id)
  if (!subscriber) {
    return page(
      "Unsubscribe",
      "<p style=\"font-size:15px;line-height:1.7;color:#3f3f46;\">We couldn't find that subscription — it may already have been removed.</p>",
    )
  }
  await unsubscribeNewsletter(subscriber.email)
  return page(
    "You're unsubscribed",
    `<p style="font-size:15px;line-height:1.7;color:#3f3f46;">${escapeHtml(subscriber.email)} will no longer receive new guides. You can subscribe again from the blog at any time.</p>`,
  )
}
