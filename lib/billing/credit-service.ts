/**
 * Atai — Unified Credit Service
 *
 * The SINGLE authoritative system for all credit operations.
 * No other file should directly mutate user credit balances.
 *
 * Operations:
 * - Check balances (total, subscription, permanent)
 * - Grant credits (signup, referral, purchase, subscription)
 * - Reserve credits (before builds)
 * - Consume credits (after successful builds)
 * - Release reservations (on failed builds)
 * - Expire subscription credits (at period end)
 * - Refund credits
 * - Record ledger transactions
 * - Calculate available balance
 *
 * @module lib/billing/credit-service
 */

import "server-only"
import { ObjectId, type ClientSession } from "mongodb"
import { usersCol, creditLedgerCol } from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { cryptoId } from "@/lib/store/id"
import { logger } from "@/lib/logging/logger"
import { planCreditConsumption } from "@/lib/billing/consume-plan"
import {
  PRICING_MODEL_VERSION,
  COST_MODEL_VERSION,
  CONSUMPTION_ORDER,
  CREDITS_PER_BASELINE_UNIT,
} from "./config"
import type { CreditType, LedgerTransactionType } from "./config"
import type { CreditLedgerEntry } from "./billing-types"

// ─── Balance Reading ─────────────────────────────────────────────────────────

export interface CreditBalance {
  total: number
  subscription: number
  permanent: number
}

/**
 * Get the user's credit balance, broken down by type.
 * Falls back to legacy `credits` field if new fields are not yet populated.
 * 
 * @param userId - The unique identifier of the user
 * @returns Promise resolving to a CreditBalance object with total, subscription, and permanent amounts
 * 
 * @remarks
 * This function handles the transition from legacy single-field credits to the new
 * dual-field system (subscriptionCredits + permanentCredits). If the new fields are
 * not yet populated, it falls back to the legacy `credits` field.
 * 
 * @example
 * ```typescript
 * const balance = await getBalance("user_123");
 * console.log(`Total: ${balance.total}, Subscription: ${balance.subscription}, Permanent: ${balance.permanent}`);
 * ```
 */
export async function getBalance(userId: string, session?: ClientSession): Promise<CreditBalance> {
  // Session-less reads (billing UI, preflight, admin views) first clear
  // overdue subscription buckets so the reported balance never includes
  // expired credits. In-transaction callers skip this — the transaction
  // owner (consumeCredits) sweeps explicitly before planning.
  if (!session) await expireOverdueBuckets({ userId })

  const users = await usersCol()
  const user = await users.findOne({ id: userId }, session ? { session } : {})

  if (!user) return { total: 0, subscription: 0, permanent: 0 }

  // Use new fields if available, otherwise fall back to legacy credits
  const subscription = user.subscriptionCredits ?? 0
  const permanent = user.permanentCredits ?? 0
  const newTotal = subscription + permanent
  const legacyCredits = user.credits ?? 0

  // If new fields are populated, use them; otherwise fall back to legacy
  const total = newTotal > 0 ? newTotal : legacyCredits

  // Log divergence for monitoring (don't auto-fix to avoid data corruption).
  // Structured logger only — no console.log PII (email) on this hot path:
  // it runs on every runtime preflight + every credit check (Phase 9.5 audit).
  if (newTotal > 0 && newTotal !== legacyCredits) {
    logger.warn("credit.balance", "Balance divergence detected", {
      userId,
      newTotal,
      legacyCredits,
      subscription,
      permanent,
    })
  }

  return { total, subscription, permanent }
}

/**
 * Get the total available credits (subscription + permanent).
 * This is what the rest of the app should use for credit checks.
 * 
 * @param userId - The unique identifier of the user
 * @returns Promise resolving to the total number of available credits
 * 
 * @remarks
 * This is the primary function for checking if a user has sufficient credits
 * for an operation. It automatically sums subscription and permanent credits.
 * 
 * @example
 * ```typescript
 * const available = await getAvailableCredits("user_123");
 * if (available >= 100) {
 *   // User has enough credits to proceed
 * }
 * ```
 */
export async function getAvailableCredits(userId: string): Promise<number> {
  const balance = await getBalance(userId)
  return balance.total
}

// ─── Ledger Operations ───────────────────────────────────────────────────────

/**
 * Normalize a project id for first-class ledger attribution.
 *
 * Only server-derived project context may be passed here (route handlers must
 * resolve ownership themselves — a client-supplied id is never trusted just
 * because it arrived in a request body). Empty/whitespace values are dropped
 * so account-level transactions legitimately carry no projectId.
 */
function normalizeProjectId(projectId?: string | null): string | undefined {
  if (typeof projectId !== "string") return undefined
  const trimmed = projectId.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, 128)
}

export async function recordLedgerEntry(params: {
  userId: string
  creditType: CreditType
  amount: number
  direction: "credit" | "debit"
  transactionType: LedgerTransactionType
  referenceType?: string
  referenceId?: string
  /** Original payment that funded this entry, when known (Phase A2). */
  paymentId?: string
  balanceBefore: number
  balanceAfter: number
  idempotencyKey: string
  metadata?: Record<string, unknown>
  session?: ClientSession
  projectId?: string
}): Promise<CreditLedgerEntry> {
  const col = await creditLedgerCol()
  const projectId = normalizeProjectId(params.projectId)
  const entry: CreditLedgerEntry = {
    _id: new ObjectId(),
    id: `ledger_${cryptoId()}`,
    userId: params.userId,
    // First-class optional project attribution (Phase 1). Absent for
    // account-level transactions, which remain fully valid without it.
    ...(projectId ? { projectId } : {}),
    creditType: params.creditType,
    amount: params.amount,
    direction: params.direction,
    transactionType: params.transactionType,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    ...(params.paymentId ? { paymentId: params.paymentId } : {}),
    balanceBefore: params.balanceBefore,
    balanceAfter: params.balanceAfter,
    idempotencyKey: params.idempotencyKey,
    pricingModelVersion: PRICING_MODEL_VERSION,
    costModelVersion: COST_MODEL_VERSION,
    metadata: params.metadata,
    createdAt: Date.now(),
  }

  try {
    await col.insertOne(entry, params.session ? { session: params.session } : {})
  } catch (err: unknown) {
    // E11000 = duplicate idempotency key — this is expected on retries
    if (err instanceof Error && /E11000|duplicate key/i.test(err.message)) {
      logger.info("credit.ledger", "Duplicate ledger entry (idempotent)", {
        idempotencyKey: params.idempotencyKey,
      })
      // Return the existing entry
      const existing = await col.findOne(
        { idempotencyKey: params.idempotencyKey },
        params.session ? { session: params.session } : {},
      )
      if (existing) return existing
    }
    throw err
  }

  return entry
}

// ─── Credit Grant Operations ─────────────────────────────────────────────────

