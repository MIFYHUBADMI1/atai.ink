/**
 * Claim-expiry notices.
 *
 * The 72h reservation is the anti-squatting rule, and it is silent by design —
 * which means a founder who gets interrupted loses the business without ever
 * being told the clock was running. This sweep emails the owner once before
 * the window closes, and once if it actually closes.
 */
import { businessDomainsCol, usersCol } from "@/lib/db/collections"
import { getAppUrl } from "@/lib/env"
import { sendMail } from "@/lib/email/mailer"
import { claimExpiryReminderEmail, claimReleasedEmail } from "@/lib/email/templates"
import { logger } from "@/lib/logging/logger"
import type { BusinessDomainDoc } from "@/lib/types/business-intake"

/** Wide enough that a daily run always catches a 72h window at least once. */
export const CLAIM_REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000
export const CLAIM_NOTICE_BATCH_SIZE = 50

export type ClaimNoticeReport = {
  remindersSent: number
  releasesSent: number
  failures: Array<{ domainId: string; hostname: string; kind: "reminder" | "release"; error: string }>
}

type Recipient = { email: string; name: string } | null

async function ownerOf(userId: string): Promise<Recipient> {
  const user = await (await usersCol()).findOne(
    { id: userId, deletedAt: { $exists: false }, banned: { $ne: true }, suspended: { $ne: true } },
    { projection: { email: 1, name: 1 } },
  )
  const email = typeof user?.email === "string" ? user.email : ""
  if (!email) return null
  const name = typeof user?.name === "string" && user.name.trim() ? user.name.trim().split(" ")[0] : "there"
  return { email, name }
}

export async function sendClaimNotices(input: {
  now?: number
  limit?: number
  /** Test seams. */
  send?: typeof sendMail
  lookupOwner?: (userId: string) => Promise<Recipient>
  appUrl?: string
} = {}): Promise<ClaimNoticeReport> {
  const now = input.now ?? Date.now()
  const limit = input.limit ?? CLAIM_NOTICE_BATCH_SIZE
  const send = input.send ?? sendMail
  const lookupOwner = input.lookupOwner ?? ownerOf
  const appUrl = input.appUrl ?? getAppUrl()
  const col = await businessDomainsCol()
  const report: ClaimNoticeReport = { remindersSent: 0, releasesSent: 0, failures: [] }

  const expiring = (await col
    .find({
      releasedAt: { $exists: false },
      verifiedAt: { $exists: false },
      claimReminderSentAt: { $exists: false },
      claimExpiresAt: { $gt: now, $lte: now + CLAIM_REMINDER_WINDOW_MS },
    })
    .sort({ claimExpiresAt: 1 })
    .limit(limit)
    .toArray()) as BusinessDomainDoc[]

  for (const doc of expiring) {
    const owner = await lookupOwner(doc.userId)
    if (!owner) {
      // No deliverable address: mark it so the sweep does not re-query forever.
      await col.updateOne({ id: doc.id }, { $set: { claimReminderSentAt: now } })
      continue
    }
    const hoursLeft = Math.max(1, Math.round(((doc.claimExpiresAt ?? now) - now) / 3_600_000))
    const template = claimExpiryReminderEmail(
      owner.name,
      doc.hostname,
      hoursLeft,
      `${appUrl}/project/${doc.projectId}/business`,
    )
    try {
      await send({ to: owner.email, ...template })
      await col.updateOne({ id: doc.id }, { $set: { claimReminderSentAt: now } })
      report.remindersSent += 1
    } catch (error) {
      report.failures.push({ domainId: doc.id, hostname: doc.hostname, kind: "reminder", error: String(error) })
    }
  }

  const released = (await col
    .find({
      expiredUnverified: true,
      claimExpiryNoticeSentAt: { $exists: false },
    })
    .sort({ releasedAt: 1 })
    .limit(limit)
    .toArray()) as BusinessDomainDoc[]

  for (const doc of released) {
    const owner = await lookupOwner(doc.userId)
    if (!owner) {
      await col.updateOne({ id: doc.id }, { $set: { claimExpiryNoticeSentAt: now } })
      continue
    }
    const template = claimReleasedEmail(
      owner.name,
      doc.hostname,
      `${appUrl}/project/${doc.projectId}/business`,
    )
    try {
      await send({ to: owner.email, ...template })
      await col.updateOne({ id: doc.id }, { $set: { claimExpiryNoticeSentAt: now } })
      report.releasesSent += 1
    } catch (error) {
      report.failures.push({ domainId: doc.id, hostname: doc.hostname, kind: "release", error: String(error) })
    }
  }

  logger.info("domain.claim_notices", "sweep finished", {
    remindersSent: report.remindersSent,
    releasesSent: report.releasesSent,
    failures: report.failures.length,
  })
  return report
}
