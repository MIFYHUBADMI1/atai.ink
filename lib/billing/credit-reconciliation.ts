/**
 * Phase A3 — credit balance integrity.
 *
 * The bucket records are the itemised truth for subscription credits; the
 * flat `subscriptionCredits` / `credits` fields are aggregates that must equal
 * their sum. This module finds historical drift (legacy flat-only accounts,
 * interrupted grants/expiries) and repairs the aggregates with an auditable
 * ledger entry. It never invents a bucket and never changes a bucket amount.
 *
 * @module lib/billing/credit-reconciliation
 */

import "server-only"
import type { ClientSession } from "mongodb"
import { usersCol } from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { recordLedgerEntry } from "@/lib/billing/credit-service"
import { logger } from "@/lib/logging/logger"
import type { CreditBucket } from "@/lib/types/db"

export type CreditIntegrityType =
  | "bucket_sum_mismatch"
  | "total_mismatch"
  | "negative_balance"
  | "overdue_buckets"

export interface CreditIntegrityFinding {
  userId: string
  type: CreditIntegrityType
  severity: "critical" | "warning" | "info"
  subscriptionCredits: number
  permanentCredits: number
  totalCredits: number
  bucketSum: number
  expectedSubscription: number
  expectedTotal: number
  overdueBucketIds: string[]
}

export interface CreditIntegrityUser {
  id: string
  credits?: number
  subscriptionCredits?: number
  permanentCredits?: number
  creditBuckets?: CreditBucket[]
}

export interface CreditRepairResult {
  userId: string
  repaired: boolean
  mirrorOnly: boolean
  before: { subscriptionCredits: number; permanentCredits: number; totalCredits: number; bucketSum: number }
  after: { subscriptionCredits: number; permanentCredits: number; totalCredits: number; bucketSum: number }
  findings: CreditIntegrityFinding[]
  ledgerEntryIds: string[]
}

function bucketSumOf(buckets: CreditBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.amount), 0)
}

/** Pure inspection, so the drift rules are testable without a database. */
export function inspectUserCreditIntegrity(
  user: CreditIntegrityUser,
  now = Date.now(),
): CreditIntegrityFinding[] {
  const buckets = user.creditBuckets ?? []
  const bucketSum = bucketSumOf(buckets)
  const subscriptionCredits = user.subscriptionCredits ?? 0
  const permanentCredits = user.permanentCredits ?? 0
  const totalCredits = user.credits ?? 0
  const hasPermanent = typeof user.permanentCredits === "number"
  const hasSplit =
    typeof user.subscriptionCredits === "number" && hasPermanent
  const expectedSubscription = buckets.length > 0 ? bucketSum : subscriptionCredits
  const expectedTotal = hasSplit ? expectedSubscription + permanentCredits : totalCredits
  const overdueBucketIds = buckets
    .filter((bucket) => bucket.expiresAt <= now)
    .map((bucket) => bucket.bucketId ?? `${bucket.subscriptionId}:${bucket.expiresAt}`)

  const findings: CreditIntegrityFinding[] = []
  const base = {
    userId: user.id,
    subscriptionCredits,
    permanentCredits,
    totalCredits,
    bucketSum,
    expectedSubscription,
    expectedTotal,
    overdueBucketIds,
  }

  if (buckets.length > 0 && bucketSum !== subscriptionCredits) {
    findings.push({ ...base, type: "bucket_sum_mismatch", severity: "critical" })
  }
  if (hasSplit && totalCredits !== expectedTotal) {
    findings.push({ ...base, type: "total_mismatch", severity: "warning" })
  }
  if (subscriptionCredits < 0 || permanentCredits < 0 || totalCredits < 0 || bucketSum < 0) {
    findings.push({ ...base, type: "negative_balance", severity: "critical" })
  }
  if (overdueBucketIds.length > 0) {
    findings.push({ ...base, type: "overdue_buckets", severity: "info" })
  }

  return findings
}

export async function auditCreditIntegrity(params: {
  userId?: string
  limit?: number
  now?: number
} = {}): Promise<{ scanned: number; findings: CreditIntegrityFinding[]; truncated: boolean }> {
  const users = await usersCol()
  const limit = Math.min(Math.max(1, params.limit ?? 250), 1000)
  const query = params.userId ? { id: params.userId } : {}
  const docs = await users
    .find(query, {
      projection: {
        id: 1,
        credits: 1,
        subscriptionCredits: 1,
        permanentCredits: 1,
        creditBuckets: 1,
      },
    })
    .limit(limit)
    .toArray()

  const findings = docs.flatMap((user) =>
    inspectUserCreditIntegrity(user as CreditIntegrityUser, params.now),
  )
  return { scanned: docs.length, findings, truncated: docs.length === limit }
}

/**
 * Align the flat aggregates with the bucket records. The bucket amounts are
 * never changed; the adjustment is written to the ledger with the actor and
 * reason so a repaired balance can always be explained.
 */