/**
 * Grant credits to a user. Creates a ledger entry and updates the balance.
 * Always use idempotencyKey to prevent duplicate grants.
 * 
 * @param params - Grant credits parameters
 * @param params.userId - The unique identifier of the user
 * @param params.creditType - Type of credits: 'subscription' or 'permanent'
 * @param params.amount - Number of credits to grant (must be positive)
 * @param params.transactionType - Type of transaction (signup_bonus, referral_bonus, topup_grant, etc.)
 * @param params.idempotencyKey - Unique key to prevent duplicate grants (REQUIRED)
 * @param params.referenceType - Optional type of reference (e.g., 'payment', 'subscription')
 * @param params.referenceId - Optional reference identifier
 * @param params.metadata - Optional additional data (reason, description, etc.)
 * @returns Promise resolving to success status and the created/existing ledger entry
 * 
 * @remarks
 * **Idempotency:** This function is idempotent. If called multiple times with the same
 * idempotencyKey, only the first call will grant credits. Subsequent calls will return
 * the existing ledger entry without modifying the balance.
 * 
 * **Double-Entry Ledger:** This function creates a credit (positive) entry in the ledger
 * and increments both the type-specific balance field and the total credits field.
 * 
 * **Transaction Safety:** Uses MongoDB transactions to ensure atomicity. If the database
 * operation fails, no credits are granted and no ledger entry is created.
 * 
 * **Error Handling:** 
 * - Throws if the user does not exist
 * - Throws on database errors (except duplicate key for idempotency)
 * - Never throws on duplicate idempotency key (returns existing entry instead)
 * 
 * @example
 * ```typescript
 * // Grant signup bonus
 * const result = await grantCredits({
 *   userId: "user_123",
 *   creditType: "permanent",
 *   amount: 50,
 *   transactionType: "signup_bonus",
 *   idempotencyKey: `signup_user_123`,
 *   metadata: { reason: "Welcome bonus after email verification" }
 * });
 * 
 * // Grant referral reward
 * const referralResult = await grantCredits({
 *   userId: "user_456",
 *   creditType: "permanent",
 *   amount: 25,
 *   transactionType: "referral_bonus",
 *   idempotencyKey: `referral_user_456_from_user_123`,
 *   referenceType: "referral",
 *   referenceId: "referral_789",
 *   metadata: { reason: "Referral bonus", referredBy: "user_123" }
 * });
 * ```
 */
export async function grantCredits(params: {
  userId: string
  creditType: CreditType
  amount: number
  transactionType: LedgerTransactionType
  idempotencyKey: string
  referenceType?: string
  referenceId?: string
  metadata?: Record<string, unknown>
  /** Trusted server-derived project context, persisted on the ledger entry. */
  projectId?: string
  session?: ClientSession
}): Promise<{ success: boolean; ledgerEntry: CreditLedgerEntry }> {
  if (params.session && !params.session.inTransaction()) throw new Error("Credit grants require an active transaction")
  const users = await usersCol()
  const field = params.creditType === "subscription" ? "subscriptionCredits" : "permanentCredits"

  const client = getMongoClient
  const session = params.session ?? (await client()).startSession()

  try {
    let ledgerEntry: CreditLedgerEntry | null = null
    let success = false
    let newBalance = 0

    const grant = async () => {
      // Check for duplicate (idempotency)
      const existingLedger = await (await creditLedgerCol()).findOne(
        { idempotencyKey: params.idempotencyKey },
        { session },
      )
      if (existingLedger) {
        ledgerEntry = existingLedger
        success = true
        return
      }

      // Read the balance INSIDE the transaction so the ledger's
      // balanceBefore/balanceAfter describe the state this grant actually
      // applied to. Reading it before the transaction opened let two
      // concurrent grants record the same "before" snapshot.
      const balance = await getBalance(params.userId, session)
      newBalance = balance.total + params.amount

      // Update user balance (grant — no $gte needed, but idempotency check above prevents duplicates)
      const updateResult = await users.updateOne(
        { id: params.userId },
        {
          $inc: { [field]: params.amount, credits: params.amount },
          $set: { updatedAt: Date.now() },
        },
        { session },
      )

      // The user must exist. `updateOne` matching nothing means the credit
      // was granted to nobody — writing the ledger entry anyway created a
      // phantom entry for a non-existent account (and made admin grants
      // report success for a user id that was never registered).
      if (updateResult.matchedCount === 0) {
        throw new Error(`Cannot grant credits: user ${params.userId} does not exist`)
      }

      // Record ledger entry
      ledgerEntry = await recordLedgerEntry({
        userId: params.userId,
        creditType: params.creditType,
        amount: params.amount,
        direction: "credit",
        transactionType: params.transactionType,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        balanceBefore: balance.total,
        balanceAfter: newBalance,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata,
        session,
        projectId: params.projectId,
      })

      success = true
    }
    if (params.session) await grant()
    else await session.withTransaction(grant)

    if (!params.session && success && ledgerEntry) {
      logger.info("credit.grant", "Credits granted", {
        userId: params.userId,
        creditType: params.creditType,
        amount: params.amount,
        transactionType: params.transactionType,
        newBalance,
      })
    }

    return { success, ledgerEntry: ledgerEntry! }
  } finally {
    if (!params.session) await session.endSession()
  }
}

// ─── Credit Consumption ──────────────────────────────────────────────────────

/**
 * Consume credits from a user's balance.
 * 
 * @param params - Consume credits parameters
 * @param params.userId - The unique identifier of the user
 * @param params.amount - Number of credits to consume (must be positive)
 * @param params.transactionType - Type of transaction (build_consumption, etc.)
 * @param params.idempotencyKey - Unique key to prevent duplicate consumptions (REQUIRED)
 * @param params.referenceType - Optional type of reference (e.g., 'build')
 * @param params.referenceId - Optional reference identifier (e.g., build ID)
 * @param params.metadata - Optional additional data
 * @returns Promise resolving to success status and ledger entry, or failure details
 * 
 * @remarks
 * **Credit Consumption Order:** Credits are consumed in the order defined by CONSUMPTION_ORDER:
 * 1. Subscription credits (oldest expiring first, based on expiresAt)
 * 2. Permanent credits
 * 
 * This ensures subscription credits are used before they expire, maximizing value for users.
 * 
 * **Idempotency:** Like grantCredits, this function is idempotent. Duplicate calls with the
 * same idempotencyKey will not consume additional credits.
 * 
 * **Insufficient Balance:** If the user doesn't have enough credits, the function returns
 * `{ success: false }` with `insufficientBalance: true`. No partial consumption occurs.
 * 
 * **Transaction Safety:** Uses MongoDB transactions to ensure atomicity. Either all credits
 * are consumed and the ledger entry is created, or nothing happens.
 * 
 * **Error Handling:**
 * - Returns `{ success: false, insufficientBalance: true }` if not enough credits
 * - Throws on database errors (except duplicate key for idempotency)
 * - Never throws on duplicate idempotency key
 * 
 * @example
 * ```typescript
 * // Consume credits for a build
 * const result = await consumeCredits({
 *   userId: "user_123",
 *   amount: 15,
 *   transactionType: "build_consumption",
 *   idempotencyKey: `build_consumption_${buildId}`,
 *   referenceType: "build",
 *   referenceId: buildId,
 *   metadata: { complexity: "medium", projectId }
 * });
 * 
 * if (!result.success && result.insufficientBalance) {
 *   // User doesn't have enough credits
 *   throw new Error("Insufficient credits");
 * }
 * ```
 */
