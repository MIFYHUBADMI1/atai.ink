import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { exchangeGitHubCode, getGitHubProfile, getGitHubPrimaryEmail } from "@/lib/auth/github"
import {
  findUserByGitHubId, findUserByEmail,
  createGitHubUser, linkGitHubToUser, updateGitHubToken, touchLastLogin,
} from "@/lib/auth/users"
import { createSession, setSessionCookie, sessionLimitReached } from "@/lib/auth/session"
import { issueSessionVerificationCode } from "@/lib/auth/session-verification"
import { getAppUrl } from "@/lib/env"
import { logger } from "@/lib/logging/logger"
import { captureReferral } from "@/lib/referrals/referrals"

const STATE_COOKIE    = "Atai_github_oauth_state"
const REFERRAL_COOKIE = "Atai_referral"

/** Tell the destination page that a referral bonus landed, so it can confirm
 * the bonus to the person who just joined. */
function withReferralWelcome(path: string, bonus: number): string {
  if (bonus <= 0) return path
  const [base, hash] = path.split("#")
  const separator = base.includes("?") ? "&" : "?"
  return `${base}${separator}welcome=referral&bonus=${bonus}${hash ? `#${hash}` : ""}`
}

export async function GET(req: Request) {
  const appUrl = getAppUrl()
  let stage = "start"
  try {
    const url  = new URL(req.url)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")

    stage = "state-verify"
    const jar = await cookies()
    const expected = jar.get(STATE_COOKIE)?.value
    jar.delete(STATE_COOKIE)

    const [nonce, encodedNext] = state?.split(".") ?? []
    const [expectedNonce]     = expected?.split(".") ?? []
    const next = encodedNext
      ? Buffer.from(encodedNext, "base64url").toString("utf8")
      : "/dashboard"

    if (!code || !nonce || !expectedNonce || nonce !== expectedNonce) {
      return NextResponse.redirect(`${appUrl}/login?error=github_auth_failed`)
    }

    stage = "token-exchange"
    const { accessToken } = await exchangeGitHubCode(code)

    stage = "profile-fetch"
    const profile = await getGitHubProfile(accessToken)

    // Try to get a verified email — profile email may be null if user hides it
    let email = profile.email
    if (!email) {
      email = await getGitHubPrimaryEmail(accessToken)
    }
    if (!email) {
      return NextResponse.redirect(`${appUrl}/login?error=github_no_email`)
    }

    stage = "account-resolve"
    let user = await findUserByGitHubId(profile.githubId)
    let isNewUser = false

    if (user) {
      // Existing GitHub user — refresh token
      await updateGitHubToken(user.id, accessToken)
    } else {
      const existingByEmail = await findUserByEmail(email)
      if (existingByEmail) {
        // Link GitHub to existing account
        await linkGitHubToUser(existingByEmail.id, profile.githubId, profile.login, accessToken, profile.imageUrl)
        user = { ...existingByEmail, githubId: profile.githubId, githubUsername: profile.login }
      } else {
        // Brand-new user
        user = await createGitHubUser({
          email,
          name: profile.name,
          githubId: profile.githubId,
          githubUsername: profile.login,
          githubAccessToken: accessToken,
          imageUrl: profile.imageUrl,
        })
        isNewUser = true
      }
    }

    if (user.banned || user.suspended) {
      const reason = user.banned ? "banned" : "suspended"
      return NextResponse.redirect(`${appUrl}/login?error=account_${reason}`)
    }

    let referralBonus = 0
    if (isNewUser) {
      const refCode = jar.get(REFERRAL_COOKIE)?.value
      if (refCode) {
        const captured = await captureReferral(user.id, refCode).catch((e) => {
          logger.error("api.auth.github.callback", "referral capture failed", { error: (e as Error).message })
          return null
        })
        referralBonus = captured?.signupBonus ?? 0
      }
      jar.delete(REFERRAL_COOKIE)
    }

    const safePath = withReferralWelcome(
      next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard",
      referralBonus,
    )

    // Session cap: confirm via emailed code before evicting old sessions.
    // Without SMTP (local dev) we fall through to normal session creation.
    // Admins skip the code — createSession evicts to their configured cap.
    if (!user.isAdmin && (await sessionLimitReached(user))) {
      const verification = await issueSessionVerificationCode(user)
      if (verification.status === "sent") {
        const params = new URLSearchParams({ vid: verification.verificationId, next: safePath, email: user.email })
        return NextResponse.redirect(`${appUrl}/verify-session?${params.toString()}`)
      }
      if (verification.status === "delivery_failed") {
        return NextResponse.redirect(`${appUrl}/login?error=session_verify_email_failed`)
      }
    }

    stage = "session"
    await touchLastLogin(user.id)
    const token = await createSession(user.id)
    await setSessionCookie(token)

    return NextResponse.redirect(`${appUrl}${safePath}`)
  } catch (e) {
    logger.error("api.auth.github.callback", "OAuth callback failed", {
      stage,
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.redirect(`${appUrl}/login?error=github_auth_failed`)
  }
}
