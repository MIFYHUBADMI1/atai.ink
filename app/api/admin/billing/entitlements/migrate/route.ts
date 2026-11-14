import { NextRequest } from "next/server"
import { requireAdmin } from "@/lib/auth/session"
import { ok, handleRouteError } from "@/lib/api/respond"
import { migrateSubscriptionEntitlements } from "@/lib/billing/entitlements/migrate"

/**
 * Admin: run the legacy → commercial entitlement migration.
 *
 * SAFE BY DEFAULT: GET (or POST without `mode: "apply"`) performs a DRY RUN and
 * writes NOTHING. Pass `{ "mode": "apply" }` to persist. This only *adds* the
 * new commercial-plan fields + a frozen snapshot — it never renames the stored
 * `planId`/`dodoProductId`, and it does NOT enable enforcement. The
 * `ENTITLEMENT_ENFORCEMENT_ENABLED` flag stays off until the migration is
 * reviewed on real data AND the Phase 4 financial model ratifies credit/quota
 * numbers.
 */
export async function GET() {
  try {
    await requireAdmin()
    const report = await migrateSubscriptionEntitlements({ mode: "dry-run" })
    return ok({ mode: report.mode, report })
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.migrate.dryrun", e)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin()
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string
      batchId?: string
      force?: boolean
    }
    const mode = body.mode === "apply" ? "apply" : "dry-run"
    const report = await migrateSubscriptionEntitlements({
      mode,
      batchId: typeof body.batchId === "string" ? body.batchId : undefined,
      force: body.force === true,
    })
    return ok({ mode: report.mode, report })
  } catch (e) {
    return handleRouteError("api.admin.billing.entitlements.migrate", e)
  }
}