export async function consumeCredits(params: {
  userId: string
  amount: number
  transactionType: LedgerTransactionType
  idempotencyKey: string
  referenceType?: string
  referenceId?: string
  metadata?: Record<string, unknown>
  /** Trusted server-derived project context, persisted on every ledger entry. */
  projectId?: string
}): Promise<{
  success: boolean
  subscriptionConsumed: number
  permanentConsumed: number
}> {
  const users = await usersCol()
  const client = getMongoClient
  const mongoClient = await client()
  const session = mongoClient.startSession()

  let subConsumed = 0
  let permConsumed = 0
  let bucketDeductions: Array<{ subscriptionId: string; bucketId?: string; deduct: number; newAmount: number }> = []

  try {
    let success = false

    await session.withTransaction(async () => {
      // Idempotency check — consumeCredits writes SUFFIXED keys (`${key}_sub`
      // and/or `${key}_perm`), so the base key alone is NOT proof of prior
      // consumption: a replay must check the suffixed keys too, or a duplicate
      // call could debit the balance a second time (ledger insert would then
      // fail with E11000 — after the money already moved). Any existing
      // suffixed entry proves this billable event was already processed.
      const ledger = await creditLedgerCol()
      const existingLedger = await ledger.findOne(
        { idempotencyKey: { $in: [params.idempotencyKey, `${params.idempotencyKey}_sub`, `${params.idempotencyKey}_perm`] } },
        { session },
      )
      if (existingLedger) {
        success = true
        return
      }

      // Expire overdue subscription buckets BEFORE planning so expired credits
      // can never fund a consumption and the flat balance matches what is
      // actually spendable in this transaction.
      await expireOverdueBuckets({ userId: params.userId, session })

      const fresh = await users.findOne({ id: params.userId }, { session })
      if (!fresh) {
        success = false
        return
      }
      const plan = planCreditConsumption(
        {
          credits: fresh.credits,
          subscriptionCredits: fresh.subscriptionCredits,
          permanentCredits: fresh.permanentCredits,
          creditBuckets: fresh.creditBuckets,
        },
        params.amount,
        Date.now(),
      )
      if (!plan.ok) {
        logger.warn("credit.consume", "Insufficient credits", {
          userId: params.userId,
          requested: params.amount,
          available: plan.available,
        })
        success = false
        return
      }
      subConsumed = plan.subConsumed
      permConsumed = plan.permConsumed
      bucketDeductions = plan.bucketDeductions
      const balance = plan.balance

      // Build the flat-field update
      const filter: Record<string, unknown> = { id: params.userId, credits: { $gte: params.amount } }
      const updateOps: Record<string, unknown> = {
        $inc: { credits: -params.amount },
        $set: { updatedAt: Date.now() },
      }
      if (subConsumed > 0) {
        (updateOps.$inc as Record<string, number>).subscriptionCredits = -subConsumed
      }
      if (permConsumed > 0) {
        (updateOps.$inc as Record<string, number>).permanentCredits = -permConsumed
      }

      const result = await users.updateOne(filter, updateOps, { session })
      if (result.modifiedCount === 0) {
        success = false
        return
      }

      // Update individual bucket amounts (set each bucket's new amount)
      // We do this as a separate update since MongoDB doesn't support
      // updating array elements by a filter in the same operation.
      if (bucketDeductions.length > 0) {
        for (const { subscriptionId, bucketId, newAmount, deduct } of bucketDeductions) {
          if (newAmount <= 0) {
            // Bucket fully consumed — remove exactly this bucket. Keying on the
            // unique bucketId keeps sibling buckets of the same subscription
            // (annual: up to 12 monthly buckets) intact.
            await users.updateOne(
              { id: params.userId },
              { $pull: { creditBuckets: bucketId ? { bucketId } : { subscriptionId } } as Record<string, unknown> },
              { session },
            )
          } else {
            // Partially consumed — update the amount
            await users.updateOne(
              {
                id: params.userId,
                [`creditBuckets.${bucketId ? "bucketId" : "subscriptionId"}`]: bucketId ?? subscriptionId,
              },
              { $inc: { "creditBuckets.$.amount": -deduct } },
              { session },
            )
          }
        }
      }

      // Record ledger entries — use actual computed balances
      const newSubBalance = balance.subscription - subConsumed
      const newPermBalance = balance.permanent - permConsumed

      if (subConsumed > 0) {
        await recordLedgerEntry({
          userId: params.userId,
          creditType: "subscription",
          amount: subConsumed,
          direction: "debit",
          transactionType: params.transactionType,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          balanceBefore: balance.subscription,
          balanceAfter: newSubBalance,
          idempotencyKey: `${params.idempotencyKey}_sub`,
          metadata: params.metadata,
          session,
          projectId: params.projectId,
        })
      }

      if (permConsumed > 0) {
        await recordLedgerEntry({
          userId: params.userId,
          creditType: "permanent",
          amount: permConsumed,
          direction: "debit",
          transactionType: params.transactionType,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          balanceBefore: balance.permanent,
          balanceAfter: newPermBalance,
          idempotencyKey: `${params.idempotencyKey}_perm`,
          metadata: params.metadata,
          session,
          projectId: params.projectId,
        })
      }

      // Legacy/diverged balances: when the debited amount came ENTIRELY from
      // the flat legacy `credits` field (no buckets, no subscription/permanent
      // split — e.g. accounts predating the dual-field ledger), the two
      // entries above would both be skipped. The debit itself is real, so the
      // ledger MUST still record it — the double-entry invariant and the
      // idempotency guarantee both depend on every debit having an entry:
      // without one, a retried idempotency key would debit the balance AGAIN
      // (no entry to prove prior consumption) and the charge would be
      // invisible to financial reconciliation (Phase 9.5 audit CRITICAL fix).
      // Recorded against "permanent" (the ledger's durable bucket) with the
      // BASE idempotency key — the replay guard above checks [base, _sub,
      // _perm], so a replay of this billable event can never re-debit.
      if (subConsumed === 0 && permConsumed === 0) {
        await recordLedgerEntry({
          userId: params.userId,
          creditType: "permanent",
          amount: params.amount,
          direction: "debit",
          transactionType: params.transactionType,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          balanceBefore: balance.total,
          balanceAfter: balance.total - params.amount,
          idempotencyKey: params.idempotencyKey,
          metadata: { ...params.metadata, legacyBalanceDebit: true },
          session,
          projectId: params.projectId,
        })
      }

      success = true
    })

    if (success) {
      logger.info("credit.consume", "Credits consumed (oldest-first)", {
        userId: params.userId,
        amount: params.amount,
        subscriptionConsumed: subConsumed,
        permanentConsumed: permConsumed,
        bucketsUsed: bucketDeductions.length,
        transactionType: params.transactionType,
      })
    }

    return { success, subscriptionConsumed: subConsumed, permanentConsumed: permConsumed }
  } finally {
    await session.endSession()
  }
}

// ─── Reservation Operations ──────────────────────────────────────────────────

/**
 * Reserve credits before a build. This debits credits atomically.
 * Use releaseReservation to refund if the build doesn't proceed.
 * 
 * @param params - Reservation parameters
 * @param params.userId - The unique identifier of the user
 * @param params.projectId - The project ID for the build
 * @param params.buildId - The build ID being reserved for
 * @param params.complexity - Build complexity level
 * @param params.creditCost - Number of credits to reserve
 * @param params.idempotencyKey - Unique key to prevent duplicate reservations
 * @returns Promise resolving to the created ledger entry
 * 
 * @throws {InsufficientCreditsError} If user doesn't have enough credits
 * @throws {Error} On database errors
 * 
 * @remarks
 * **Purpose:** Reservations prevent race conditions when multiple builds are triggered.
 * Credits are immediately debited, ensuring they can't be double-spent.
 * 
 * **Release:** If the build fails or is cancelled, call `releaseReservation` to refund
 * the reserved credits. If the build succeeds, the reservation is already accounted for
 * (no additional action needed).
 * 
 * **Idempotency:** Safe to retry on network failures. Duplicate idempotency keys will
 * return the existing reservation without double-charging.
 * 
 * @example
 * ```typescript
 * try {
 *   await reserveCredits({
 *     userId: "user_123",
 *     projectId: "project_456",
 *     buildId: "build_789",
 *     complexity: "medium",
 *     creditCost: 15,
 *     idempotencyKey: `reservation_build_789`
 *   });
 * } catch (error) {
 *   if (error.message.includes("Insufficient credits")) {
 *     // Handle insufficient balance
 *   }
 * }
 * ```
 */
export async function reserveCredits(params: {
  userId: string
  amount: number
  buildId: string
  reason: string
  metadata?: Record<string, unknown>
  /** Trusted server-derived project context, persisted on the ledger entries. */
  projectId?: string
}): Promise<boolean> {
  const result = await consumeCredits({
    userId: params.userId,
    amount: params.amount,
    transactionType: "build_reservation",
    idempotencyKey: `reserve_${params.buildId}`,
    referenceType: "build",
    referenceId: params.buildId,
    metadata: { ...params.metadata, reason: params.reason },
    projectId: params.projectId,
  })
  return result.success
}

/**
 * Release a reservation (refund credits for failed/cancelled builds).
 * Credits are released to permanent bucket since we can't guarantee
 * the original subscription period is still active.
 */
