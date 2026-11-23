import { NextRequest } from "next/server"
import { ok, handleRouteError } from "@/lib/api/respond"
import { requireCronOrAdmin } from "@/lib/api/cron-auth"
import { sweepResourceHolds } from "@/lib/billing/entitlements/hold-maintenance"

export const maxDuration = 60

/**
 * Admin/cron: reconcile billing capacity holds.
 *
 * Removes expired locks, releases holds for deleted projects, and releases
 * slot holds whose real domain/subdomain is already persisted. A storage hold
 * for a live project is kept until its TTL because it is what counts the
 * in-flight bytes.
 *
 * GET (cron) applies by default; `?dryRun=true` reports without deleting.
 * POST (admin console) accepts `{ "apply": false }` for a dry run.
 */
async function run(request: NextRequest) {
  const via = await requireCronOrAdmin(request)
  const url = new URL(request.url)
  let apply = url.searchParams.get("dryRun") !== "true"
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { apply?: boolean }
    if (body.apply === false) apply = false
  }
  const report = await sweepResourceHolds({ apply })
  return ok({ report, via })
}

export async function GET(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.resource-holds", e)
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request)
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.resource-holds", e)
  }
}
