import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { runInfrastructureLifecycleSweep } from "@/lib/infrastructure/service"

// Each due project makes one Totalum cap update.
export const maxDuration = 300

/**
 * Admin/cron: expire paid infrastructure at its paid-through timestamp and
 * downgrade the real Totalum infrastructure cap to the free Testing plan.
 *
 * Idempotent — records already downgraded to Testing are skipped, and a failed
 * cap update is retried on the next run. Historical records without trustworthy
 * terms are marked for review and left active.
 *
 * Auth:
 *  - POST: admin session (console trigger)
 *  - GET:  `Authorization: Bearer <CRON_SECRET>` (Vercel Cron)
 */

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`
}

async function run(request: NextRequest) {
  const viaCron = cronAuthorized(request)
  if (!viaCron) await requireAdmin()
  const report = await runInfrastructureLifecycleSweep()
  return ok({ report, via: viaCron ? "cron" : "admin" })
}

export async function GET(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.infrastructure.expire-sweep", e)
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.infrastructure.expire-sweep", e)
  }
}