export async function releaseReservation(params: {
  userId: string
  amount: number
  buildId: string
  reason: string
  subscriptionConsumed?: number
  permanentConsumed?: number
  metadata?: Record<string, unknown>
  /** Trusted server-derived project context, persisted on the ledger entry. */
  projectId?: string
}): Promise<boolean> {
  // If we know the exact bucket breakdown from the reservation, release to permanent
  // (subscription credits may have expired by the time the build fails)
  const result = await grantCredits({
    userId: params.userId,
    creditType: "permanent",
    amount: params.amount,
    transactionType: "build_release",
    idempotencyKey: `release_${params.buildId}`,
    referenceType: "build",
    referenceId: params.buildId,
    projectId: params.projectId,
    metadata: {
      ...params.metadata,
      reason: params.reason,
      subscriptionConsumed: params.subscriptionConsumed,
      permanentConsumed: params.permanentConsumed,
    },
  })
  return result.success
}

// ─── Subscription Credit Operations ──────────────────────────────────────────

/**
 * Grant subscription credits for a new billing period.
 * Idempotent per subscription per billing period (keyed on periodEnd).
 *
 * Uses periodEnd (next_billing_date from Dodo) as the idempotency key
 * component — this is the same value whether the grant comes from
 * subscription.active or subscription.renewed for the same period,
 * so duplicate events from Dodo are safely deduplicated regardless of
 * when they arrive or what periodStart value was used.
 *
 * The credit grant AND bucket creation happen in a single transaction
 * so they can never be out of sync.
 */
export async function grantSubscriptionCredits(params: {
  userId: string
  amount: number
  subscriptionId: string
  planId: string
  periodStart: number
  periodEnd: number
  metadata?: Record<string, unknown>
}): Promise<boolean> {
  // Key on periodEnd (day-epoch) so both subscription.active and
  // subscription.renewed for the same billing period produce the same key.
  const periodEndDay = Math.floor(params.periodEnd / 86400000)
  const idempotencyKey = `sub_grant_${params.subscriptionId}_period_${periodEndDay}`

  // Idempotency check first — don't double-grant
  const ledger = await creditLedgerCol()
  const existing = await ledger.findOne({ idempotencyKey })
  if (existing) {
    logger.info("credit.grant", "Subscription grant already recorded (idempotent)", { idempotencyKey })
    return true
  }

  const users = await usersCol()
  const now = Date.now()
  const newBucket: import("@/lib/types/db").CreditBucket = {
    bucketId: `bucket_${cryptoId()}`,
    subscriptionId: params.subscriptionId,
    planId: params.planId,
    amount: params.amount,
    originalAmount: params.amount,
    expiresAt: params.periodEnd,
    createdAt: now,
  }

  const client = getMongoClient
  const mongoClient = await client()
  const session = mongoClient.startSession()

  try {
    let success = false
    let applied = false
    let grantedBalanceAfter = 0

    await session.withTransaction(async () => {
      // Re-check idempotency inside the transaction to prevent races
      const existingInTxn = await (await creditLedgerCol()).findOne(
        { idempotencyKey: idempotencyKey },
        { session },
      )
      if (existingInTxn) {
        logger.info("credit.grant", "Subscription grant already recorded (idempotent, in transaction)", { idempotencyKey })
        success = true
        return
      }

      // Read the balance inside the transaction. The grant's ledger entry must
      // describe the state it actually applied to; a pre-transaction read can
      // be stale when a renewal, consumption or reversal commits first.
      const freshUser = await users.findOne({ id: params.userId }, { session })
      if (!freshUser) {
        throw new Error(`Cannot grant subscription credits: user ${params.userId} does not exist`)
      }
      const balanceBefore = freshUser.subscriptionCredits ?? 0
      const totalBefore = freshUser.credits ?? 0
      const balanceAfter = balanceBefore + params.amount
      const totalAfter = totalBefore + params.amount

      // Grant the credits (increment flat fields). Without this matchedCount
      // guard, a grant for a deleted/never-registered user id would still
      // write the bucket below ($push upserts a phantom doc) and the ledger.
      const grantResult = await users.updateOne(
        { id: params.userId },
        {
          $inc: { subscriptionCredits: params.amount, credits: params.amount },
          $set: { updatedAt: now },
        },
        { session },
      )
      if (grantResult.matchedCount === 0) {
        throw new Error(`Cannot grant subscription credits: user ${params.userId} does not exist`)
      }

      // Push the new bucket — in the SAME transaction so grant + bucket are atomic
      await users.updateOne(
        { id: params.userId },
        {
          $push: { creditBuckets: newBucket } as Record<string, unknown>,
          $set: {
            subscriptionPeriodStart: params.periodStart,
            subscriptionPeriodEnd: params.periodEnd,
          },
        },
        { session },
      )

      // Record ledger entry
      await recordLedgerEntry({
        userId: params.userId,
        creditType: "subscription",
        amount: params.amount,
        direction: "credit",
        transactionType: "subscription_grant",
        referenceType: "subscription",
        referenceId: params.subscriptionId,
        balanceBefore,
        balanceAfter,
        idempotencyKey,
        metadata: {
          ...params.metadata,
          planId: params.planId,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
          bucketId: newBucket.bucketId,
          totalBalanceBefore: totalBefore,
          totalBalanceAfter: totalAfter,
        },
        session,
      })

      grantedBalanceAfter = balanceAfter
      applied = true
      success = true
    })

    if (success && applied) {
      logger.info("credit.grant", "Subscription credits granted (with bucket)", {
        userId: params.userId,
        amount: params.amount,
        subscriptionId: params.subscriptionId,
        planId: params.planId,
        newBalance: grantedBalanceAfter,
      })
    }

    return success
  } finally {
    await session.endSession()
  }
}

/**
 * Expire ALL credit buckets belonging to one subscription (webhook-driven:
 * renewal or subscription.expired). Annual subscriptions own up to 12 monthly
 * buckets under the same subscription id, so a first-bucket-only match would
 * strand the sweep-granted buckets — every bucket of this subscription is
 * removed together; the old period's leftovers die here and the renewal
 * grants the fresh purse afterwards.
 *
 * Only accounts granted before the bucket model existed (no buckets at all)
 * fall back to expiring the full flat subscription balance — an account with
 * buckets from OTHER subscriptions keeps those untouched.
 *
 * Idempotent — safe to call multiple times with the same params.
 */
