import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomBytes } from "node:crypto"
import { buildGitHubAuthUrl } from "@/lib/auth/github"
import { handleRouteError } from "@/lib/api/respond"

const STATE_COOKIE   = "Atai_github_oauth_state"
const REFERRAL_COOKIE = "Atai_referral"
const REFERRAL_CODE_RE = /^ATAI-[A-Z0-9](?:[A-Z0-9-]{1,28}[A-Z0-9])$/

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const requestedNext = url.searchParams.get("next")
    const next = requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/dashboard"
    const refCode = url.searchParams.get("ref")?.trim().toUpperCase()

    const nonce     = randomBytes(16).toString("hex")
    const stateVal  = `${nonce}.${Buffer.from(next).toString("base64url")}`
    const authUrl   = buildGitHubAuthUrl(stateVal)

    const jar = await cookies()
    jar.set(STATE_COOKIE, stateVal, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600,
    })
    if (refCode && REFERRAL_CODE_RE.test(refCode) && !jar.get(REFERRAL_COOKIE)?.value) {
      jar.set(REFERRAL_COOKIE, refCode, {
        httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30,
      })
    }

    return NextResponse.redirect(authUrl)
  } catch (e) {
    return handleRouteError("api.auth.github.start", e)
  }
}
