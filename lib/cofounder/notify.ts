import "server-only"

/**
 * Founder broadcast email when the AI co-founder engine catalog changes
 * (admin adds or edits a tier in /admin/cofounder-models). This is a
 * courtesy/marketing layer — delivery problems must NEVER fail the admin
 * action, so every failure is logged and swallowed. Sends go to verified,
 * non-banned accounts only.
 */

import { sendMail } from "@/lib/email/mailer"
import { emailButton, emailNote, emailParagraph, escapeHtml, renderEmailShell } from "@/lib/email/layout"
import { usersCol } from "@/lib/db/collections"
import { getAppUrl } from "@/lib/env"
import { logger } from "@/lib/logging/logger"
import type { CofounderModelTier } from "./models"


function costLabel(tier: CofounderModelTier): string {
  return tier.creditsPerMessage === 0 ? "Free" : `${tier.creditsPerMessage} credits per message`
}

function tierRow(tier: CofounderModelTier): string {
  return `<tr>
<td class="email-strong" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:700;color:#18181b;">${escapeHtml(tier.name)}</td>
<td class="email-text" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;line-height:1.5;color:#3f3f46;">${escapeHtml(tier.strength)}</td>
<td class="email-faint" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:13px;white-space:nowrap;color:#52525b;">${escapeHtml(costLabel(tier))}</td>
</tr>`
}

export interface CatalogChangeNotice {
  kind: "added" | "updated"
  /** The tiers that are new or were just edited — the email spotlights these. */
  tiers: CofounderModelTier[]
}

/**
 * Email every eligible founder about new/changed co-founder engines.
 * Returns { sent, failed } for the admin UI; never throws.
 */
export async function notifyCofounderCatalogChange(notice: CatalogChangeNotice): Promise<{ sent: number; failed: number }> {
  if (notice.tiers.length === 0) return { sent: 0, failed: 0 }
  try {
    const recipients = await (await usersCol())
      .find(
        { emailVerified: true, banned: { $ne: true }, suspended: { $ne: true } },
        { projection: { email: 1, name: 1 } },
      )
      .limit(5000)
      .toArray()

    const settingsUrl = `${getAppUrl()}/settings/ai`
    const names = notice.tiers.map((t) => t.name)
    const headline =
      notice.kind === "added"
        ? names.length === 1
          ? `New AI co-founder engine: ${names[0]}`
          : `${names.length} new AI co-founder engines`
        : names.length === 1
          ? `Your AI co-founder engine got an upgrade: ${names[0]}`
          : `${names.length} AI co-founder engines were upgraded`
    const intro =
      notice.kind === "added"
        ? "We just added new engines to your AI co-founder's lineup. Pick a mode in Settings — each one is a different strength, and the free ones never cost credits."
        : "We tuned the engines behind your AI co-founder. Your current pick still works — check Settings to see what's new and switch if something fits you better."

    const rows = notice.tiers.map(tierRow).join("")
    const subject = `Atai update — ${headline}`
    const tiersTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 20px 0;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
<tr>
<td class="email-faint" style="padding:10px 12px;background-color:#f8fafc;border-bottom:1px solid #e4e4e7;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#71717a;">Engine</td>
<td class="email-faint" style="padding:10px 12px;background-color:#f8fafc;border-bottom:1px solid #e4e4e7;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#71717a;">Strength</td>
<td class="email-faint" style="padding:10px 12px;background-color:#f8fafc;border-bottom:1px solid #e4e4e7;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#71717a;">Cost</td>
</tr>
${rows}
</table>`
    const bodyHtml = [
      emailParagraph("Hey there,"),
      emailParagraph(escapeHtml(intro)),
      tiersTable,
      emailButton(settingsUrl, "Choose your engine"),
      emailNote("Or open Settings → AI co-founder in the app. Switching takes one click and applies to your next message."),
    ].join("")
    const html = renderEmailShell({
      title: headline,
      preheader: intro,
      eyebrow: "Product update",
      heading: headline,
      bodyHtml,
      footerNote: "You received this because you have an Atai account.",
    })
    const text = `Hey there,\n\n${intro}\n\n${notice.tiers.map((t) => `- ${t.name}: ${t.strength} (${costLabel(t)})`).join("\n")}\n\nChoose your engine: ${settingsUrl}`

    let sent = 0
    let failed = 0
    // Chunked parallel sends — sequential SMTP would stall the admin request
    // for minutes on a large user base.
    const CHUNK = 10
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK)
      const results = await Promise.allSettled(
        chunk.map((u) => sendMail({ to: u.email, subject, html, text })),
      )
      for (const r of results) {
        if (r.status === "fulfilled") sent++
        else failed++
      }
    }
    logger.info("cofounder.notify", "catalog change email broadcast complete", {
      kind: notice.kind,
      tiers: names,
      sent,
      failed,
    })
    return { sent, failed }
  } catch (e) {
    logger.warn("cofounder.notify", "catalog change broadcast failed", {
      error: e instanceof Error ? e.message : String(e),
    })
    return { sent: 0, failed: 0 }
  }
}