export async function expireSubscriptionCredits(params: {
  userId: string
  subscriptionId: string
  periodStart?: number
  /**
   * Only remove buckets that have reached this timestamp. A renewal passes
   * the renewal time so a month granted concurrently by the annual sweep is
   * not pulled out from under its own ledger entry. Omit to expire the whole
   * subscription (subscription.expired).
   */
  expiresAtOrBefore?: number
  metadata?: Record<string, unknown>
}): Promise<boolean> {
  const users = await usersCol()
  const expiryCutoff = params.expiresAtOrBefore
  const client = getMongoClient
  const mongoClient = await client()
  const session = mongoClient.startSession()

  try {
    let success = false

    await session.withTransaction(async () => {
      // Read everything this expiry depends on inside the transaction. A
      // pre-transaction read could describe a bucket that a concurrent grant,
      // consumption or reversal has already changed.
      const freshUser = await users.findOne({ id: params.userId }, { session })
      if (!freshUser) {
        success = false
        return
      }

      const freshBuckets: import("@/lib/types/db").CreditBucket[] = freshUser.creditBuckets ?? []
      const freshLegacyFlat = freshBuckets.length === 0
      const freshOwnBuckets = freshBuckets.filter(
        (b) =>
          b.subscriptionId === params.subscriptionId &&
          (expiryCutoff === undefined || b.expiresAt <= expiryCutoff),
      )
      const freshBalance = await getBalance(params.userId, session)
      if (freshBalance.subscription <= 0) {
        success = true
        return
      }

      const freshAmount = Math.min(
        freshLegacyFlat ? freshBalance.subscription : freshOwnBuckets.reduce((sum, b) => sum + b.amount, 0),
        freshBalance.subscription,
      )

      // Stable idempotency key — include periodStart when available so renewals
      // for different periods produce different keys.
      const idempotencyKey = params.periodStart
        ? `sub_expire_${params.subscriptionId}_${Math.floor(params.periodStart / 86400000)}`
        : freshLegacyFlat
          ? `sub_expire_${params.subscriptionId}`
          : `sub_expire_bucket_${freshOwnBuckets
              .map((b) => b.bucketId ?? `${b.subscriptionId}_${Math.floor(b.expiresAt / 86400000)}`)
              .sort()
              .join(",")}`

      const existingLedger = await (await creditLedgerCol()).findOne({ idempotencyKey }, { session })
      if (existingLedger) {
        logger.info("credit.expire", "Expiration already recorded (idempotent)", { idempotencyKey })
        success = true
        return
      }

      if (freshAmount <= 0) {
        // No bucket of this subscription remains. Do not write a no-op ledger
        // for accounts that never had one; a raced-away bucket still marks the
        // key so a webhook retry does not loop.
        if (freshOwnBuckets.length === 0 && !freshLegacyFlat) {
          success = true
          return
        }
        // Nothing to expire (buckets already consumed/swept or balance is 0)
        // Record a no-op ledger entry to mark the idempotency key as used
        await recordLedgerEntry({
          userId: params.userId,
          creditType: "subscription",
          amount: 0,
          direction: "debit",
          transactionType: "subscription_expiration",
          referenceType: "subscription",
          referenceId: params.subscriptionId,
          balanceBefore: freshBalance.subscription,
          balanceAfter: freshBalance.subscription,
          idempotencyKey,
          metadata: { ...params.metadata, expiredAmount: 0, hadBucket: !freshLegacyFlat, reason: "no_credits_to_expire" },
          session,
        })
        success = true
        return
      }

      // Debit subscriptionCredits by the expired amount (never the full balance
      // when other subscriptions' buckets are present)
      const filter = { id: params.userId, subscriptionCredits: { $gte: freshAmount } }
      const updateOps: Record<string, unknown> = {
        $inc: { subscriptionCredits: -freshAmount, credits: -freshAmount },
        $set: { updatedAt: Date.now() },
      }

      // Remove every bucket of THIS subscription (annual: up to 12)
      if (freshOwnBuckets.length > 0) {
        ;(updateOps as Record<string, unknown>).$pull = {
          creditBuckets:
            expiryCutoff === undefined
              ? { subscriptionId: params.subscriptionId }
              : { subscriptionId: params.subscriptionId, expiresAt: { $lte: expiryCutoff } },
        }
      }

      const result = await users.updateOne(filter, updateOps, { session })
      if (result.modifiedCount === 0) {
        // Either the user doesn't exist or subscriptionCredits < amount (race condition)
        // Record the idempotency key anyway to prevent retry loops
        await recordLedgerEntry({
          userId: params.userId,
          creditType: "subscription",
          amount: freshAmount,
          direction: "debit",
          transactionType: "subscription_expiration",
          referenceType: "subscription",
          referenceId: params.subscriptionId,
          balanceBefore: freshBalance.subscription,
          balanceAfter: freshBalance.subscription,
          idempotencyKey,
          metadata: { ...params.metadata, expiredAmount: freshAmount, hadBucket: !freshLegacyFlat, reason: "update_failed" },
          session,
        })
        success = true
        return
      }

      await recordLedgerEntry({
        userId: params.userId,
        creditType: "subscription",
        amount: freshAmount,
        direction: "debit",
        transactionType: "subscription_expiration",
        referenceType: "subscription",
        referenceId: params.subscriptionId,
        balanceBefore: freshBalance.subscription,
        balanceAfter: freshBalance.subscription - freshAmount,
        idempotencyKey,
        metadata: {
          ...params.metadata,
          expiredAmount: freshAmount,
          expiredBuckets: freshOwnBuckets.length,
          hadBucket: !freshLegacyFlat,
        },
        session,
      })

      success = true
    })

    return success
  } finally {
    await session.endSession()
  }
}

// ─── Overdue Expiry Sweep ────────────────────────────────────────────────────

/**
 * Grace window before legacy flat subscription credits (accounts granted
 * before the bucket model existed) are expired by their stale
 * subscriptionPeriodEnd. Shields against a renewal whose webhook/grant is
 * still in flight when the period end passes.
 */
export const LEGACY_FLAT_EXPIRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Mongo filter matching any user document that holds expired subscription
 * credits: a bucket whose expiresAt has passed, or a legacy bucket-less
 * account whose subscription period ended beyond the grace window.
 * Shared by the lazy sweep (getBalance/consumeCredits) and the daily cron.
 */
export function overdueCreditsFilter(now: number): Record<string, unknown> {
  return {
    $or: [
      { "creditBuckets.expiresAt": { $lte: now } },
      {
        creditBuckets: { $in: [null, []] },
        subscriptionCredits: { $gt: 0 },
        subscriptionPeriodEnd: { $lt: now - LEGACY_FLAT_EXPIRY_GRACE_MS },
      },
    ],
  }
}

/**
 * Remove the user's expired credit buckets and debit the flat fields by what
 * they still held. Runs lazily on every session-less balance read (getBalance)
 * and at the top of every consumption, so expired subscription credits can
 * never be reported or spent; the daily cron sweep uses the same function for
 * accounts that never trigger a read.
 *
 * Idempotent: one ledger entry per expired bucket, keyed on the bucket's
 * identity (bucketId, or subscriptionId+expiry-day for pre-bucketId grants).
 * The legacy bucket-less path keys on the stale period end.
 */