export async function repairCreditBalance(params: {
  userId: string
  actor: string
  reason: string
  now?: number
  session?: ClientSession
}): Promise<CreditRepairResult> {
  if (!params.actor.trim() || !params.reason.trim()) {
    throw new Error("A credit repair requires an actor and a reason")
  }
  if (params.session && !params.session.inTransaction()) {
    throw new Error("Credit repair requires an active transaction")
  }

  const users = await usersCol()
  const session = params.session ?? (await getMongoClient()).startSession()

  let result: CreditRepairResult = {
    userId: params.userId,
    repaired: false,
    mirrorOnly: false,
    before: { subscriptionCredits: 0, permanentCredits: 0, totalCredits: 0, bucketSum: 0 },
    after: { subscriptionCredits: 0, permanentCredits: 0, totalCredits: 0, bucketSum: 0 },
    findings: [],
    ledgerEntryIds: [],
  }

  const run = async () => {
    const user = await users.findOne({ id: params.userId }, { session })
    if (!user) throw new Error(`Credit repair: user ${params.userId} not found`)

    const findings = inspectUserCreditIntegrity(user as CreditIntegrityUser, params.now)
    const buckets: CreditBucket[] = user.creditBuckets ?? []
    const bucketSum = bucketSumOf(buckets)
    const before = {
      subscriptionCredits: user.subscriptionCredits ?? 0,
      permanentCredits: user.permanentCredits ?? 0,
      totalCredits: user.credits ?? 0,
      bucketSum,
    }

    // A legacy account with no buckets has no itemised truth to align to.
    const targetSubscription = buckets.length > 0 ? bucketSum : before.subscriptionCredits
    const hasPermanent = typeof user.permanentCredits === "number"
    const targetPermanent = before.permanentCredits
    // When the permanent field is absent, the legacy total may contain
    // permanent credits we cannot see. Follow the subscription correction and
    // leave the rest of the total alone instead of inventing a zero.
    const targetTotal = hasPermanent
      ? targetSubscription + targetPermanent
      : before.totalCredits + (targetSubscription - before.subscriptionCredits)
    const subscriptionDelta = targetSubscription - before.subscriptionCredits
    const permanentDelta = hasPermanent ? targetPermanent - before.permanentCredits : 0
    const totalDelta = targetTotal - before.totalCredits
    const after = {
      subscriptionCredits: targetSubscription,
      permanentCredits: targetPermanent,
      totalCredits: targetTotal,
      bucketSum,
    }

    if (subscriptionDelta === 0 && permanentDelta === 0 && totalDelta === 0) {
      result = { ...result, before, after, findings }
      return
    }

    const set: Record<string, number | string> = { updatedAt: params.now ?? Date.now() }
    if (subscriptionDelta !== 0) set.subscriptionCredits = targetSubscription
    if (permanentDelta !== 0) set.permanentCredits = targetPermanent
    if (totalDelta !== 0) set.credits = targetTotal
    await users.updateOne({ id: params.userId }, { $set: set }, { session })

    const ledgerEntryIds: string[] = []
    const metadata = {
      actor: params.actor,
      reason: params.reason,
      findingTypes: findings.map((finding) => finding.type),
      bucketSum,
      before,
      after,
    }

    if (subscriptionDelta !== 0) {
      const entry = await recordLedgerEntry({
        userId: params.userId,
        creditType: "subscription",
        amount: Math.abs(subscriptionDelta),
        direction: subscriptionDelta > 0 ? "credit" : "debit",
        transactionType: "credit_reconciliation",
        referenceType: "reconciliation",
        referenceId: params.userId,
        balanceBefore: before.subscriptionCredits,
        balanceAfter: targetSubscription,
        idempotencyKey: `credit_reconcile_${params.userId}_sub_${targetSubscription}_${targetPermanent}`,
        metadata,
        session,
      })
      ledgerEntryIds.push(entry.id)
    }

    if (permanentDelta !== 0) {
      const entry = await recordLedgerEntry({
        userId: params.userId,
        creditType: "permanent",
        amount: Math.abs(permanentDelta),
        direction: permanentDelta > 0 ? "credit" : "debit",
        transactionType: "credit_reconciliation",
        referenceType: "reconciliation",
        referenceId: params.userId,
        balanceBefore: before.permanentCredits,
        balanceAfter: targetPermanent,
        idempotencyKey: `credit_reconcile_${params.userId}_perm_${targetSubscription}_${targetPermanent}`,
        metadata,
        session,
      })
      ledgerEntryIds.push(entry.id)
    }

    result = {
      ...result,
      repaired: subscriptionDelta !== 0 || permanentDelta !== 0,
      mirrorOnly: subscriptionDelta === 0 && permanentDelta === 0 && totalDelta !== 0,
      before,
      after,
      findings,
      ledgerEntryIds,
    }

    logger.info("credit.reconciliation", "Credit aggregates repaired", {
      userId: params.userId,
      actor: params.actor,
      reason: params.reason,
      subscriptionDelta,
      permanentDelta,
      totalDelta,
      ledgerEntries: ledgerEntryIds.length,
    })
  }

  try {
    if (params.session) await run()
    else await session.withTransaction(run)
  } finally {
    if (!params.session) await session.endSession()
  }

  return result
}
