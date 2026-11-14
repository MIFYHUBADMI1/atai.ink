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
 */
export async function POST(_request: NextRequest) {
  try {
    await requireAdmin()
    const report = await runAnnualGrantSweep()
    return ok({ report })
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.annual-sweep", e)
  }
}
