import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { sweepExpiredSubscriptionCredits } from "@/lib/billing/credit-sweep"

/**
 * Admin/cron: expire overdue subscription credits across all accounts.
 *
 * Subscription credits belong to a billing period — when the period ends the
 * leftover credits die (permanent credits never expire). Removal normally
 * happens lazily on balance reads and at consumption time; this endpoint
 * sweeps accounts that never trigger a read.
 *
 * Idempotent — re-running only removes buckets not yet expired (per-bucket
 * ledger keys). Does not grant anything; renewal grants arrive via Dodo
 * webhooks and the annual sweep.
 *
 * Auth:
 *  - POST: admin session (console trigger)
 *  - GET:  `Authorization: Bearer <CRON_SECRET>` — this is how Vercel Cron
 *          calls it (see vercel.json). Falls back to admin for a manual GET.
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
  const report = await sweepExpiredSubscriptionCredits()
  return ok({ report, via: viaCron ? "cron" : "admin" })
}

export async function GET(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.billing.credits.expire-sweep", e)
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.billing.credits.expire-sweep", e)
  }
}
