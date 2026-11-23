import "server-only"

import { AppError } from "@/lib/errors"
import { connectedApplicationsCol } from "@/lib/db/collections"
import { normalizeHostname } from "@/lib/domain/host"
import { cryptoId } from "@/lib/store/id"
import {
  APPLICATION_KINDS,
  type ApplicationKind,
  type ConnectedApplicationDoc,
  type MigrationStamp,
} from "@/lib/types/business"
import { requireBusinessAccess } from "./access"
import { PathInputError, applicationOrigin, canonicalBasePath } from "./paths"
import type { Actor } from "./permissions"

/**
 * Connected applications (ADR-8 §8, D1).
 *
 * Identity is (businessId, hostname, basePath). Paths are organisational: every
 * application on one hostname shares `trustDomain`, because a key for /shop is
 * only as safe as the server that also holds the key for /dashboard.
 *
 * Every operation authorises itself through the business gate, with the
 * application id supplied whenever the operation targets one application, so a
 * member's application scope is always applied.
 *
 * @module lib/business/applications
 */

export function isApplicationKind(value: string): value is ApplicationKind {
  return (APPLICATION_KINDS as readonly string[]).includes(value)
}

export interface CreateApplicationInput {
  businessId: string
  actor: Actor
  name: string
  kind: ApplicationKind
  url: string
  /** Explicit path prefix. When omitted, the URL's own path is used. */
  basePath?: string
  hostVerified?: boolean
  migration?: MigrationStamp
  now?: number
}

export async function createApplication(input: CreateApplicationInput): Promise<ConnectedApplicationDoc> {
  await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "apps.manage",
  })

  if (!isApplicationKind(input.kind)) {
    throw new AppError("VALIDATION", "That application type isn't recognised.")
  }
  const name = input.name.trim()
  if (!name) throw new AppError("VALIDATION", "Give the application a name.")

  const { hostname, basePath, primaryUrl } = splitAddress(input.url, input.basePath)
  const col = await connectedApplicationsCol()

  const existing = await col.findOne({
    businessId: input.businessId,
    hostname,
    basePath,
    archivedAt: { $exists: false },
  })
  if (existing) throw duplicateOrigin()

  const now = input.now ?? Date.now()
  const application: ConnectedApplicationDoc = {
    id: `app_${cryptoId()}`,
    businessId: input.businessId,
    name,
    kind: input.kind,
    primaryUrl,
    hostname,
    basePath,
    trustDomain: hostname,
    hostVerified: input.hostVerified === true,
    connection: {},
    createdAt: now,
    updatedAt: now,
  }
  if (input.migration) application.migration = input.migration

  try {
    await col.insertOne(application)
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateOrigin()
    throw error
  }
  return application
}

/**
 * Archive one application. It touches this row and nothing else: the business,
 * its sibling applications, its claims, its events and its charges all survive.
 */
export async function archiveApplication(input: {
  businessId: string
  applicationId: string
  actor: Actor
  now?: number
}): Promise<ConnectedApplicationDoc> {
  await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "apps.manage",
    applicationId: input.applicationId,
  })

  const col = await connectedApplicationsCol()
  const now = input.now ?? Date.now()
  const result = await col.updateOne(
    { id: input.applicationId, businessId: input.businessId, archivedAt: { $exists: false } },
    { $set: { archivedAt: now, updatedAt: now } },
  )
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND")
  const updated = await col.findOne({ id: input.applicationId, businessId: input.businessId })
  if (!updated) throw new AppError("NOT_FOUND")
  return updated
}

export async function getApplication(input: {
  businessId: string
  applicationId: string
  actor: Actor
}): Promise<ConnectedApplicationDoc | null> {
  await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "apps.read",
    applicationId: input.applicationId,
  })
  return (await connectedApplicationsCol()).findOne({
    id: input.applicationId,
    businessId: input.businessId,
    archivedAt: { $exists: false },
  })
}

export async function listApplications(input: {
  businessId: string
  actor: Actor
  includeArchived?: boolean
}): Promise<ConnectedApplicationDoc[]> {
  const access = await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "apps.read",
  })

  const filter: Record<string, unknown> = { businessId: input.businessId }
  if (!input.includeArchived) filter.archivedAt = { $exists: false }
  const rows = await (await connectedApplicationsCol()).find(filter).toArray()

  const scope = access.member?.scope
  const scoped = scope && scope.kind === "applications" ? new Set(scope.applicationIds) : null
  return rows
    .filter((row) => !scoped || scoped.has(row.id))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Display/log form: "example.com/shop". Never a uniqueness key. */
export function applicationAddress(application: Pick<ConnectedApplicationDoc, "hostname" | "basePath">): string {
  return applicationOrigin(application)
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

/**
 * Returns the stored address alongside the identity, derived from the same
 * parse. `primaryUrl` is rebuilt from the normalised parts rather than keeping
 * the typed string, so it can never carry credentials or a scheme the rest of
 * the model does not support. Ports are not part of application identity.
 */
function splitAddress(
  url: string,
  explicitBasePath?: string,
): { hostname: string; basePath: string; primaryUrl: string } {
  const value = (url ?? "").trim()
  if (!value) throw new AppError("VALIDATION", "Enter the application's address.")

  const candidate = value.includes("://") ? value : `https://${value}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new AppError("VALIDATION", "That doesn't look like a website address.")
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new AppError("VALIDATION", "Use an http:// or https:// address.")
  }
  if (parsed.username || parsed.password) {
    throw new AppError("VALIDATION", "Remove the username and password from the address.")
  }

  let hostname: string
  try {
    hostname = normalizeHostname(parsed.hostname)
  } catch {
    throw new AppError("VALIDATION", "That doesn't look like a website address.")
  }

  let basePath: string
  try {
    basePath = canonicalBasePath(explicitBasePath === undefined ? parsed.pathname : explicitBasePath)
  } catch (error) {
    throw new AppError(
      "VALIDATION",
      error instanceof PathInputError ? error.message : "That path can't be used.",
    )
  }
  return { hostname, basePath, primaryUrl: `${parsed.protocol}//${hostname}${basePath}` }
}

function duplicateOrigin(): AppError {
  return new AppError("APPLICATION_ALREADY_EXISTS")
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000
}
