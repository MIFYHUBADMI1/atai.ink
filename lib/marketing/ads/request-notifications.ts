import "server-only"

/**
 * Best-effort email notifications for advertising requests. Email is a
 * courtesy layer only: the derived in-product inbox (founder) and the
 * /admin/ads inbox (admin) are the canonical notification surfaces, so a
 * missing SMTP config or a delivery failure must NEVER fail a submission.
 */

import { sendMail } from "@/lib/email/mailer"
import { usersCol } from "@/lib/db/collections"
import { getAppUrl } from "@/lib/env"
import { logger } from "@/lib/logging/logger"
import type { AdCampaignRequestDoc } from "@/lib/types/ads"
import { AD_REQUEST_STATUS_LABELS, adminRequestPath, founderRequestPath } from "./request-shared"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function founderLink(request: AdCampaignRequestDoc): string {
  return `${getAppUrl()}${founderRequestPath(request.projectId, request.id)}`
}

function adminLink(request: AdCampaignRequestDoc): string {
  return `${getAppUrl()}${adminRequestPath(request.id)}`
}

const FOUNDER_COPY: Partial<Record<AdCampaignRequestDoc["status"], { subject: string; body: string }>> = {
  submitted: {
    subject: "We received your promotion request",
    body: "Atai's team will review it and prepare a proposal — nothing is published yet, and nothing has been charged.",
  },
  under_review: {
    subject: "Your promotion request is under review",
    body: "Atai's team is reviewing your business. You will hear from us when there is a proposal or a question.",
  },
  needs_info: {
    subject: "Atai needs more information about your promotion request",
    body: "Open the request to see what we need, and reply there. You do not need to submit a new request.",
  },
  awaiting_approval: {
    subject: "A quotation is ready for your promotion request",
    body: "Review the proposed campaign, price in Atai Credits, and estimated visibility. Estimates are not guaranteed results.",
  },
  awaiting_payment: {
    subject: "Approve payment for your Atai promotion",
    body: "You accepted the quotation. Confirm payment with Atai Credits to schedule the campaign. You will not be charged until you confirm.",
  },
  approved: {
    subject: "Your promotion is approved",
    body: "Payment succeeded. Atai's team will schedule and execute the campaign manually.",
  },
  scheduled: {
    subject: "Your promotion is scheduled",
    body: "Atai's team has scheduled the promotional work. You can follow progress on the campaign page.",
  },
  in_progress: {
    subject: "Your promotion is in progress",
    body: "Atai's team is executing the promotional activities you approved.",
  },
  paused: {
    subject: "Your promotion is paused",
    body: "Execution is paused. Open the campaign for the latest update from Atai's team.",
  },
  completed: {
    subject: "Your promotion is complete",
    body: "Atai's team has finished the promotional work. Review recorded results on the campaign page — they are as reported, not independently verified unless noted.",
  },
  rejected: {
    subject: "Atai cannot take this promotion request",
    body: "Open the request to read the explanation. Nothing was charged.",
  },
  cancelled: {
    subject: "Your promotion request was cancelled",
    body: "This campaign will not run. If you already paid, refunds go through the Atai Credits ledger.",
  },
  refunded: {
    subject: "Your promotion was refunded",
    body: "Atai Credits for this campaign have been returned through the existing ledger.",
  },
}

export async function notifyAdRequestSubmitted(input: {
  request: AdCampaignRequestDoc
  founderEmail: string
  founderName: string
}): Promise<void> {
  const { request, founderEmail, founderName } = input
  const link = founderLink(request)
  const name = escapeHtml(founderName || "there")
  const business = escapeHtml(request.business.name)

  try {
    await sendMail({
      to: founderEmail,
      subject: `We received your promotion request (${request.id})`,
      html: `<p>Hey ${name},</p>
<p>Your promotion request for <strong>${business}</strong> has been received. Atai's team will review it and prepare a proposal — nothing is published yet, and nothing has been charged.</p>
<p>Request ID: <strong>${request.id}</strong><br/>Status: Submitted</p>
<p><a href="${link}">View your request</a></p>`,
      text: `Hey ${founderName || "there"}, your promotion request for ${request.business.name} has been received (${request.id}). Atai's team will review it and prepare a proposal — nothing is published yet, and nothing has been charged. View it: ${link}`,
    })
  } catch (error) {
    logger.warn("marketing.ads.requests", "founder confirmation email failed (request saved)", {
      requestId: request.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  await notifyAdmins(request, `New promotion request: ${request.business.name}`)
}

export async function notifyAdRequestStatus(request: AdCampaignRequestDoc): Promise<void> {
  const copy = FOUNDER_COPY[request.status]
  if (!copy) return
  try {
    const founder = await (await usersCol()).findOne({ id: request.userId }, { projection: { email: 1, name: 1 } })
    if (!founder?.email) return
    const link = founderLink(request)
    const name = escapeHtml(founder.name || "there")
    const status = AD_REQUEST_STATUS_LABELS[request.status]
    await sendMail({
      to: founder.email,
      subject: `${copy.subject} (${request.id})`,
      html: `<p>Hey ${name},</p><p>${escapeHtml(copy.body)}</p><p>Status: <strong>${escapeHtml(status)}</strong></p><p><a href="${link}">View your request</a></p>`,
      text: `Hey ${founder.name || "there"}, ${copy.body} Status: ${status}. View: ${link}`,
    })
  } catch (error) {
    logger.warn("marketing.ads.requests", "status email failed", {
      requestId: request.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (request.status === "awaiting_payment" || request.status === "approved" || request.status === "needs_info") {
    await notifyAdmins(request, `Promotion ${request.id} is now ${AD_REQUEST_STATUS_LABELS[request.status]}`)
  }
}

async function notifyAdmins(request: AdCampaignRequestDoc, subject: string): Promise<void> {
  try {
    const admins = await (await usersCol())
      .find({ isAdmin: true }, { projection: { email: 1 } })
      .limit(10)
      .toArray()
    const business = escapeHtml(request.business.name)
    const link = adminLink(request)
    for (const admin of admins) {
      if (!admin.email) continue
      try {
        await sendMail({
          to: admin.email,
          subject,
          html: `<p>${escapeHtml(subject)}</p>
<p>Business: <strong>${business}</strong><br/>Request ID: ${request.id}<br/>Live URL: ${escapeHtml(request.business.liveUrl)}<br/>Status: ${escapeHtml(AD_REQUEST_STATUS_LABELS[request.status])}</p>
<p><a href="${link}">Open in the ads inbox</a></p>`,
          text: `${subject}. ${request.business.name} (${request.id}). Review: ${link}`,
        })
      } catch (error) {
        logger.warn("marketing.ads.requests", "admin notification email failed", {
          requestId: request.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    logger.warn("marketing.ads.requests", "admin lookup for notification failed", {
      requestId: request.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
