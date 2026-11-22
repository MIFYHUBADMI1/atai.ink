import { NextRequest } from "next/server"
import { ok, handleRouteError } from "@/lib/api/respond"
import { requireCronOrAdmin } from "@/lib/api/cron-auth"
import { recheckVerifiedDomains } from "@/lib/domain/recheck"

// One live fetch per domain; the sweep stops starting new checks at 240s.
export const maxDuration = 300

/**
 * Admin/cron: re-verify businesses that are already verified.
 *
 * A verified claim used to be permanent without evidence. This sweep re-checks
 * the tag/file on a daily schedule, raising attention after one failure and
 * expiring the claim only after `REVERIFICATION_FAILURE_GRACE` consecutive
 * failures — a transient outage never costs a founder their business.
 *
 * Auth:
 *  - GET:  `Authorization: Bearer <CRON_SECRET>` (Vercel Cron), admin fallback
 *  - POST: admin session (console trigger)
 */
async function run(request: NextRequest) {
  const via = await requireCronOrAdmin(request)
  const report = await recheckVerifiedDomains()
  return ok({ report, via })
}

export async function GET(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.domains.recheck", e)
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.domains.recheck", e)
  }
}