export async function expireOverdueBuckets(params: {
  userId: string
  now?: number
  session?: ClientSession
  metadata?: Record<string, unknown>
}): Promise<{ expiredCredits: number; expiredBuckets: number }> {
  const now = params.now ?? Date.now()
  const users = await usersCol()

  if (!params.session) {
    // Fast path: the overwhelming majority of reads have nothing overdue —
    // one cheap probe, no transaction. Work found here is re-verified inside
    // the transaction below.
    const probe = await users.findOne(
      { id: params.userId, ...overdueCreditsFilter(now) },
      { projection: { id: 1 } },
    )
    if (!probe) return { expiredCredits: 0, expiredBuckets: 0 }
  }

  const client = getMongoClient
  const session = params.session ?? (await client()).startSession()

  try {
    let expiredCredits = 0
    let expiredBuckets = 0

    const run = async () => {
      const fresh = await users.findOne({ id: params.userId }, { session })
      if (!fresh) return

      const freshBuckets: import("@/lib/types/db").CreditBucket[] = fresh.creditBuckets ?? []
      const overdue = freshBuckets.filter((b) => b.expiresAt <= now)
      const legacyFlatStale =
        freshBuckets.length === 0 &&
        (fresh.subscriptionCredits ?? 0) > 0 &&
        typeof fresh.subscriptionPeriodEnd === "number" &&
        (fresh.subscriptionPeriodEnd ?? 0) < now - LEGACY_FLAT_EXPIRY_GRACE_MS

      const amount = legacyFlatStale && overdue.length === 0
        ? Math.min(fresh.subscriptionCredits ?? 0, fresh.credits ?? 0)
        : Math.min(
            overdue.reduce((sum, b) => sum + b.amount, 0),
            fresh.subscriptionCredits ?? 0,
          )

      if (amount <= 0) {
        // Buckets are dead records but the flat field is already correct —
        // just drop them, no ledger entry (the debit happened elsewhere).
        if (overdue.length > 0 && (fresh.subscriptionCredits ?? 0) <= 0) {
          await users.updateOne(
            { id: params.userId },
            { $pull: { creditBuckets: { expiresAt: { $lte: now } } } as Record<string, unknown> },
            { session },
          )
        }
        return
      }

      const keys = legacyFlatStale && overdue.length === 0
        ? [`sub_expire_flat_${params.userId}_${Math.floor((fresh.subscriptionPeriodEnd ?? now) / 86400000)}`]
        : overdue.map((b) =>
            b.bucketId
              ? `sub_expire_bucket_${b.bucketId}`
              : `sub_expire_${b.subscriptionId}_${Math.floor(b.expiresAt / 86400000)}`,
          )

      const ledger = await creditLedgerCol()
      const alreadyExpired = await ledger.findOne(
        { idempotencyKey: { $in: keys } },
        params.session ? { session } : {},
      )
      if (alreadyExpired) return

      const result = await users.updateOne(
        { id: params.userId, subscriptionCredits: { $gte: amount } },
        {
          $inc: { subscriptionCredits: -amount, credits: -amount },
          ...(overdue.length > 0
            ? { $pull: { creditBuckets: { expiresAt: { $lte: now } } } as Record<string, unknown> }
            : {}),
          $set: { updatedAt: now },
        },
        { session },
      )
      if (result.modifiedCount === 0) {
        // Raced with a concurrent consume/renewal/sweep — the winner records
        // the ledger entry; nothing to do here.
        return
      }

      await recordLedgerEntry({
        userId: params.userId,
        creditType: "subscription",
        amount,
        direction: "debit",
        transactionType: "subscription_expiration",
        referenceType: legacyFlatStale ? "account" : "subscription",
        referenceId: legacyFlatStale ? params.userId : overdue[0]!.subscriptionId,
        balanceBefore: fresh.subscriptionCredits ?? 0,
        balanceAfter: (fresh.subscriptionCredits ?? 0) - amount,
        idempotencyKey: keys[0]!,
        metadata: {
          ...params.metadata,
          kind: legacyFlatStale ? "legacy_flat_period_end" : "overdue_buckets",
          expiredAmount: amount,
          expiredBuckets: overdue.length,
          bucketKeys: keys,
        },
        session,
      })

      expiredCredits = amount
      expiredBuckets = overdue.length
    }

    if (params.session) await run()
    else await session.withTransaction(run)

    if (expiredCredits > 0) {
      logger.info("credit.expire", "Overdue subscription credits expired", {
        userId: params.userId,
        expiredCredits,
        expiredBuckets,
      })
    }

    return { expiredCredits, expiredBuckets }
  } finally {
    if (!params.session) await session.endSession()
  }
}

// ─── Signup & Referral Operations ────────────────────────────────────────────

/**
 * Grant the welcome bonus credits after email verification.
 * Idempotent per user.
 */
export async function grantWelcomeBonus(userId: string): Promise<boolean> {
  // Admin-configurable amount (falls back to the code default).
  const { getRewardSettings } = await import("@/lib/billing/runtime-config")
  const rewards = await getRewardSettings()
  const result = await grantCredits({
    userId,
    creditType: "permanent",
    amount: rewards.welcomeBonus,
    transactionType: "signup_bonus",
    idempotencyKey: `welcome_${userId}`,
    referenceType: "signup",
    referenceId: userId,
  })
  return result.success
}

// ─── Refund/Reversal Operations ─────────────────────────────────────────────

/**
 * Reverse credits (for refunds). Properly debits from the specified credit type.
 * Unlike grantCredits with negative amounts, this correctly handles direction.
 */
export interface CreditReversalBucketDeduction {
  bucketId?: string
  subscriptionId?: string
  amount: number
}

export interface CreditReversalResult {
  success: boolean
  actualReversed: number
  requestedAmount: number
  availableAmount: number
  expiredAmount: number
  consumedAmount: number
  previouslyReversedAmount: number
  shortfall: number
  shortfallReason?:
    | "consumed"
    | "expired"
    | "already_reversed"
    | "missing_bucket"
    | "insufficient_balance"
  missingBucketIds: string[]
  previouslyReversedBucketIds: string[]
  scope: "grant" | "subscription" | "account"
  ledgerEntryId?: string
  reason?: string
  bucketDeductions: CreditReversalBucketDeduction[]
}

function reversalShortfallReason(input: {
  requestedAmount: number
  actualReversed: number
  availableAmount: number
  expiredAmount: number
  consumedAmount: number
  previouslyReversedAmount: number
  missingBucketIds: string[]
  previouslyReversedBucketIds: string[]
}): CreditReversalResult["shortfallReason"] {
  if (input.actualReversed >= input.requestedAmount) return undefined
  if (
    input.previouslyReversedAmount > 0 &&
    input.consumedAmount === 0 &&
    input.expiredAmount === 0
  ) {
    return "already_reversed"
  }
  if (
    input.previouslyReversedBucketIds.length > 0 &&
    input.availableAmount === 0 &&
    input.expiredAmount === 0
  ) {
    return "already_reversed"
  }
  if (input.expiredAmount > 0 && input.availableAmount === 0) return "expired"
  if (input.consumedAmount > 0) return "consumed"
  if (input.expiredAmount > 0) return "expired"
  if (input.missingBucketIds.length > 0) return "missing_bucket"
  return "insufficient_balance"
}

/**
 * The single authoritative credit reversal operation.
 *
 * Debits the exact grant buckets (for subscription credits), the flat
 * aggregate fields, and the ledger in one transaction. It never falls back to
 * the user's total balance when a grant-scoped reversal is requested, and it
 * never touches permanent or unrelated subscription credits.
 *
 * Idempotent per `idempotencyKey`; safe to call inside an existing transaction
 * by passing `session`.
 */
