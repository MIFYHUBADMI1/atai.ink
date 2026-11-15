import "server-only"

import { createHash } from "node:crypto"
import { SITE_URL } from "@/lib/env"
import { logger } from "@/lib/logging/logger"
import { isResendConfigured, sendResendEmail } from "@/lib/email/resend"
import { getBlogSettings, listNewsletterAudience, recordCampaign, updateCampaign } from "@/lib/blog/store"
import { buildAnnouncementEmail, buildAnnouncementSubject } from "@/lib/blog/newsletter-template"
import { cryptoId } from "@/lib/store/id"
import type { BlogArticleDoc, BlogCampaignDoc, BlogNewsletterDoc } from "@/lib/blog/types"

/**
 * Atai Insights announcements — the newsletter broadcast.
 *
 * Publishing an article can announce it to everyone who asked for guides in
 * their inbox. The message goes out through Resend (the platform's mail
 * provider); nothing is sent when the provider is unconfigured, and the
 * outcome is reported literally — "sent" means the provider accepted every
 * message, never that a reader opened one.
 */

/** How many messages are in flight at once. */
const ANNOUNCE_CONCURRENCY = 5

type AnnouncementStatus = "sent" | "partial" | "failed" | "not-configured" | "skipped"

export interface AnnouncementResult {
  status: AnnouncementStatus
  /** Addresses the announcement was addressed to. */
  recipients: number
  sentCount: number
  failedCount: number
  /** Addresses on the list that had asked to stop hearing from us. */
  skippedCount: number
  /** Why nothing was sent, in plain words. */
  reason?: string
  /** The first provider error, for the admin log. */
  error?: string
  campaignId?: string
}

export function articleUrl(slug: string): string {
  return `${SITE_URL}/blog/${slug}`
}

export function unsubscribeUrl(subscriberId: string): string {
  return `${SITE_URL}/api/blog/newsletter/unsubscribe?id=${encodeURIComponent(subscriberId)}`
}

/**
 * A stable key per (article, address): re-publishing the same article cannot
 * deliver the same message twice, because Resend replays the first result for
 * a repeated idempotency key.
 */
function idempotencyKey(articleId: string, email: string): string {
  return `newsletter_${articleId}_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      await worker(item)
    }
  })
  await Promise.all(runners)
}

/**
 * Announce an article to the newsletter list.
 *
 * Best-effort by design: a mail failure never blocks a publish, it is
 * reported instead. `trigger: "publish"` honours the automatic-announcement
 * toggle; `trigger: "manual"` is an explicit admin action and always runs.
 */
export async function announceArticle(
  article: BlogArticleDoc,
  options: { trigger: "publish" | "manual"; adminId: string },
): Promise<AnnouncementResult> {
  const empty: AnnouncementResult = {
    status: "skipped",
    recipients: 0,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }

  if (options.trigger === "publish") {
    const settings = await getBlogSettings()
    if (!settings.newsletterAutoAnnounce) {
      return { ...empty, reason: "Automatic announcements are switched off in Content Studio settings." }
    }
  }

  const { recipients, unsubscribedCount } = await listNewsletterAudience()
  if (!recipients.length) {
    return { ...empty, skippedCount: unsubscribedCount, reason: "There are no subscribers to announce to." }
  }

  const subject = buildAnnouncementSubject(article.title)
  const campaignId = cryptoId()

  if (!isResendConfigured()) {
    const campaign = await recordCampaign({
      id: campaignId,
      articleId: article.id,
      slug: article.slug,
      title: article.title,
      subject,
      status: "not-configured",
      recipients: recipients.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: unsubscribedCount,
      error: "RESEND_API_KEY or RESEND_FROM_EMAIL is not set, so no message was attempted.",
      trigger: options.trigger,
      createdAtMs: Date.now(),
      createdBy: options.adminId,
    })
    return {
      status: "not-configured",
      recipients: recipients.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: unsubscribedCount,
      reason: "The mail provider is not configured, so nothing was sent.",
      campaignId: campaign.id,
    }
  }

  // The campaign is written before the first message goes out. If the request
  // is cut short mid-send, the admin still sees that a send was in flight
  // instead of an empty history, and the per-recipient idempotency key means
  // a repeat run cannot deliver the same message twice.
  await recordCampaign({
    id: campaignId,
    articleId: article.id,
    slug: article.slug,
    title: article.title,
    subject,
    status: "sending",
    recipients: recipients.length,
    sentCount: 0,
    failedCount: 0,
    skippedCount: unsubscribedCount,
    trigger: options.trigger,
    createdAtMs: Date.now(),
    createdBy: options.adminId,
  })

  let sentCount = 0
  let failedCount = 0
  let firstError: string | undefined

  await runWithConcurrency(recipients, ANNOUNCE_CONCURRENCY, async (recipient: BlogNewsletterDoc) => {
    const message = buildAnnouncementEmail({
      title: article.title,
      excerpt: article.excerpt || article.description,
      url: articleUrl(article.slug),
      unsubscribeUrl: unsubscribeUrl(recipient.id),
      category: article.category,
      readingMinutes: article.readingMinutes,
    })
    try {
      await sendResendEmail({
        to: recipient.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl(recipient.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Cone",
        },
        idempotencyKey: idempotencyKey(article.id, recipient.email),
      })
      sentCount += 1
    } catch (error) {
      failedCount += 1
      const messageText = error instanceof Error ? error.message : String(error)
      firstError ??= messageText
      logger.error("blog.newsletter", "announcement delivery failed", {
        articleId: article.id,
        message: messageText,
      })
    }
  })

  const status: AnnouncementStatus =
    failedCount === 0 ? "sent" : sentCount === 0 ? "failed" : "partial"

  await updateCampaign(campaignId, {
    status,
    sentCount,
    failedCount,
    ...(firstError ? { error: firstError } : {}),
  })

  return {
    status,
    recipients: recipients.length,
    sentCount,
    failedCount,
    skippedCount: unsubscribedCount,
    ...(firstError ? { error: firstError } : {}),
    campaignId,
  }
}
