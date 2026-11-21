import { authenticateRuntimeRequest } from "@/lib/runtime/auth/authenticate"
import { recordConnectionSeen } from "@/lib/connected-business/service"
import { ok, handleRouteError } from "@/lib/api/respond"

/**
 * Atai Runtime API — authenticated project health check.
 *
 * GET /api/runtime/v1/health
 *   Authorization: Bearer <Atai runtime API key>
 *
 * Lets a generated application verify "Atai Runtime connected" without
 * exposing the key or any provider internals. The response carries SAFE
 * METADATA ONLY: the correlation request ID, the trusted identity derived
 * from the key record (never from the request), lifecycle status, and the
 * documented request lifecycle stages. No secrets, no hashes, no provider
 * names beyond what the capability registry already publishes, no other
 * projects' data.
 *
 * This is the SAME authentication path as the invocation route (Phase 4) —
 * a health check that succeeds here proves the credential is active, the
 * limiter is reachable, and the identity context resolves.
 */

/** The documented request lifecycle, echoed for observability parity. */
const REQUEST_LIFECYCLE_STAGES = [
  "authenticated",
  "scope_validated",
  "capability_resolved",
  "model_resolved",
  "provider_selected",
  "provider_request",
  "response_normalized",
  "usage_recorded",
  "charge_recorded",
] as const

export async function GET(req: Request) {
  try {
    const auth = await authenticateRuntimeRequest(req)

    // A successful authenticated call from an application that runs outside
    // Atai is the handshake for a connected business. It is recorded as a fact;
    // it never fails the health check and never affects other projects
    // (recordConnectionSeen ignores projects that are not connected businesses).
    await recordConnectionSeen({ projectId: auth.projectId, apiKeyId: auth.apiKeyId }).catch(() => null)

    return ok({
      status: "operational" as const,
      requestId: auth.requestId,
      identity: {
        projectId: auth.projectId,
        environment: auth.environment,
        apiKeyId: auth.apiKeyId,
        scopes: auth.scopes,
      },
      key: {
        status: "active" as const,
        lastUsedAt: Date.now(),
      },
      lifecycle: REQUEST_LIFECYCLE_STAGES,
    })
  } catch (e) {
    return handleRouteError("api.runtime.v1.health", e)
  }
}
