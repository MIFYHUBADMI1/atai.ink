import "server-only"

/**
 * Founder broadcast email when the AI co-founder engine catalog changes
 * (admin adds or edits a tier in /admin/cofounder-models). This is a
 * courtesy/marketing layer — delivery problems must NEVER fail the admin
 * action, so every failure is logged and swallowed. Sends go to verified,
 * non-banned accounts only.
 */

import { sendMail } from "@/lib/email/mailer"
import { usersCol } from "@/lib/db/collections"
import { getAppUrl } from "@/lib/env"
import { logger } from "@/lib/logging/logger"
import type { CofounderModelTier } from "./models"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function costLabel(tier: CofounderModelTier): string {
  return tier.creditsPerMessage === 0 ? "Free" : `${tier.creditsPerMessage} credits per message`
}

function tierRow(tier: CofounderModelTier): string {
  return `<tr>
<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;"><strong>${escapeHtml(tier.name)}</strong></td>
<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-size:13px;">${escapeHtml(tier.strength)}</td>
<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;white-space:nowrap;">${escapeHtml(costLabel(tier))}</td>
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
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#111827;">
<p style="font-size:15px;line-height:1.6;">Hey there,</p>
<p style="font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
<tr style="text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">
<th style="padding:8px 12px;">Engine</th><th style="padding:8px 12px;">Strength</th><th style="padding:8px 12px;">Cost</th>
</tr>
${rows}
</table>
<p style="font-size:15px;"><a href="${settingsUrl}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Choose your engine</a></p>
<p style="font-size:13px;color:#6b7280;">Or open Settings → AI co-founder in the app. Switching takes one click and applies to your next message.</p>
</div>`
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
