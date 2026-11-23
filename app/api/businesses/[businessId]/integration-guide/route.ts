import "server-only"

import { handleRouteError, ok } from "@/lib/api/respond"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { requireUser } from "@/lib/auth/session"
import { actorOf, requireWorkspace } from "@/lib/business/http"
import { resolveBusinessAnchorProject } from "@/lib/connected-business/anchor"
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
import { getAppUrl } from "@/lib/env"
import { createApiKey, revokeApiKey } from "@/lib/runtime/keys/service"

/**
 * Integration guide for a connected business, addressed by business.
 *
 * GET  — preview without any credential (safe to copy from the page).
 * POST — issues a fresh, scope-restricted connection key and returns the
 *        downloadable guide containing it ONCE. Re-issuing revokes the key the
 *        previous guide carried, so a business never accumulates live keys.
 * DELETE — disconnects: revokes the key and marks the connection revoked.
 *
 * Membership-gated. The key belongs to the account that owns the project, so
 * key operations use `ownerId`, never the acting member.
 */

const CONNECTION_KEY_NAME = "Connection guide"

export async function GET(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "read")
    const { businessId } = await params

    const { project } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "growth.read",
    })

    const view = await connectionView(project)
    const markdown = buildIntegrationGuide({
      projectId: project.id,
      businessName: project.intake?.displayName || project.name,
      ...(project.intake?.website?.url ? { appUrl: project.intake.website.url } : {}),
      ...(view.verifiedDomain ? { verifiedHostname: view.verifiedDomain.hostname } : {}),
      apiBaseUrl: getAppUrl(),
    })

    return ok({
      guideVersion: INTEGRATION_GUIDE_VERSION,
      markdown,
      connection: { status: view.status, ...(view.connection ?? {}) },
      domainVerified: Boolean(view.verifiedDomain),
    })
  } catch (e) {
    return handleRouteError("api.businesses.integrationGuide.get", e)
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await params

    const { project, ownerId } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "runtime.keys.manage",
    })

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
      await revokeApiKey(ownerId, previousKeyId, "connection guide reissued", project.id).catch(() => false)
    }

    const created = await createApiKey(ownerId, {
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
    return handleRouteError("api.businesses.integrationGuide.post", e)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  try {
    const user = await requireUser()
    await requireWorkspace(user.id, "write")
    const { businessId } = await params

    const { project, ownerId } = await resolveBusinessAnchorProject({
      businessId,
      actor: actorOf(user),
      permission: "runtime.keys.manage",
    })

    const keyId = project.connection?.keyId
    if (keyId) {
      await revokeApiKey(ownerId, keyId, "connection disconnected", project.id).catch(() => false)
    }
    await revokeConnection(project.id, "disconnected by the founder")
    const status = await refreshConnectionStatus(project.id)

    return ok({ disconnected: true, connection: { status: status ?? "revoked" } })
  } catch (e) {
    return handleRouteError("api.businesses.integrationGuide.delete", e)
  }
}
