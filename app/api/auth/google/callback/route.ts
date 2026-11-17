import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { exchangeGoogleCode } from "@/lib/auth/google"
import { findUserByEmail, findUserByGoogleId, createGoogleUser, linkGoogleToUser, linkGoogleIdentity, touchLastLogin } from "@/lib/auth/users"
import { createSession, setSessionCookie, sessionLimitReached, getCurrentUser } from "@/lib/auth/session"
import { issueSessionVerificationCode } from "@/lib/auth/session-verification"
import { getAppUrl } from "@/lib/env"
import { logger } from "@/lib/logging/logger"
import { captureReferral } from "@/lib/referrals/referrals"

const STATE_COOKIE = "Atai_oauth_state"

/**
 * Google OAuth callback (spec section 3). Verifies the CSRF `state`,
 * exchanges the code for a verified ID token, then either:
 *   1. Logs in an existing Google-linked user,
 *   2. Links Google onto an existing password account with the same email
 *      (account-linking-by-email), or
 *   3. Creates a brand-new, pre-verified Google user.
 * Any failure redirects back to /login with an error flag rather than
 * throwing a raw 500 — this endpoint is hit via full-page browser redirect.
 */
export async function GET(req: Request) {
  const appUrl = getAppUrl()
  let stage = "start"
  try {
    const url = new URL(req.url)
    stage = "state"
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const jar = await cookies()
    const expectedState = jar.get(STATE_COOKIE)?.value
    jar.delete(STATE_COOKIE)
    const [stateNonce, encodedNext, intent] = state?.split(".") ?? []
    const [expectedNonce] = expectedState?.split(".") ?? []
    const nextFromState = encodedNext ? Buffer.from(encodedNext, "base64url").toString("utf8") : "/workspace"
    const safeNext = nextFromState.startsWith("/") && !nextFromState.startsWith("//") ? nextFromState : "/workspace"
    const isConnect = intent === "connect"

    if (!code || !stateNonce || !expectedNonce || stateNonce !== expectedNonce) {
      return NextResponse.redirect(`${appUrl}/login?error=google_auth_failed`)
    }

    stage = "exchange"
    const profile = await exchangeGoogleCode(code)

    // Explicit "Connect Google" flow: the visitor is already signed in and
    // asked to link this Google identity to THEIR account. We never resolve
    // by email or create/switch sessions here — just bind the googleId.
    if (isConnect) {
      stage = "connect-session"
      const current = await getCurrentUser()
      if (!current) {
        return NextResponse.redirect(`${appUrl}/login?error=google_connect_login_required`)
      }
      if (!profile.emailVerified) {
        return NextResponse.redirect(`${appUrl}${safeNext}?error=google_email_unverified`)
      }
      const alreadyLinked = await findUserByGoogleId(profile.googleId)
      if (alreadyLinked && alreadyLinked.id !== current.id) {
        return NextResponse.redirect(`${appUrl}${safeNext}?error=google_already_linked`)
      }
      if (current.googleId && current.googleId !== profile.googleId) {
        return NextResponse.redirect(`${appUrl}${safeNext}?error=google_already_linked`)
      }
      if (!alreadyLinked) {
        await linkGoogleIdentity(current.id, profile.googleId, profile.imageUrl)
      }
      return NextResponse.redirect(`${appUrl}${safeNext}?google=connected`)
    }

    stage = "find-google-user"
    let user = await findUserByGoogleId(profile.googleId)
    let isNewUser = false

    if (!user) {
      stage = "find-email-user"
      const existingByEmail = await findUserByEmail(profile.email)
      if (existingByEmail) {
        // Linking a Google identity onto an existing password account must
        // require a verified Google email — otherwise anyone who can put an
        // arbitrary unverified address on a Google profile could take over
        // that account.
        if (!profile.emailVerified) {
          return NextResponse.redirect(`${appUrl}/login?error=google_email_unverified`)
        }
        await linkGoogleToUser(existingByEmail.id, profile.googleId, profile.imageUrl)
        user = { ...existingByEmail, googleId: profile.googleId }
      } else {
        user = await createGoogleUser({
          email: profile.email,
          name: profile.name,
          googleId: profile.googleId,
          imageUrl: profile.imageUrl,
        })
        isNewUser = true
      }
    }

    // Capture referral if this is a new user and a referral code was stored
    if (isNewUser) {
      const referralCookie = jar.get("Atai_referral")?.value
      if (referralCookie) {
        await captureReferral(user.id, referralCookie).catch((e) => {
          logger.error("api.auth.google.callback", "referral capture failed", { error: e instanceof Error ? e.message : String(e) })
        })
      }
      jar.delete("Atai_referral")
    }

    if (user.banned || user.suspended) {
      const reason = user.banned ? "banned" : "suspended"
      return NextResponse.redirect(`${appUrl}/login?error=account_${reason}`)
    }

    const next = nextFromState.startsWith("/") && !nextFromState.startsWith("//") ? nextFromState : "/workspace"

    // Session cap: confirm via emailed code before evicting old sessions.
    // Without SMTP (local dev) we fall through to normal session creation.
    // Admins skip the code — createSession evicts to their configured cap.
    if (!user.isAdmin && (await sessionLimitReached(user))) {
      const verification = await issueSessionVerificationCode(user)
      if (verification.status === "sent") {
        const params = new URLSearchParams({ vid: verification.verificationId, next, email: user.email })
        return NextResponse.redirect(`${appUrl}/verify-session?${params.toString()}`)
      }
      if (verification.status === "delivery_failed") {
        return NextResponse.redirect(`${appUrl}/login?error=session_verify_email_failed`)
      }
    }

    stage = "touch-login"
    await touchLastLogin(user.id)
    stage = "create-session"
    const token = await createSession(user.id)
    await setSessionCookie(token)

    return NextResponse.redirect(`${appUrl}${next}`)
  } catch (e) {
    logger.error("api.auth.google.callback", "OAuth callback failed", { stage, errorName: e instanceof Error ? e.name : "UnknownError", errorMessage: e instanceof Error ? e.message : String(e) })
    const params = new URLSearchParams({ error: "google_auth_failed", stage })
    return NextResponse.redirect(`${appUrl}/login?${params.toString()}`)
  }
}
