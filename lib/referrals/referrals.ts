import { ObjectId } from "mongodb"
import { referralsCol, usersCol, buildRunsCol, ensureIndexes } from "@/lib/db/collections"
import type { ReferralDoc, UserDoc } from "@/lib/types/db"
import { cryptoId } from "@/lib/store/id"
import { logger } from "@/lib/logging/logger"
import { grantCredits } from "@/lib/billing/credit-service"
import { getMongoClient } from "@/lib/db/mongodb"
import { sendMail } from "@/lib/email/mailer"
import { referralWelcomeEmail } from "@/lib/email/templates"
import { isSmtpConfigured } from "@/lib/env"

/**
 * Atai referral system.
 *
 * Business model:
 *   - The person who joins through a referral link gets a one-time signup
 *     bonus.
 *   - The referrer gets a verification reward when the referred user verifies
 *     their account.
 *   - The referrer gets a milestone reward when the referred user reaches the
 *     configured eligible application-generation usage (successful builds only).
 */

const REFERRAL_CODE_PREFIX = "ATAI"
const REFERRAL_CODE_LENGTH = 6
/** Custom codes: ATAI- plus a 3–30 char suffix of letters, numbers, and dashes. */
const CUSTOM_REFERRAL_CODE_PATTERN = /^ATAI-[A-Z0-9](?:[A-Z0-9-]{1,28}[A-Z0-9])$/
/** Resolve the current admin-configured reward values. */
async function getRuntimeRewards() {
  const { getRewardSettings } = await import("@/lib/billing/runtime-config")
  return getRewardSettings()
}

// ─── Referral Code Generation ───────────────────────────────────────────────

/**
 * Generate a unique referral code in the format ATAI-XXXXXX.
 * Uses alphanumeric characters (uppercase) excluding ambiguous chars (0, O, I, L).
 */
function generateReferralCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `${REFERRAL_CODE_PREFIX}-${code}`
}

/**
 * Ensure the user has a referral code. Generates one if missing.
 * Safe to call repeatedly — idempotent.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const col = await usersCol()
  const user = await col.findOne({ id: userId, deletedAt: { $exists: false } })
  if (!user) throw new Error("User not found")

  if (user.referralCode) return user.referralCode

  // Generate a unique code (retry on collision)
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateReferralCode()
    const existing = await col.findOne({ referralCode: code, deletedAt: { $exists: false } })
    if (!existing) {
      await col.updateOne({ id: userId }, { $set: { referralCode: code, updatedAt: Date.now() } })
      return code
    }
  }
  throw new Error("Failed to generate unique referral code after multiple attempts")
}

/** Normalize and validate a user-chosen referral code. Returns null when invalid. */
export function normalizeCustomReferralCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  return CUSTOM_REFERRAL_CODE_PATTERN.test(code) ? code : null
}

/**
 * Set a user's referral code. Pass a custom code string, or omit it to
 * auto-generate a fresh ATAI-XXXXXX code. Existing codes keep working —
 * referrals resolve by stored value, so old ATA-/MSA- codes are unaffected.
 */
export async function setReferralCode(userId: string, customCode?: string): Promise<string> {
  const col = await usersCol()
  const user = await col.findOne({ id: userId, deletedAt: { $exists: false } })
  if (!user) throw new Error("User not found")

  let code = ""
  if (customCode !== undefined) {
    const normalized = normalizeCustomReferralCode(customCode)
    if (!normalized) {
      throw new Error("Referral code must start with ATAI- and use 3–30 letters, numbers, or dashes after it.")
    }
    const taken = await col.findOne({ referralCode: normalized, deletedAt: { $exists: false }, id: { $ne: userId } })
    if (taken) throw new Error("That referral code is already taken.")
    code = normalized
  } else {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateReferralCode()
      const existing = await col.findOne({ referralCode: candidate, deletedAt: { $exists: false }, id: { $ne: userId } })
      if (!existing) {
        code = candidate
        break
      }
    }
    if (!code) throw new Error("Failed to generate unique referral code after multiple attempts")
  }

  await col.updateOne({ id: userId }, { $set: { referralCode: code, updatedAt: Date.now() } })
  return code
}

/**
 * Resolve a referral code to a user ID. Returns null if invalid.
 */
