import { ObjectId, type Collection } from "mongodb"
import { ensureIndexes, verificationTokensCol } from "@/lib/db/collections"
import { generateNumericCode, hashToken } from "@/lib/auth/crypto"
import { sendMail } from "@/lib/email/mailer"
import { sessionVerificationEmail } from "@/lib/email/templates"
import { isSmtpConfigured } from "@/lib/env"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { createSession, evictOldestSessions } from "@/lib/auth/session"
import { getMaxActiveSessionsForUser } from "@/lib/auth/session-policy"
import { findUserByEmail, findUserById, type UserDoc } from "@/lib/auth/users"
import type { VerificationTokenDoc } from "@/lib/types/db"

/**
 * Email-confirmed session eviction. When a sign-in would push an account past
 * MAX_ACTIVE_SESSIONS, we don't silently drop the oldest sessions — we email
 * a short-lived numeric code and only evict + create the session after the
 * code is redeemed. The code proves mailbox access, i.e. that the person at
 * the keyboard is really the account owner (or someone they trust).
 *
 * Codes are stored hashed (SHA-256), single-use, expire after 10 minutes, and
 * are bounded by IP-level request limits plus per-user attempt/resend limits —
 * the 6-digit space is only safe because guessing is rate-limited.
 */

const CODE_TTL_MS = 10 * 60 * 1000
const CODE_DIGITS = 6
const RESEND_COOLDOWN_MS = 3 * 60 * 1000
const PURPOSE = "session_eviction" as const

export type SessionVerificationIssue =
  | { status: "sent"; verificationId: string }
  | { status: "unconfigured" }
  | { status: "delivery_failed" }

async function sendSessionCodeEmail(user: { id?: string; email: string; name: string }, code: string): Promise<boolean> {
  const { subject, html, text } = sessionVerificationEmail(user.name, code)
  try {
    await sendMail({ to: user.email, subject, html, text })
    return true
  } catch {
    logger.warn("email.session_verification_send_failed", "SMTP delivery failed", { userId: user.id ?? "unknown" })
    return false
  }
}

/**
 * Retire any outstanding codes for the user, store a fresh hashed code, and
 * email it. `verificationId` is the token doc id — the client needs it only
 * for the resend endpoint.
 *
 * "unconfigured" means this deployment has no SMTP at all (local dev): callers
 * should fall back to the previous behaviour (create the session directly)
 * rather than locking the user out. "delivery_failed" means SMTP exists but
 * the send errored — callers should surface an error and let the user retry.
 */
export async function issueSessionVerificationCode(user: {
  id: string
  email: string
  name: string
}): Promise<SessionVerificationIssue> {
  await ensureIndexes()
  if (!isSmtpConfigured()) return { status: "unconfigured" }

  const col = await verificationTokensCol()
  const now = Date.now()
  await col.updateMany(
    { userId: user.id, purpose: PURPOSE, usedAt: { $exists: false } },
    { $set: { usedAt: now } },
  )

  // tokenHash has a global unique index and the code space is small, so a
  // collision with another pending code is possible — retry with a new code.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateNumericCode(CODE_DIGITS)
    const _id = new ObjectId()
    try {
      await col.insertOne({
        _id,
        userId: user.id,
        purpose: PURPOSE,
        tokenHash: hashToken(code),
        createdAt: now,
        expiresAt: new Date(now + CODE_TTL_MS),
      })
    } catch (e) {
      if (e instanceof Error && /E11000|duplicate key/i.test(e.message)) continue
      throw e
    }
    const sent = await sendSessionCodeEmail(user, code)
    if (!sent) return { status: "delivery_failed" }
    return { status: "sent", verificationId: _id.toString() }
  }
  throw new AppError("UNKNOWN")
}

export interface SessionVerificationResendResult {
  sent: boolean
  reason?: "unconfigured" | "delivery_failed" | "invalid"
  retryAfterSeconds?: number
  /** Present when a dead verification was replaced by a fresh code — the
   * client must adopt this id for subsequent resends. */
  verificationId?: string
}

const RESEND_BLOCKED_MESSAGE =
  "Too many code resends. If you think this is a mistake, contact support at hi@atai.ink with your email address and name."