export async function reverseCredits(params: {
  userId: string
  creditType: CreditType
  amount: number
  transactionType: LedgerTransactionType
  idempotencyKey: string
  referenceType?: string
  referenceId?: string
  metadata?: Record<string, unknown>
  /** Trusted server-derived project context, persisted on the ledger entry. */
  projectId?: string
  /** Exact grant buckets to debit. Omit only for account-level reversals. */
  bucketIds?: string[]
  /** Limit a subscription reversal to one subscription's buckets. */
  subscriptionId?: string
  /** Original payment that funded the reversed grant, when known. */
  paymentId?: string
  /** Join an existing transaction instead of opening one. */
  session?: ClientSession
  now?: number
}): Promise<CreditReversalResult> {
  if (params.session && !params.session.inTransaction()) {
    throw new Error("Credit reversals require an active transaction")
  }

  const users = await usersCol()
  const field = params.creditType === "subscription" ? "subscriptionCredits" : "permanentCredits"
  const now = params.now ?? Date.now()
  const session = params.session ?? (await getMongoClient()).startSession()
  const wanted = params.bucketIds?.filter(Boolean) ?? []
  const scope: CreditReversalResult["scope"] =
    wanted.length > 0 ? "grant" : params.subscriptionId ? "subscription" : "account"
  const requestedAmount = Number.isFinite(params.amount)
    ? Math.max(0, Math.floor(params.amount))
    : 0

  let result: CreditReversalResult = {
    success: false,
    actualReversed: 0,
    requestedAmount,
    availableAmount: 0,
    expiredAmount: 0,
    consumedAmount: 0,
    previouslyReversedAmount: 0,
    shortfall: requestedAmount,
    missingBucketIds: [],
    previouslyReversedBucketIds: [],
    scope,
    reason: "not_started",
    bucketDeductions: [],
  }

  const resultFromLedger = (entry: {
    id: string
    amount: number
    metadata?: Record<string, unknown>
  }): CreditReversalResult => {
    const md = entry.metadata ?? {}
    const numberOr = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? value : fallback
    return {
      success: true,
      actualReversed: entry.amount,
      requestedAmount: numberOr(md.requestedAmount, entry.amount),
      availableAmount: numberOr(md.availableAmount, entry.amount),
      expiredAmount: numberOr(md.expiredAmount, 0),
      consumedAmount: numberOr(md.consumedAmount, 0),
      previouslyReversedAmount: numberOr(md.previouslyReversedAmount, 0),
      shortfall: numberOr(md.shortfall, 0),
      shortfallReason: md.shortfallReason as CreditReversalResult["shortfallReason"],
      missingBucketIds: Array.isArray(md.missingBucketIds)
        ? (md.missingBucketIds as string[])
        : [],
      previouslyReversedBucketIds: Array.isArray(md.previouslyReversedBucketIds)
        ? (md.previouslyReversedBucketIds as string[])
        : [],
      scope: (md.scope as CreditReversalResult["scope"]) ?? scope,
      ledgerEntryId: entry.id,
      bucketDeductions: Array.isArray(md.bucketDeductions)
        ? (md.bucketDeductions as CreditReversalBucketDeduction[])
        : [],
    }
  }

  const run = async () => {
    const ledger = await creditLedgerCol()
    const existingLedger = await ledger.findOne({ idempotencyKey: params.idempotencyKey }, { session })
    if (existingLedger) {
      result = resultFromLedger(existingLedger)
      return
    }

    const user = await users.findOne({ id: params.userId }, { session })
    if (!user) {
      result = { ...result, success: false, actualReversed: 0, reason: "user_not_found" }
      return
    }

    const buckets: import("@/lib/types/db").CreditBucket[] = user.creditBuckets ?? []
    const scopedToGrant = wanted.length > 0 || Boolean(params.subscriptionId)

    let available = 0
    let expiredAmount = 0
    let consumedAmount = 0
    let previouslyReversedAmount = 0
    let missingBucketIds: string[] = []
    let previouslyReversedBucketIds: string[] = []
    let targets: import("@/lib/types/db").CreditBucket[] = []
    if (params.creditType === "subscription") {
      const scopedBuckets = buckets.filter(
        (bucket) =>
          (!params.subscriptionId || bucket.subscriptionId === params.subscriptionId) &&
          (wanted.length === 0 || (bucket.bucketId !== undefined && wanted.includes(bucket.bucketId))),
      )
      const expiredBuckets = scopedBuckets.filter((bucket) => bucket.expiresAt <= now)
      targets = scopedBuckets
        .filter((bucket) => bucket.expiresAt > now)
        .sort((a, b) => (b.createdAt ?? b.expiresAt) - (a.createdAt ?? a.expiresAt))

      expiredAmount = expiredBuckets.reduce((sum, bucket) => sum + Math.max(0, bucket.amount), 0)
      missingBucketIds = wanted.filter(
        (bucketId) => !buckets.some((bucket) => bucket.bucketId === bucketId),
      )

      const lookupIds = [
        ...new Set([
          ...wanted,
          ...scopedBuckets
            .map((bucket) => bucket.bucketId)
            .filter((bucketId): bucketId is string => typeof bucketId === "string"),
        ]),
      ]
      const previouslyReversedByBucket = new Map<string, number>()
      if (lookupIds.length > 0 && typeof ledger.find === "function") {
        const prior = await ledger
          .find(
            {
              userId: params.userId,
              direction: "debit",
              "metadata.bucketDeductions.bucketId": { $in: lookupIds },
            },
            { session },
          )
          .limit(50)
          .toArray()
        for (const row of prior) {
          const deductions = row.metadata?.bucketDeductions
          if (!Array.isArray(deductions)) continue
          for (const deduction of deductions) {
            if (!deduction || typeof deduction.bucketId !== "string") continue
            previouslyReversedByBucket.set(
              deduction.bucketId,
              (previouslyReversedByBucket.get(deduction.bucketId) ?? 0) +
                (typeof deduction.amount === "number" ? deduction.amount : 0),
            )
          }
        }
      }
      previouslyReversedBucketIds = [...previouslyReversedByBucket.keys()]
      previouslyReversedAmount = scopedBuckets.reduce(
        (sum, bucket) =>
          sum + (bucket.bucketId ? previouslyReversedByBucket.get(bucket.bucketId) ?? 0 : 0),
        0,
      )
      consumedAmount = scopedBuckets.reduce((sum, bucket) => {
        const prior = bucket.bucketId ? previouslyReversedByBucket.get(bucket.bucketId) ?? 0 : 0
        return (
          sum +
          Math.max(
            0,
            (bucket.originalAmount ?? bucket.amount) - Math.max(0, bucket.amount) - prior,
          )
        )
      }, 0)

      if (targets.length === 0 && buckets.length === 0 && !scopedToGrant) {
        // Legacy bucket-less account: the flat field is the only record.
        available = Math.max(0, user.subscriptionCredits ?? 0)
      } else {
        available = targets.reduce((sum, bucket) => sum + Math.max(0, bucket.amount), 0)
      }
    } else {
      available = Math.max(0, user.permanentCredits ?? 0)
    }

    const actualReversed = Math.min(
      requestedAmount,
      available,
      Math.max(0, (user[field] as number | undefined) ?? 0),
      Math.max(0, user.credits ?? 0),
    )
    if (actualReversed <= 0) {
      result = {
        ...result,
        success: false,
        actualReversed: 0,
        availableAmount: available,
        expiredAmount,
        consumedAmount,
        previouslyReversedAmount,
        shortfall: requestedAmount,
        shortfallReason: reversalShortfallReason({
          requestedAmount,
          actualReversed: 0,
          availableAmount: available,
          expiredAmount,
          consumedAmount,
          previouslyReversedAmount,
          missingBucketIds,
          previouslyReversedBucketIds,
        }),
        missingBucketIds,
        previouslyReversedBucketIds,
        reason: "nothing_available",
      }
      return
    }

    const deductions: CreditReversalBucketDeduction[] = []
    if (params.creditType === "subscription" && targets.length > 0) {
      let remaining = actualReversed
      for (const bucket of targets) {
        if (remaining <= 0) break
        const take = Math.min(remaining, Math.max(0, bucket.amount))
        if (take <= 0) continue
        deductions.push({
          bucketId: bucket.bucketId,
          subscriptionId: bucket.subscriptionId,
          amount: take,
        })
        remaining -= take
      }
      if (deductions.reduce((sum, deduction) => sum + deduction.amount, 0) !== actualReversed) {
        throw new Error(
          `Credit reversal: bucket deductions do not cover the reversal for ${params.idempotencyKey}`,
        )
      }
    }

    const balanceBefore = Math.max(0, (user[field] as number | undefined) ?? 0)
    const flat = await users.updateOne(
      {
        id: params.userId,
        creditReversalKeys: { $ne: params.idempotencyKey },
        credits: { $gte: actualReversed },
        [field]: { $gte: actualReversed },
      },
      {
        $inc: { credits: -actualReversed, [field]: -actualReversed },
        $addToSet: { creditReversalKeys: params.idempotencyKey },
        $set: { updatedAt: now },
      },
      { session },
    )
    if (flat.modifiedCount === 0) {
      const replay = await ledger.findOne({ idempotencyKey: params.idempotencyKey }, { session })
      if (replay) {
        result = resultFromLedger(replay)
        return
      }
      result = {
        ...result,
        success: false,
        actualReversed: 0,
        availableAmount: available,
        expiredAmount,
        consumedAmount,
        previouslyReversedAmount,
        shortfall: requestedAmount,
        shortfallReason: reversalShortfallReason({
          requestedAmount,
          actualReversed: 0,
          availableAmount: available,
          expiredAmount,
          consumedAmount,
          previouslyReversedAmount,
          missingBucketIds,
          previouslyReversedBucketIds,
        }),
        missingBucketIds,
        previouslyReversedBucketIds,
        reason: "insufficient_balance",
      }
      return
    }

    for (const deduction of deductions) {
      const bucket = targets.find((item) =>
        deduction.bucketId ? item.bucketId === deduction.bucketId : item.subscriptionId === deduction.subscriptionId,
      )
      if (!bucket) {
        throw new Error(
          `Credit reversal: bucket ${deduction.bucketId ?? deduction.subscriptionId} disappeared during reversal`,
        )
      }
      const bucketFilter = bucket.bucketId
        ? { bucketId: bucket.bucketId }
        : { subscriptionId: bucket.subscriptionId, expiresAt: bucket.expiresAt }
      const nextAmount = bucket.amount - deduction.amount
      if (nextAmount <= 0) {
        const pulled = await users.updateOne(
          { id: params.userId, creditBuckets: { $elemMatch: bucketFilter } },
          {
            $pull: {
              creditBuckets: bucketFilter,
            } as Record<string, unknown>,
          },
          { session },
        )
        if (pulled.modifiedCount === 0) {
          throw new Error(
            `Credit reversal: bucket ${deduction.bucketId ?? deduction.subscriptionId} could not be removed`,
          )
        }
      } else {
        const updated = await users.updateOne(
          {
            id: params.userId,
            creditBuckets: {
              $elemMatch: { ...bucketFilter, amount: { $gte: deduction.amount } },
            },
          },
          { $inc: { "creditBuckets.$.amount": -deduction.amount } },
          { session },
        )
        if (updated.modifiedCount === 0) {
          throw new Error(
            `Credit reversal: bucket ${deduction.bucketId ?? deduction.subscriptionId} changed during reversal`,
          )
        }
      }
    }

    const shortfall = Math.max(0, requestedAmount - actualReversed)
    const shortfallReason =
      shortfall > 0
        ? reversalShortfallReason({
            requestedAmount,
            actualReversed,
            availableAmount: available,
            expiredAmount,
            consumedAmount,
            previouslyReversedAmount,
            missingBucketIds,
            previouslyReversedBucketIds,
          })
        : undefined

    const entry = await recordLedgerEntry({
      userId: params.userId,
      creditType: params.creditType,
      amount: actualReversed,
      direction: "debit",
      transactionType: params.transactionType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      paymentId: params.paymentId,
      balanceBefore,
      balanceAfter: balanceBefore - actualReversed,
      idempotencyKey: params.idempotencyKey,
      metadata: {
        ...params.metadata,
        bucketDeductions: deductions,
        requestedAmount,
        availableAmount: available,
        expiredAmount,
        consumedAmount,
        previouslyReversedAmount,
        actualReversed,
        shortfall,
        shortfallReason,
        missingBucketIds,
        previouslyReversedBucketIds,
        scope,
        ...(params.creditType === "subscription" && targets.length === 0 ? { legacyFlat: true } : {}),
      },
      session,
      projectId: params.projectId,
    })

    result = {
      success: true,
      actualReversed,
      requestedAmount,
      availableAmount: available,
      expiredAmount,
      consumedAmount,
      previouslyReversedAmount,
      shortfall,
      shortfallReason,
      missingBucketIds,
      previouslyReversedBucketIds,
      scope,
      ledgerEntryId: entry.id,
      reason: shortfall > 0 ? "partially_consumed" : undefined,
      bucketDeductions: deductions,
    }
  }

  try {
    if (params.session) await run()
    else await session.withTransaction(run)
  } finally {
    if (!params.session) await session.endSession()
  }

  if (result.success) {
    logger.info("credit.reverse", "Credits reversed", {
      userId: params.userId,
      creditType: params.creditType,
      amount: result.actualReversed,
      transactionType: params.transactionType,
      bucketsUsed: result.bucketDeductions.length,
    })
  }

  return result
}