export async function resolveReferralCode(code: string): Promise<UserDoc | null> {
  const col = await usersCol()
  return col.findOne({ referralCode: code, deletedAt: { $exists: false } })
}

// ─── Referral Relationship ──────────────────────────────────────────────────

export interface ReferralCaptureResult {
  referral: ReferralDoc
  /** Extra credits granted to the person who joined through the link. */
  signupBonus: number
  /** Display name of the referrer, for the welcome message. */
  referrerName?: string
}

/**
 * Establish a referral relationship during registration.
 * - Validates the referral code exists and resolves to a different user.
 * - Prevents self-referral.
 * - Prevents overwriting an existing referral.
 * - Records the relationship in the referrals collection.
 * - Grants the referred user their one-time signup bonus.
 * - Settles the referrer's verification reward when the referred user is
 *   already verified (Google/GitHub verify the email before we see them).
 * - Emails the referred user to confirm the bonus.
 *
 * Returns the capture outcome, or null if there was no valid referral.
 */
export async function captureReferral(
  referredUserId: string,
  referralCode: string,
): Promise<ReferralCaptureResult | null> {
  await ensureIndexes()

  // Codes are stored uppercase; normalize here so every caller (cookie, OAuth
  // query, form body) resolves the same referrer.
  const code = referralCode.trim().toUpperCase()

  // Resolve the code
  const referrer = await resolveReferralCode(code)
  if (!referrer) {
    logger.warn("referral.capture", "invalid referral code", { referredUserId })
    return null
  }

  // Self-referral protection
  if (referrer.id === referredUserId) {
    logger.warn("referral.capture", "self-referral attempt blocked", { referredUserId })
    return null
  }

  const referrals = await referralsCol()

  // Check if the referred user already has a referral (one referrer per user)
  const existing = await referrals.findOne({ referredUserId })
  if (existing) {
    logger.info("referral.capture", "referral already exists, not overwriting", { referredUserId })
    return null
  }

  // Fraud check: basic circular referral detection
  // Check if the referrer was referred by the same user (A→B→A loop)
  const referrerDoc = await (await usersCol()).findOne({ id: referrer.id })
  if (referrerDoc?.referredBy === referredUserId) {
    logger.warn("referral.capture", "circular referral detected", { referredUserId, referrerUserId: referrer.id })
    return null
  }

  const now = Date.now()
  const doc: ReferralDoc = {
    _id: new ObjectId(),
    id: cryptoId(),
    referrerUserId: referrer.id,
    referredUserId,
    referralCode: code,
    status: "registered",
    verificationRewardIssued: false,
    milestoneRewardIssued: false,
    eligibleUsage: 0,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await referrals.insertOne(doc)
  } catch (e) {
    // The unique index on referredUserId settles two simultaneous signups.
    if ((e as { code?: number }).code === 11000) {
      logger.info("referral.capture", "concurrent capture already recorded", { referredUserId })
      return null
    }
    throw e
  }

  // Also set referredBy on the user document
  const col = await usersCol()
  await col.updateOne({ id: referredUserId }, { $set: { referredBy: referrer.id, updatedAt: now } })

  logger.info("referral.capture", "referral created", {
    referralId: doc.id,
    referrerUserId: referrer.id,
    referredUserId,
  })

  const rewards = await getRuntimeRewards()
  const signupBonus = rewards.referralSignupBonus

  if (signupBonus > 0) {
    try {
      const grant = await grantCredits({
        userId: referredUserId,
        creditType: "permanent",
        amount: signupBonus,
        transactionType: "referral_bonus",
        idempotencyKey: `referral_signup_${doc.id}`,
        referenceType: "referral",
        referenceId: doc.id,
        metadata: {
          reason: "Referral signup bonus",
          referrerUserId: referrer.id,
        },
      })
      if (!grant.success) throw new Error("Referral signup bonus was not committed")
    } catch (e) {
      // The relationship is already durable. Never fail a signup because the
      // bonus grant hiccuped; log it so support can re-grant the credits.
      logger.error("referral.capture", "signup bonus failed", {
        referralId: doc.id,
        referredUserId,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const referredUser = await col.findOne({ id: referredUserId })

  // OAuth signups arrive pre-verified, so the verify-email route never runs for
  // them. Settle the referrer's reward here instead of leaving it pending.
  if (referredUser?.emailVerified) {
    await processVerificationReward(referredUserId).catch((e) => {
      logger.error("referral.capture", "verification reward failed", {
        referralId: doc.id,
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }

  if (signupBonus > 0 && referredUser?.email && isSmtpConfigured()) {
    const { subject, html, text } = referralWelcomeEmail(referredUser.name, referrer.name, signupBonus)
    await sendMail({ to: referredUser.email, subject, html, text }).catch((e) => {
      logger.warn("referral.capture", "welcome email failed", {
        referralId: doc.id,
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }

  return { referral: doc, signupBonus, referrerName: referrer.name }
}

// ─── Verification Reward ────────────────────────────────────────────────────

export async function processVerificationReward(userId: string): Promise<boolean> {
  return processReward(userId, "verification")
}

export async function processMilestoneCheck(referredUserId: string): Promise<boolean> {
  return processReward(referredUserId, "milestone")
}

async function processReward(referredUserId: string, kind: "verification" | "milestone"): Promise<boolean> {
  await ensureIndexes()
  const referrals = await referralsCol()
  const users = await usersCol()
  const rewards = await getRuntimeRewards()
  const session = (await getMongoClient()).startSession()
  const issued = kind === "verification" ? "verificationRewardIssued" : "milestoneRewardIssued"
  try {
    return await session.withTransaction(async () => {
      const referral = await referrals.findOne({ referredUserId }, { session })
      if (!referral || referral[issued] || referral.status === "blocked") return false
      const user = await users.findOne({ id: referredUserId, deletedAt: { $exists: false }, banned: { $ne: true }, suspended: { $ne: true } }, { session })
      const referrer = await users.findOne({ id: referral.referrerUserId, deletedAt: { $exists: false }, banned: { $ne: true }, suspended: { $ne: true } }, { session })
      if (!user?.emailVerified || !referrer) return false
      const flags = new Set(referral.fraudFlags ?? [])
      if (referrer.id === referredUserId) flags.add("self_referral")
      if (user.referredBy !== referrer.id) flags.add("attribution_mismatch")
      if (referrer.referredBy === referredUserId) flags.add("circular_referral")
      const count = await referrals.countDocuments({ referrerUserId: referrer.id }, { session })
      if (count > 20) flags.add("high_referral_count")
      const approved = new Set(referral.review?.decision === "approve" ? referral.review.approvedFlags : [])
      const hardFlags = new Set(["self_referral", "attribution_mismatch", "circular_referral"])
      if ([...flags].some((flag) => hardFlags.has(flag) || !approved.has(flag))) {
        await referrals.updateOne({ _id: referral._id }, { $set: { fraudFlags: [...flags], updatedAt: Date.now() } }, { session })
        logger.warn("referral.reward_deferred", "Referral requires review before rewards", { referralId: referral.id })
        return false
      }
      let eligibleUsage = referral.eligibleUsage
      if (kind === "milestone") {
        // Recompute from unique successful runs so duplicate poll/webhook events add nothing.
        const usage = await (await buildRunsCol()).aggregate<{ total: number }>([
          { $match: { userId: referredUserId, status: "succeeded", startedAt: { $gte: referral.createdAt } } },
          { $group: { _id: null, total: { $sum: { $max: [0, { $ifNull: ["$creditsConsumed", "$creditsReserved"] }] } } } },
        ], { session }).toArray()
        eligibleUsage = usage[0]?.total ?? 0
        await referrals.updateOne({ _id: referral._id }, { $set: { eligibleUsage, updatedAt: Date.now() } }, { session })
        if (eligibleUsage < rewards.referralMilestoneThreshold) return false
      }
      const claim = await referrals.findOneAndUpdate(
        { _id: referral._id, [issued]: false, status: { $ne: "blocked" } },
        { $set: { [issued]: true, status: kind === "milestone" ? "milestone_reached" : referral.milestoneRewardIssued ? "milestone_reached" : "verified", updatedAt: Date.now() } },
        { session, returnDocument: "after" },
      )
      if (!claim) return false
      const grant = await grantCredits({
        userId: referrer.id,
        amount: kind === "verification" ? rewards.referralVerificationReward : rewards.referralMilestoneReward,
        creditType: "permanent",
        transactionType: "referral_bonus",
        idempotencyKey: `referral_${kind}_${referral.id}`,
        metadata: { reason: kind === "verification" ? "Referral verification reward" : "Referral usage milestone", referredUserId, eligibleUsage },
        session,
      })
      if (!grant.success) throw new Error("Referral reward was not committed")
      return true
    }) ?? false
  } finally {
    await session.endSession()
  }
}

/**
 * Check if a build run qualifies for the milestone calculation.
 * Returns the credits consumed if the build succeeded, 0 otherwise.
 */
export async function getQualifyingBuildUsage(buildRunId: string): Promise<number> {
  const col = await buildRunsCol()
  const run = await col.findOne({ id: buildRunId })
  if (!run) return 0
  if (run.status !== "succeeded") return 0
  return run.creditsConsumed ?? 0
}

// ─── Fraud Detection ────────────────────────────────────────────────────────

/**
 * Run basic fraud checks on a referral and flag if suspicious.
 * Returns a list of fraud flags (empty = clean).
 */
export async function runFraudChecks(referralId: string): Promise<string[]> {
  const referrals = await referralsCol()
  const referral = await referrals.findOne({ id: referralId })
  if (!referral) return []

  const flags: string[] = []

  // Check: multiple referrals from the same IP pattern (heuristic)
  // Check: referral chain (A referred B, B referred C, C referred A)
  const col = await usersCol()
  const referredUser = await col.findOne({ id: referral.referredUserId })
  if (referredUser?.referredBy) {
    // Check if the referrer was also referred by the same person
    const referrerUser = await col.findOne({ id: referral.referrerUserId })
    if (referrerUser?.referredBy === referral.referredUserId) {
      flags.push("circular_referral")
    }
  }

  // Check: many accounts referred by the same user (potential ring)
  const referrerReferrals = await referrals.countDocuments({
    referrerUserId: referral.referrerUserId,
  })
  if (referrerReferrals > 20) {
    flags.push("high_referral_count")
  }

  if (flags.length > 0) {
    await referrals.updateOne(
      { id: referralId },
      { $addToSet: { fraudFlags: { $each: flags } }, $set: { updatedAt: Date.now() } },
    )
    logger.warn("referral.fraud_check", "flags raised", { referralId, flags })
  }

  return flags
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get a user's referral code (generating one if needed). */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  return ensureReferralCode(userId)
}

/** Get all referrals where the user is the referrer. */
export async function getReferralsByReferrer(referrerUserId: string): Promise<ReferralDoc[]> {
  const col = await referralsCol()
  return col.find({ referrerUserId }).sort({ createdAt: -1 }).toArray()
}

/** Get the referral where the user is the referred person. */
export async function getReferralByReferred(referredUserId: string): Promise<ReferralDoc | null> {
  const col = await referralsCol()
  return col.findOne({ referredUserId })
}

/** Get referral statistics for a referrer. */
export async function getReferralStats(referrerUserId: string) {
  const col = await referralsCol()

  const all = await col.find({ referrerUserId }).toArray()

  const successful = all.filter((r) => r.status === "verified" || r.status === "active" || r.status === "milestone_reached")
  const pending = all.filter((r) => r.status === "registered")

  let totalCreditsEarned = 0
  const rewards = await getRuntimeRewards()
  for (const r of all) {
    if (r.verificationRewardIssued) totalCreditsEarned += rewards.referralVerificationReward
    if (r.milestoneRewardIssued) totalCreditsEarned += rewards.referralMilestoneReward
  }

  return {
    totalReferrals: all.length,
    successfulReferrals: successful.length,
    pendingReferrals: pending.length,
    verificationRewards: all.filter((r) => r.verificationRewardIssued).length,
    milestoneRewards: all.filter((r) => r.milestoneRewardIssued).length,
    totalCreditsEarned,
  }
}

/** Get all referrals (admin only). */
export async function getAllReferrals(limit = 100, offset = 0) {
  const col = await referralsCol()
  const total = await col.countDocuments()
  const referrals = await col.find({}).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray()
  return { referrals, total }
}
