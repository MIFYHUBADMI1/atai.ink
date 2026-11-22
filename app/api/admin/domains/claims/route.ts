import { requireAdmin } from "@/lib/auth/session"
import { fail, ok, handleRouteError } from "@/lib/api/respond"
import { readJsonBody } from "@/lib/api/request-body"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { listBusinessClaims, releaseBusinessClaimForSupport } from "@/lib/domain/claims-admin"

/**
 * Admin: who holds each connected business, and the support release.
 *
 * The release is the documented exception to "one business, one account" — for
 * an owner who lost access to the account holding their site. It never deletes
 * anything: the claim is marked released with the operator and reason recorded.
 */
export async function GET() {
  try {
    await requireAdmin()
    return ok({ claims: await listBusinessClaims() })
  } catch (error) {
    return handleRouteError("admin.domains.claims.get", error)
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin()
    await checkRateLimit({ action: "admin_claim_release", identifier: admin.id, limit: 30, windowMs: 60 * 60_000 })

    const body = await readJsonBody(req, 4096)
    const hostname = typeof body.hostname === "string" ? body.hostname.trim() : ""
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!hostname) return fail("VALIDATION", "Enter the hostname to release.", 422)
    if (reason.length < 8) {
      return fail("VALIDATION", "Write why this release is happening — it is kept in the record's history.", 422)
    }

    const result = await releaseBusinessClaimForSupport({ hostname, reason, actorId: admin.id })
    if (result.released.length === 0) {
      return fail("NOT_FOUND", `No active claim for ${result.canonicalHostname}.`, 404)
    }
    return ok(result)
  } catch (error) {
    return handleRouteError("admin.domains.claims.post", error)
  }
}