// ─── Admin Operations ────────────────────────────────────────────────────────

/**
 * Admin credit adjustment. Must go through the ledger.
 */
export async function adminAdjustCredits(params: {
  userId: string
  amount: number
  adminId: string
  reason: string
  creditType?: CreditType
  idempotencyKey?: string
  projectId?: string
}): Promise<boolean> {
  const creditType = params.creditType ?? "permanent"
  // Use provided idempotency key or generate one from admin+user+reason+amount
  // to prevent duplicate adjustments from accidental double-submits
  const key = params.idempotencyKey ?? `admin_${params.adminId}_${params.userId}_${params.amount}_${Buffer.from(params.reason).toString("base64").slice(0, 20)}`

  if (params.amount >= 0) {
    const result = await grantCredits({
      userId: params.userId,
      creditType,
      amount: params.amount,
      transactionType: "admin_adjustment",
      idempotencyKey: key,
      referenceType: "admin",
      referenceId: params.adminId,
      projectId: params.projectId,
      metadata: { reason: params.reason, adminId: params.adminId },
    })
    return result.success
  } else {
    const result = await reverseCredits({
      userId: params.userId,
      creditType,
      amount: Math.abs(params.amount),
      transactionType: "admin_adjustment",
      idempotencyKey: key,
      referenceType: "admin",
      referenceId: params.adminId,
      projectId: params.projectId,
      metadata: { reason: params.reason, adminId: params.adminId },
    })
    return result.success
  }
}

// ─── Ledger Query ────────────────────────────────────────────────────────────

/**
 * Get a user's credit ledger entries.
 */
export async function getLedgerEntries(
  userId: string,
  options: { limit?: number; offset?: number; creditType?: CreditType } = {},
): Promise<CreditLedgerEntry[]> {
  const col = await creditLedgerCol()
  const query: Record<string, unknown> = { userId }
  if (options.creditType) query.creditType = options.creditType

  return col
    .find(query)
    .sort({ createdAt: -1 })
    .skip(options.offset ?? 0)
    .limit(options.limit ?? 100)
    .toArray()
}

/**
 * Get the total credits consumed by a user (for referral milestone tracking).
 */
export async function getTotalCreditsConsumed(userId: string): Promise<number> {
  const col = await creditLedgerCol()
  const result = await col
    .aggregate([
      {
        $match: {
          userId,
          direction: "debit",
          transactionType: { $in: ["build_finalization"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray()

  return result[0]?.total ?? 0
}

/**
 * Convert credits to baseline cost units (internal only).
 */
export function creditsToBaselineUnits(credits: number): number {
  return Math.floor(credits / CREDITS_PER_BASELINE_UNIT)
}

/**
 * Get the user's credit history formatted for display.
 */
export async function getCreditHistory(
  userId: string,
  limit = 50,
): Promise<Array<{
  id: string
  type: string
  amount: number
  creditType: string
  reason: string
  createdAt: number
}>> {
  const col = await creditLedgerCol()
  const entries = await col
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  return entries.map((e) => ({
    id: e.id,
    type: e.transactionType,
    amount: e.direction === "credit" ? e.amount : -e.amount,
    creditType: e.creditType,
    reason: formatTransactionReason(e.transactionType, e.metadata),
    createdAt: e.createdAt,
  }))
}

function formatTransactionReason(type: LedgerTransactionType, metadata?: Record<string, unknown>): string {
  switch (type) {
    case "signup_bonus":
      return "Welcome bonus"
    case "referral_bonus":
      return metadata?.rewardType === "milestone"
        ? "Referral milestone reward"
        : "Referral verification reward"
    case "credit_purchase":
      return "Credit purchase"
    case "subscription_grant":
      return "Subscription credits"
    case "subscription_renewal":
      return "Subscription renewal"
    case "build_reservation":
      return "Application build"
    case "build_finalization":
      return "Application build (finalized)"
    case "build_release":
      return "Build refund"
    case "build_refund":
      return "Build refund"
    case "promotional_grant":
      return "Promotional grant"
    case "admin_adjustment":
      return "Admin adjustment"
    case "ad_campaign_charge":
      return "Atai promotional campaign"
    case "ad_campaign_refund":
      return "Promotional campaign refund"
    case "subscription_expiration":
      return "Subscription credits expired"
    case "credit_reconciliation":
      return "Credit balance reconciliation"
    default:
      return type.replace(/_/g, " ")
  }
}
