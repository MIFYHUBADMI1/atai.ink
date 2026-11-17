import { requireUser, destroyAllSessionsForUser, clearSessionCookie } from "@/lib/auth/session"
import { softDeleteUser } from "@/lib/auth/users"
import { verifyPassword } from "@/lib/auth/crypto"
import { checkAuthRequest } from "@/lib/auth/request-limit"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { readAuthBody } from "@/lib/api/request-body"
import { subscriptionRecordsCol } from "@/lib/db/collections"
import { ok, fail, handleRouteError } from "@/lib/api/respond"

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "paused", "payment_failed"])

/**
 * POST /api/me/delete-account
 * Self-service account deletion. Password users re-authenticate with their
 * current password; OAuth users confirm by typing their account email. An
 * active paid subscription must be cancelled and reach its period end first so
 * we never strand a renewal or paid entitlement.
 */
export async function POST(req: Request) {
  try {
    await checkAuthRequest(req, "delete_account")
    const user = await requireUser()
    const body = await readAuthBody(req)

    if (body.confirm !== true) {
      return fail("VALIDATION", "Confirm that you want to permanently delete your account.", 422)
    }

    await checkRateLimit({
      action: "account_delete",
      identifier: user.id,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    })

    // A wrong re-authentication is charged against a separate, DAILY attempt
    // budget (5/day) so nobody can grind through password guesses while the
    // hourly bucket keeps resetting. Correct credentials are never charged.
    const reauthFailed = async () => {
      await checkRateLimit({
        action: "account_delete_reauth_fail",
        identifier: user.id,
        limit: 5,
        windowMs: 24 * 60 * 60 * 1000,
      })
    }

    if (user.authProvider === "password") {
      if (typeof body.currentPassword !== "string" || !body.currentPassword || body.currentPassword.length > 1024) {
        return fail("VALIDATION", "Enter your current password to delete your account.", 422)
      }
      if (!user.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
        await reauthFailed()
        return fail("VALIDATION", "Password is incorrect.", 422)
      }
    } else {
      const confirmEmail = typeof body.confirmEmail === "string" ? body.confirmEmail.trim().toLowerCase() : ""
      if (!confirmEmail || confirmEmail !== user.email.toLowerCase()) {
        await reauthFailed()
        return fail("VALIDATION", "Type your account email to confirm deletion.", 422)
      }
    }

    const latestSub = await (await subscriptionRecordsCol())
      .find({ userId: user.id })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray()
    const sub = latestSub[0]
    if (sub && ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status)) {
      return fail(
        "SUBSCRIPTION_ACTIVE",
        "Cancel your subscription and wait until the billing period ends before deleting your account.",
        409,
      )
    }

    await softDeleteUser(user.id)
    await destroyAllSessionsForUser(user.id)
    await clearSessionCookie()

    return ok({ deleted: true })
  } catch (e) {
    return handleRouteError("api.me.delete_account", e)
  }
}
