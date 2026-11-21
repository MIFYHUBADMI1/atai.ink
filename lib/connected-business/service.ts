import "server-only"

import { projectsCol } from "@/lib/db/collections"
import { listProjectDomains } from "@/lib/domain/service"
import { logger } from "@/lib/logging/logger"
import { store } from "@/lib/store/store"
import type {
  BusinessConnection,
  BusinessConnectionStatus,
  BusinessDomainDoc,
} from "@/lib/types/business-intake"
import type { MirrorProject } from "@/lib/types/project"
import { isConnectedBusiness } from "./guards"
import { businessConnectionStatus } from "./status"

/**
 * Write path for the connection record.
 *
 * Every mutation recomputes the derived status from the facts + the domain
 * records, so the cached `connection.status` can never disagree with them.
 * All writes are dotted `$set`s: the connection record is shared with the
 * runtime handshake, which may fire while the founder is downloading a guide.
 */

/** A handshake is recorded at most this often per project — the runtime may
 * call health on every boot, and this must not become a write amplifier. */
const TOUCH_INTERVAL_MS = 60_000

export interface ConnectionView {
  status: BusinessConnectionStatus
  connection?: BusinessConnection
  domains: BusinessDomainDoc[]
  verifiedDomain?: BusinessDomainDoc
}

export async function verifiedDomainFor(projectId: string): Promise<BusinessDomainDoc | null> {
  const domains = await listProjectDomains(projectId)
  return domains.find((domain) => domain.status === "verified") ?? null
}

export async function hasVerifiedDomain(projectId: string): Promise<boolean> {
  return Boolean(await verifiedDomainFor(projectId))
}

/**
 * Recompute and persist the derived status. Cheap (one project read + one
 * indexed domain read) and idempotent, so any write path may call it.
 */
export async function refreshConnectionStatus(projectId: string): Promise<BusinessConnectionStatus | null> {
  const project = await store.getProject(projectId)
  if (!project || !isConnectedBusiness(project)) return null

  const domains = await listProjectDomains(projectId)
  const domainVerified = domains.some((domain) => domain.status === "verified")
  const now = Date.now()
  const status = businessConnectionStatus({ connection: project.connection, domainVerified, now })

  const set: Record<string, unknown> = { "connection.status": status }
  if (!project.connection?.verifiedAt && status === "verified") set["connection.verifiedAt"] = now

  await (await projectsCol()).updateOne({ id: projectId }, { $set: set })
  return status
}

/** The founder downloaded the integration guide with a fresh connection key. */
export async function markGuideIssued(input: {
  projectId: string
  keyId: string
  guideVersion: string
}): Promise<BusinessConnectionStatus | null> {
  const now = Date.now()
  await (await projectsCol()).updateOne(
    { id: input.projectId },
    {
      $set: {
        "connection.guideIssuedAt": now,
        "connection.guideVersion": input.guideVersion,
        "connection.keyId": input.keyId,
        updatedAt: now,
      },
    },
  )
  return refreshConnectionStatus(input.projectId)
}

/**
 * Record an authenticated call from the customer's application. This is the
 * only proof Atai accepts that an external app is genuinely connected.
 * Throttled so a chatty app cannot turn a health check into a write storm.
 */
export async function recordConnectionSeen(input: {
  projectId: string
  apiKeyId?: string
  now?: number
}): Promise<BusinessConnectionStatus | null> {
  const now = input.now ?? Date.now()
  const project = await store.getProject(input.projectId)
  if (!project || !isConnectedBusiness(project)) return null

  const existing = project.connection
  if (existing?.lastSeenAt && now - existing.lastSeenAt < TOUCH_INTERVAL_MS) {
    return existing.status ?? null
  }

  const domains = await listProjectDomains(input.projectId)
  const domainVerified = domains.some((domain) => domain.status === "verified")
  const next: BusinessConnection = {
    ...existing,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    seenCalls: (existing?.seenCalls ?? 0) + 1,
    ...(input.apiKeyId && !existing?.keyId ? { keyId: input.apiKeyId } : {}),
  }
  const status = businessConnectionStatus({ connection: next, domainVerified, now })
  next.status = status

  const set: Record<string, unknown> = {
    "connection.firstSeenAt": next.firstSeenAt,
    "connection.lastSeenAt": now,
    "connection.seenCalls": next.seenCalls,
    "connection.status": status,
    updatedAt: now,
  }
  if (!existing?.verifiedAt && status === "verified") set["connection.verifiedAt"] = now
  if (input.apiKeyId && !existing?.keyId) set["connection.keyId"] = input.apiKeyId

  await (await projectsCol()).updateOne({ id: input.projectId }, { $set: set })
  logger.info("connected-business.handshake", "application called Atai", {
    projectId: input.projectId,
    status,
    first: !existing?.firstSeenAt,
  })
  return status
}

export async function revokeConnection(projectId: string, reason: string): Promise<void> {
  const now = Date.now()
  await (await projectsCol()).updateOne(
    { id: projectId },
    {
      $set: {
        "connection.revokedAt": now,
        "connection.revokedReason": reason,
        "connection.status": "revoked" satisfies BusinessConnectionStatus,
        updatedAt: now,
      },
    },
  )
}

export async function connectionView(project: MirrorProject): Promise<ConnectionView> {
  const domains = await listProjectDomains(project.id)
  const verifiedDomain = domains.find((domain) => domain.status === "verified")
  const status = businessConnectionStatus({
    connection: project.connection,
    domainVerified: Boolean(verifiedDomain),
  })
  return {
    status,
    ...(project.connection ? { connection: project.connection } : {}),
    domains,
    ...(verifiedDomain ? { verifiedDomain } : {}),
  }
}
