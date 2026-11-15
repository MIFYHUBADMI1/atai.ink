import { ObjectId } from "mongodb"
import { ensureIndexes, verificationTokensCol } from "@/lib/db/collections"
import { generateNumericCode, hashToken } from "@/lib/auth/crypto"
import { sendMail } from "@/lib/email/mailer"
import { sessionVerificationEmail } from "@/lib/email/templates"
import { isSmtpConfigured } from "@/lib/env"
import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { createSession, evictOldestSessions, MAX_ACTIVE_SESSIONS } from "@/lib/auth/session"
import { findUserById, type UserDoc } from "@/lib/auth/users"

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

/** Rotate the code on an outstanding verification and re-email it. */
export async function resendSessionVerificationCode(
  verificationId: string,
): Promise<{ sent: boolean; reason?: "unconfigured" | "delivery_failed" | "invalid" }> {
  if (!ObjectId.isValid(verificationId)) return { sent: false, reason: "invalid" }
  const col = await verificationTokensCol()
  const doc = await col.findOne({ _id: new ObjectId(verificationId), purpose: PURPOSE })
  if (!doc || doc.usedAt !== undefined) return { sent: false, reason: "invalid" }
  if (doc.expiresAt.getTime() <= Date.now()) {
    throw new AppError("VERIFICATION_EXPIRED", "This code has expired. Please sign in again to get a new one.")
  }
  const user = await findUserById(doc.userId)
  if (!user) return { sent: false, reason: "invalid" }
  await checkRateLimit({
    action: "session_verify_resend",
    identifier: user.id,
    limit: 5,
    windowMs: 15 * 60_000,
    errorCode: "VERIFICATION_RATE_LIMITED",
  })
  if (!isSmtpConfigured()) return { sent: false, reason: "unconfigured" }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateNumericCode(CODE_DIGITS)
    try {
      await col.updateOne(
        { _id: doc._id },
        { $set: { tokenHash: hashToken(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } },
      )
    } catch (e) {
      if (e instanceof Error && /E11000|duplicate key/i.test(e.message)) continue
      throw e
    }
    const sent = await sendSessionCodeEmail(user, code)
    return sent ? { sent: true } : { sent: false, reason: "delivery_failed" }
  }
  throw new AppError("UNKNOWN")
}

/**
 * Redeem a code: atomically claim the token (single-use), enforce per-user
 * attempt limits, evict the oldest sessions so the account stays under the
 * cap, then create the new session. Returns the raw session token — the
 * caller sets the cookie.
 */
export async function completeSessionVerification(code: string): Promise<{ token: string; user: UserDoc }> {
  await ensureIndexes()
  const col = await verificationTokensCol()
  const now = Date.now()
  const claimed = await col.findOneAndUpdate(
    {
      tokenHash: hashToken(code),
      purpose: PURPOSE,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date(now) },
    },
    { $set: { usedAt: now } },
    { returnDocument: "after" },
  )
  if (!claimed) {
    throw new AppError("VERIFICATION_INVALID", "That code is invalid or has expired. Please request a new one.")
  }

  await checkRateLimit({
    action: "session_verify",
    identifier: claimed.userId,
    limit: 8,
    windowMs: 15 * 60_000,
    errorCode: "VERIFICATION_RATE_LIMITED",
  })

  const user = await findUserById(claimed.userId)
  if (!user) throw new AppError("VERIFICATION_INVALID")
  if (user.banned || user.suspended) throw new AppError("UNAUTHORIZED")

  // Make room: keep the newest MAX-1 existing sessions, then the fresh
  // session below lands the account at exactly the cap.
  await evictOldestSessions(user.id, MAX_ACTIVE_SESSIONS - 1)
  const token = await createSession(user.id)
  return { token, user }
}
