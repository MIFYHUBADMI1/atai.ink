/**
 * Daily sweep that expires overdue subscription credits across all accounts.
 *
 * The lazy path (expireOverdueBuckets on balance reads / consumption) covers
 * every account that shows up in the app, but an account that never logs in
 * after its period ends would otherwise keep its expired credits until its
 * next webhook. This sweep closes that gap; the Vercel cron
 * (`/api/admin/billing/credits/expire-sweep`, see vercel.json) calls it daily.
 *
 * Every debit goes through expireOverdueBuckets (credit-service) — the single
 * authority for balance mutation — so each removal is ledgered and idempotent.
 *
 * @module lib/billing/credit-sweep
 */
import "server-only"
import { usersCol } from "@/lib/db/collections"
import { expireOverdueBuckets, overdueCreditsFilter } from "@/lib/billing/credit-service"
import { logger } from "@/lib/logging/logger"

export interface ExpiredCreditsSweepReport {
  scanned: number
  usersExpired: number
  expiredBuckets: number
  expiredCredits: number
  errors: Array<{ userId: string; error: string }>
}

export async function sweepExpiredSubscriptionCredits(opts?: { now?: number }): Promise<ExpiredCreditsSweepReport> {
  const now = opts?.now ?? Date.now()
  const report: ExpiredCreditsSweepReport = {
    scanned: 0,
    usersExpired: 0,
    expiredBuckets: 0,
    expiredCredits: 0,
    errors: [],
  }

  const users = await usersCol()
  const batch = await users
    .find(overdueCreditsFilter(now), { projection: { id: 1 } })
    .toArray()
  report.scanned = batch.length

  for (const doc of batch) {
    if (!doc.id) continue
    try {
      const result = await expireOverdueBuckets({ userId: doc.id, now })
      if (result.expiredCredits > 0) {
        report.usersExpired += 1
        report.expiredCredits += result.expiredCredits
        report.expiredBuckets += result.expiredBuckets
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report.errors.push({ userId: doc.id, error: message })
    }
  }

  logger.info("billing.credit-sweep", "Expired-credits sweep complete", {
    scanned: report.scanned,
    usersExpired: report.usersExpired,
    expiredCredits: report.expiredCredits,
    expiredBuckets: report.expiredBuckets,
    errors: report.errors.length,
  })

  return report
}
