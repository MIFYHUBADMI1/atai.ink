import { requireUser } from "@/lib/auth/session"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { fail, handleRouteError, ok } from "@/lib/api/respond"
import { getAppUrl } from "@/lib/env"
import { store } from "@/lib/store/store"
import { createApiKey, revokeApiKey } from "@/lib/runtime/keys/service"
import { businessStartingPointOf } from "@/lib/types/business-intake"
import {
  CONNECTION_KEY_SCOPES,
  INTEGRATION_GUIDE_VERSION,
  buildIntegrationGuide,
} from "@/lib/connected-business/guide"
import {
  connectionView,
  markGuideIssued,
  refreshConnectionStatus,
  revokeConnection,
} from "@/lib/connected-business/service"

/**
 * Integration guide for a connected business.
 *
 * GET  — preview without any credential (safe to copy from the page).
 * POST — issues a fresh, scope-restricted connection key and returns the
 *        downloadable guide containing it ONCE. Re-issuing revokes the key the
 *        previous guide carried, so a business never accumulates live keys.
 * DELETE — disconnects: revokes the key and marks the connection revoked.
 *
 * Owner-gated and existing-business only. No secret is ever logged or returned
 * by GET.
 */

const CONNECTION_KEY_NAME = "Connection guide"

async function ownedConnectedProject(id: string) {
  const user = await requireUser()
  const project = await store.getProject(id)
  if (!project || project.userId !== user.id) {
    return { error: fail("UNAUTHORIZED_PROJECT_ACCESS", "We couldn't find this business.", 404) } as const
  }
  if (businessStartingPointOf(project) !== "existing_business") {
    return { error: fail("NOT_A_CONNECTED_BUSINESS", "This project is not a connected business.", 409) } as const
  }
  return { user, project } as const
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const owned = await ownedConnectedProject(id)
    if ("error" in owned) return owned.error
    const { project } = owned

    const view = await connectionView(project)
    const markdown = buildIntegrationGuide({
      projectId: project.id,
      businessName: project.intake?.displayName || project.name,
      ...(project.intake?.website?.url ? { appUrl: project.intake.website.url } : {}),
      ...(view.verifiedDomain ? { verifiedHostname: view.verifiedDomain.hostname } : {}),
      apiBaseUrl: getAppUrl(),
      objectives: project.intake?.objectives ?? [],
    })

    return ok({
      guideVersion: INTEGRATION_GUIDE_VERSION,
      markdown,
      connection: { status: view.status, ...(view.connection ?? {}) },
      domainVerified: Boolean(view.verifiedDomain),
    })
  } catch (e) {
    return handleRouteError("api.projects.integrationGuide.get", e)
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const owned = await ownedConnectedProject(id)
    if ("error" in owned) return owned.error
    const { user, project } = owned

    await checkRateLimit({
      action: "connected_business_guide",
      identifier: user.id,
      limit: 6,
      windowMs: 60 * 60_000,
    })

    // One live connection key per business: revoke the previous guide's key
    // before issuing a replacement.
    const previousKeyId = project.connection?.keyId
    if (previousKeyId) {
      await revokeApiKey(user.id, previousKeyId, "connection guide reissued", project.id).catch(() => false)
    }

    const created = await createApiKey(user.id, {
      projectId: project.id,
      name: CONNECTION_KEY_NAME,
      environment: "production",
      scopes: [...CONNECTION_KEY_SCOPES],
    })

    const status = await markGuideIssued({
      projectId: project.id,
      keyId: created.id,
      guideVersion: INTEGRATION_GUIDE_VERSION,
    })

    const view = await connectionView(project)
    const markdown = buildIntegrationGuide({
      projectId: project.id,
      businessName: project.intake?.displayName || project.name,
      ...(project.intake?.website?.url ? { appUrl: project.intake.website.url } : {}),
      ...(view.verifiedDomain ? { verifiedHostname: view.verifiedDomain.hostname } : {}),
      apiBaseUrl: getAppUrl(),
      objectives: project.intake?.objectives ?? [],
      keySecret: created.secret,
      keyPrefix: created.keyPrefix,
    })

    return ok({
      guideVersion: INTEGRATION_GUIDE_VERSION,
      markdown,
      keyPrefix: created.keyPrefix,
      keyId: created.id,
      connection: { status: status ?? view.status, ...(view.connection ?? {}) },
      domainVerified: Boolean(view.verifiedDomain),
    })
  } catch (e) {
    return handleRouteError("api.projects.integrationGuide.post", e)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const owned = await ownedConnectedProject(id)
    if ("error" in owned) return owned.error
    const { user, project } = owned

    const keyId = project.connection?.keyId
    if (keyId) {
      await revokeApiKey(user.id, keyId, "connection disconnected", project.id).catch(() => false)
    }
    await revokeConnection(project.id, "disconnected by the founder")
    const status = await refreshConnectionStatus(project.id)

    return ok({ disconnected: true, connection: { status: status ?? "revoked" } })
  } catch (e) {
    return handleRouteError("api.projects.integrationGuide.delete", e)
  }
}