/**
 * Resend a session-verification code. Two paths:
 *
 * - Live code: rotate the code on the outstanding verification doc in place
 *   (3-minute cooldown + resend caps enforced).
 * - Dead verification (expired, retired by a newer sign-in, redeemed, or
 *   TTL-deleted): issue a FRESH code for the same user instead of dead-ending
 *   the sign-in — previously this forced a full password re-login, which
 *   retired the pending code again and trapped the user in a loop. The user
 *   is resolved from the token doc when possible, else from the account
 *   email the client already knows. Every outstanding code is retired inside
 *   issueSessionVerificationCode, so only the newest email stays valid.
 */
export async function resendSessionVerificationCode(
  verificationId: string,
  email?: string,
): Promise<SessionVerificationResendResult> {
  const col = await verificationTokensCol()
  const now = Date.now()
  const doc = ObjectId.isValid(verificationId)
    ? await col.findOne({ _id: new ObjectId(verificationId), purpose: PURPOSE })
    : null

  if (doc && doc.usedAt === undefined && doc.expiresAt.getTime() > now) {
    return resendLiveCode(col, doc, now)
  }

  // An expired-but-unused doc still carries its resend block — honor it so
  // expiry can't be used to bypass the 24h cap.
  if (doc && doc.usedAt === undefined && (doc.resendBlockedUntil?.getTime() ?? 0) > now) {
    throw new AppError("VERIFICATION_RATE_LIMITED", RESEND_BLOCKED_MESSAGE)
  }
  let user: UserDoc | null = doc ? await findUserById(doc.userId) : null
  if (!user && typeof email === "string" && email.trim()) {
    user = await findUserByEmail(email)
  }
  if (!user) return { sent: false, reason: "invalid" }
  await checkRateLimit({
    action: "session_verify_resend",
    identifier: user.id,
    limit: 5,
    windowMs: 15 * 60_000,
    errorCode: "VERIFICATION_RATE_LIMITED",
  })
  const issued = await issueSessionVerificationCode(user)
  if (issued.status === "sent") {
    return {
      sent: true,
      verificationId: issued.verificationId,
      retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    }
  }
  return { sent: false, reason: issued.status === "unconfigured" ? "unconfigured" : "delivery_failed" }
}

async function resendLiveCode(
  col: Collection<VerificationTokenDoc>,
  doc: VerificationTokenDoc,
  now: number,
): Promise<SessionVerificationResendResult> {
  const user = await findUserById(doc.userId)
  if (!user) return { sent: false, reason: "invalid" }
  await checkRateLimit({
    action: "session_verify_resend",
    identifier: user.id,
    limit: 5,
    windowMs: 15 * 60_000,
    errorCode: "VERIFICATION_RATE_LIMITED",
  })

  // Anti-abuse: 3-minute cooldown between resends, and after 3 resends the
  // code is blocked for 24 hours. Support can unlock a genuinely locked-out
  // user after identity checks.
  const resendCount = doc.resendCount ?? 0
  const blockedUntil = doc.resendBlockedUntil?.getTime() ?? 0
  if (resendCount >= 3) {
    if (blockedUntil > now) {
      throw new AppError("VERIFICATION_RATE_LIMITED", RESEND_BLOCKED_MESSAGE)
    }
    await col.updateOne({ _id: doc._id }, { $set: { resendCount: 0 }, $unset: { resendBlockedUntil: "" } })
  }
  if (!isSmtpConfigured()) return { sent: false, reason: "unconfigured" }

  // The 3-minute cooldown is enforced atomically in the update filter below —
  // a read-then-write check would let concurrent resends both slip through.
  const cooldownCutoff = new Date(now - RESEND_COOLDOWN_MS)
  const nextResendCount = (resendCount >= 3 ? 0 : resendCount) + 1

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateNumericCode(CODE_DIGITS)
    let result: { matchedCount: number }
    try {
      result = await col.updateOne(
        {
          _id: doc._id,
          $or: [{ lastResentAt: { $exists: false } }, { lastResentAt: { $lt: cooldownCutoff } }],
        },
        {
          $inc: { resendCount: 1 },
          $set: {
            tokenHash: hashToken(code),
            expiresAt: new Date(now + CODE_TTL_MS),
            lastResentAt: new Date(now),
            ...(nextResendCount >= 3 ? { resendBlockedUntil: new Date(now + 24 * 60 * 60_000) } : {}),
          },
        },
      )
    } catch (e) {
      if (e instanceof Error && /E11000|duplicate key/i.test(e.message)) continue
      throw e
    }
    if (result.matchedCount === 0) {
      // Another resend won the race (or the cooldown is still running) —
      // re-read for the freshest lastResentAt so the wait message is accurate.
      const fresh = await col.findOne({ _id: doc._id })
      const lastResentAt = fresh?.lastResentAt?.getTime() ?? doc.lastResentAt?.getTime() ?? 0
      const waitSeconds = Math.max(1, Math.ceil((lastResentAt + RESEND_COOLDOWN_MS - now) / 1000))
      const err = new AppError(
        "VERIFICATION_RATE_LIMITED",
        `Please wait ${Math.ceil(waitSeconds / 60)} minute${waitSeconds > 60 ? "s" : ""} before resending the code.`,
      )
      err.retryAfterSeconds = waitSeconds
      throw err
    }
    const sent = await sendSessionCodeEmail(user, code)
    return sent ? { sent: true, retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000) } : { sent: false, reason: "delivery_failed" }
  }
  throw new AppError("UNKNOWN")
}

