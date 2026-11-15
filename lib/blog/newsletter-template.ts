import {
  emailButton,
  emailFooterLink,
  emailParagraph,
  escapeHtml as escapeHtmlValue,
  renderEmailShell,
  safeHttpUrl,
} from "@/lib/email/layout"

export function escapeHtml(value: string): string {
  return escapeHtmlValue(value)
}

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

export function buildAnnouncementSubject(title: string, publication = "Atai Insights"): string {
  return `New on ${publication.trim() || "Atai Insights"}: ${title.trim() || "A new guide"}`
}

export function buildAnnouncementEmail(input: AnnouncementEmailInput): AnnouncementEmail {
  const publication = input.publication?.trim() || "Atai Insights"
  const title = input.title.trim() || "A new guide"
  const excerpt = input.excerpt.trim()
  const articleUrl = safeHttpUrl(input.url)
  const unsubscribeUrl = safeHttpUrl(input.unsubscribeUrl)
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

  const bodyHtml = [
    meta
      ? `<p class="email-faint" style="margin:0 0 12px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#71717a;">${escapeHtml(meta)}</p>`
      : "",
    excerpt ? emailParagraph(escapeHtml(excerpt)) : "",
    articleUrl ? emailButton(articleUrl, "Read the guide") : "",
    emailParagraph(`You are receiving this because you subscribed to ${escapeHtml(publication)} on Atai. New guides, no spam.`),
  ].join("")

  const html = renderEmailShell({
    title,
    preheader: excerpt || title,
    eyebrow: publication,
    heading: title,
    publication: "Atai",
    bodyHtml,
    footerHtml: unsubscribeUrl ? emailFooterLink(unsubscribeUrl, `Unsubscribe from ${publication}`) : "",
  })

  return { subject, html, text }
}
