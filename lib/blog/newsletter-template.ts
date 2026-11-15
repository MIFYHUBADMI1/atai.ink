/**
 * The announcement email for a newly published article.
 *
 * Pure functions — no server-only imports — so the exact HTML that goes out
 * can be asserted in a unit test without touching the network.
 */

interface AnnouncementEmailInput {
  /** Article title. */
  title: string
  /** Short summary shown in the email body. */
  excerpt: string
  /** Canonical public URL of the article. */
  url: string
  /** One-click unsubscribe URL for this reader. */
  unsubscribeUrl: string
  /** Editorial category, shown as a label. */
  category?: string
  /** Reading time in minutes. */
  readingMinutes?: number
  /** "Atai Insights" by default. */
  publication?: string
}

export interface AnnouncementEmail {
  subject: string
  html: string
  text: string
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return character
    }
  })
}

/** Only http(s) links are emitted into the HTML; anything else is dropped. */
function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""
  } catch {
    return ""
  }
}

export function buildAnnouncementSubject(title: string, publication = "Atai Insights"): string {
  return `New on ${publication.trim() || "Atai Insights"}: ${title.trim() || "A new guide"}`
}

export function buildAnnouncementEmail(input: AnnouncementEmailInput): AnnouncementEmail {
  const publication = input.publication?.trim() || "Atai Insights"
  const title = input.title.trim() || "A new guide"
  const excerpt = input.excerpt.trim()
  const articleUrl = safeUrl(input.url)
  const unsubscribeUrl = safeUrl(input.unsubscribeUrl)
  const meta = [input.category?.trim(), input.readingMinutes ? `${input.readingMinutes} min read` : ""]
    .filter(Boolean)
    .join(" · ")

  const subject = buildAnnouncementSubject(title, publication)

  const text = [
    meta,
    title,
    excerpt,
    articleUrl ? `Read it: ${articleUrl}` : "",
    `You are receiving this because you subscribed to ${publication} on Atai.`,
    unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <span style="display:none;font-size:1px;color:#f4f4f5;">${escapeHtml(excerpt)}</span>
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:16px;border:1px solid #e4e4e7;overflow:hidden;">
        <div style="height:4px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#a78bfa);"></div>
        <div style="padding:32px 28px;">
          <p style="margin:0 0 4px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6366f1;font-weight:700;">
            ${escapeHtml(publication)}
          </p>
          ${meta ? `<p style="margin:0 0 12px 0;font-size:12px;color:#71717a;">${escapeHtml(meta)}</p>` : ""}
          <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.3;color:#18181b;font-weight:700;letter-spacing:-0.02em;">
            ${escapeHtml(title)}
          </h1>
          ${excerpt ? `<p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;color:#3f3f46;">${escapeHtml(excerpt)}</p>` : ""}
          ${
            articleUrl
              ? `<div style="margin:0 0 24px 0;">
                  <a href="${escapeHtml(articleUrl)}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px;">
                    Read the guide
                  </a>
                </div>
                <p style="margin:0 0 24px 0;font-size:12px;color:#71717a;word-break:break-all;">
                  or paste this link: <a href="${escapeHtml(articleUrl)}" style="color:#6366f1;">${escapeHtml(articleUrl)}</a>
                </p>`
              : ""
          }
          <p style="margin:0;padding:16px;border-radius:12px;background:#f4f4f5;font-size:13px;line-height:1.6;color:#52525b;">
            You are receiving this because you subscribed to ${escapeHtml(publication)} on Atai. New guides, no spam.
          </p>
        </div>
        <div style="padding:18px 28px;border-top:1px solid #e4e4e7;background:#fafafa;text-align:center;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.6;">
            &copy; ${new Date().getFullYear()} Atai · Your business. Your AI teams.
            ${
              unsubscribeUrl
                ? `<br /><a href="${escapeHtml(unsubscribeUrl)}" style="color:#71717a;text-decoration:underline;">Unsubscribe from ${escapeHtml(publication)}</a>`
                : ""
            }
          </p>
        </div>
      </div>
    </div>
  </body>
</html>`

  return { subject, html, text }
}
