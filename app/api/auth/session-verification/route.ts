import { ok, handleRouteError } from "@/lib/api/respond"
import { checkAuthRequest } from "@/lib/auth/request-limit"
import { readAuthBody } from "@/lib/api/request-body"
import { AppError } from "@/lib/errors"
import { setSessionCookie } from "@/lib/auth/session"
import { completeSessionVerification, resendSessionVerificationCode } from "@/lib/auth/session-verification"
import { toPublicUser } from "@/lib/auth/users"

/**
 * Email-confirmed sign-in when the account is already at the session cap.
 * `action: "verify"` redeems the emailed code — evicting the oldest sessions
 * and creating the new one. `action: "resend"` rotates the code on an
 * outstanding verification (needs the `verificationId` returned at issue).
 */
export async function POST(req: Request) {
  try {
    await checkAuthRequest(req, "session_verification")
    const body = await readAuthBody(req)

    if (body.action === "verify") {
      const code = typeof body.code === "string" ? body.code.trim() : ""
      if (!/^\d{6}$/.test(code)) {
        throw new AppError("VALIDATION", "Enter the 6-digit code from your email.")
      }
      const { token, user } = await completeSessionVerification(code)
      await setSessionCookie(token)
      return ok({ user: toPublicUser(user) })
    }

    if (body.action === "resend") {
      const id = typeof body.id === "string" ? body.id : ""
      return ok(await resendSessionVerificationCode(id))
    }

    throw new AppError("VALIDATION")
  } catch (e) {
    return handleRouteError("api.auth.session-verification", e)
  }
}
