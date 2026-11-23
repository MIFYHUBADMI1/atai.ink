import { ok, fail, handleRouteError } from "@/lib/api/respond"
import { requireUser } from "@/lib/auth/session"
import { getOrCreateReferralCode, getReferralsByReferrer, getReferralStats, normalizeCustomReferralCode, setReferralCode } from "@/lib/referrals/referrals"
import { getPublicBaseUrl } from "@/lib/env"
import { getRewardSettings } from "@/lib/billing/runtime-config"

/**
 * GET /api/referrals
 * Returns the current user's referral code, link, stats, and referral list.
 */
export async function GET() {
  try {
    const user = await requireUser()

    const [referralCode, rewards] = await Promise.all([
      getOrCreateReferralCode(user.id),
      getRewardSettings(),
    ])
    const referralLink = `${getPublicBaseUrl()}/register?ref=${referralCode}`
    const stats = await getReferralStats(user.id)

    // Get referrals with limited info (privacy-safe)
    const referrals = await getReferralsByReferrer(user.id)
    const referralList = referrals.map((r) => ({
      id: r.id,
      status: r.status,
      verificationRewardIssued: r.verificationRewardIssued,
      milestoneRewardIssued: r.milestoneRewardIssued,
      eligibleUsage: r.eligibleUsage,
      createdAt: r.createdAt,
    }))

    return ok({
      referralCode,
      referralLink,
      stats,
      referrals: referralList,
      rewards,
    })
  } catch (e) {
    return handleRouteError("api.referrals", e)
  }
}

/**
 * PATCH /api/referrals
 * Update the caller's referral code. Body: { code?: string } — a custom
 * ATAI-… code, or { auto: true } to generate a fresh one.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser()
    const body = (await req.json().catch(() => ({}))) as { code?: unknown; auto?: unknown }

    let code: string
    if (body.auto === true || body.code === undefined || body.code === null || body.code === "") {
      code = await setReferralCode(user.id)
    } else if (typeof body.code === "string") {
      const normalized = normalizeCustomReferralCode(body.code)
      if (!normalized) {
        return fail("VALIDATION", "Referral code must start with ATAI- and use 3–30 letters, numbers, or dashes after it.", 422)
      }
      try {
        code = await setReferralCode(user.id, normalized)
      } catch (e) {
        return fail("VALIDATION", e instanceof Error ? e.message : "That referral code is not available.", 422)
      }
    } else {
      return fail("VALIDATION", "Please provide a referral code or auto: true.", 422)
    }

    return ok({ referralCode: code, referralLink: `${getPublicBaseUrl()}/register?ref=${code}` })
  } catch (e) {
    return handleRouteError("api.referrals", e)
  }
}