/**
 * Redeem a code: enforce the per-attempt limit FIRST (so a rate-limited try
 * never burns an unused code, and wrong guesses count against the limit),
 * then atomically claim the token (single-use), evict the oldest sessions so
 * the account stays under the cap, and create the new session. Returns the
 * raw session token — the caller sets the cookie.
 *
 * `ipBucket` identifies the caller when the guessed code matches no token
 * doc, so unattributable guesses still burn a bounded per-IP budget.
 */
export async function completeSessionVerification(
  code: string,
  ipBucket: string,
): Promise<{ token: string; user: UserDoc }> {
  await ensureIndexes()
  const col = await verificationTokensCol()
  const now = Date.now()
  const tokenHash = hashToken(code)
  // Read before claiming so the attempt is attributed to the code's owner
  // whether it succeeds or not. The claim below stays atomic, so this probe
  // is only used for limiting and error wording — never for the used/unused
  // decision.
  const probe = await col.findOne({ tokenHash, purpose: PURPOSE })

  await checkRateLimit({
    action: "session_verify",
    identifier: probe ? probe.userId : ipBucket,
    limit: 8,
    windowMs: 15 * 60_000,
    errorCode: "VERIFICATION_RATE_LIMITED",
  })

  const claimed = await col.findOneAndUpdate(
    {
      tokenHash,
      purpose: PURPOSE,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date(now) },
    },
    { $set: { usedAt: now } },
    { returnDocument: "after" },
  )
  if (!claimed) {
    // Distinguish the failure modes so the UI can tell the founder whether
    // to retry, resend, or start over — a used code means sign-in already
    // succeeded once and retrying the same code can never work.
    if (probe && probe.usedAt === undefined && probe.expiresAt.getTime() <= now) {
      throw new AppError("VERIFICATION_EXPIRED", "That code has expired. Use \"Resend code\" to get a new one.")
    }
    if (probe && probe.usedAt !== undefined) {
      throw new AppError(
        "VERIFICATION_INVALID",
        "That code was already used. If you didn't finish signing in, use \"Resend code\" for a new one.",
      )
    }
    throw new AppError("VERIFICATION_INVALID", "That code is invalid. Use \"Resend code\" to get a new one.")
  }

  const user = await findUserById(claimed.userId)
  if (!user) throw new AppError("VERIFICATION_INVALID")
  if (user.banned || user.suspended) throw new AppError("UNAUTHORIZED")

  // Make room: keep the newest (cap - 1) existing sessions, then the fresh
  // session below lands the account at exactly the cap. Admins never reach
  // this flow (their sign-ins skip the emailed code), but resolve the cap
  // per-role so a policy change can't over-evict anyone.
  const cap = await getMaxActiveSessionsForUser({ isAdmin: !!user.isAdmin })
  if (cap !== null) await evictOldestSessions(user.id, Math.max(0, cap - 1))
  const token = await createSession(user.id)
  return { token, user }
}