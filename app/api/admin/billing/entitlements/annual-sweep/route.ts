import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { runAnnualGrantSweep } from "@/lib/billing/entitlements/annual-scheduler"

/**
 * Admin: trigger the annual subscription monthly-issuance sweep.
 *
 * Idempotent — re-running only grants months not yet issued (per the canonical
 * grant idempotency key). Designed to be invoked by a daily cron/worker OR
 * manually from the admin console. Does not change the enforcement flag; it only
 * issues the monthly subscription-credit grants that annual subscribers have
 * already paid for (gated on the upfront annual payment having succeeded).
 *
 * Auth:
 *  - POST: admin session (console trigger)
 *  - GET:  `Authorization: Bearer <CRON_SECRET>` — this is how Vercel Cron calls
 *          it (see vercel.json). Falls back to admin for a manual GET.
 */

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`
}

async function run(request: NextRequest) {
  const viaCron = cronAuthorized(request)
  if (!viaCron) {
    // Admin path — throws (handled below) when the caller is not an admin.
    await requireAdmin()
  }
  const report = await runAnnualGrantSweep()
  return ok({ report, via: viaCron ? "cron" : "admin" })
}

export async function GET(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.annual-sweep", e)
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.annual-sweep", e)
  }
}
