import { NextRequest } from "next/server"
import { ok, handleRouteError } from "@/lib/api/respond"
import { requireCronOrAdmin } from "@/lib/api/cron-auth"
import { sendClaimNotices } from "@/lib/domain/claim-notices"

/**
 * Admin/cron: warn a founder before an unverified claim expires, and tell them
 * if it already did. Runs daily; the reminder window (48h) is wider than the
 * interval so a 72h reservation always gets at least one reminder.
 *
 * Auth:
 *  - GET:  `Authorization: Bearer <CRON_SECRET>` (Vercel Cron), admin fallback
 *  - POST: admin session (console trigger)
 */
async function run(request: NextRequest) {
  const via = await requireCronOrAdmin(request)
  const report = await sendClaimNotices()
  return ok({ report, via })
}

export async function GET(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.domains.claim-notices", e)
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.domains.claim-notices", e)
  }
}
