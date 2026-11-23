import "server-only"

import { businessDomainsCol, businessMembersCol, businessesCol, connectedApplicationsCol, projectsCol } from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { normalizeHostname } from "@/lib/domain/host"
import { cryptoId } from "@/lib/store/id"
import { canonicalBasePath } from "@/lib/business/paths"
import {
  BUSINESS_SCHEMA_VERSION,
  type BusinessDoc,
  type BusinessMemberDoc,
  type ConnectedApplicationDoc,
  type MigrationStamp,
} from "@/lib/types/business"
import type { MirrorProject } from "@/lib/types/project"

/**
 * Legacy project → connected business migration (A′.2).
 *
 * A migrated business is owned by the project's user, carries the project id as
 * `legacyProjectId` for idempotency, and stamps every row it writes with the
 * run id so a rollback can delete exactly what this run created.
 *
 * The migration writes through the collections rather than through the services:
 * business creation is deliberately authenticated (the owner is the acting
 * user), and a migration has no user acting. That is why every row carries a
 * stamp.
 *
 * @module lib/connected-business/migrate
 */

export interface MigrationOptions {
  mode: "dry-run" | "apply"
  runId: string
  /** Limit the run. Omitted means every project that has not been migrated. */
  projectIds?: string[]
  userIds?: string[]
  limit?: number
  now?: number
}

export type MigrationStatus = "planned" | "created" | "skipped" | "failed"

export interface MigrationItem {
  projectId: string
  userId: string
  status: MigrationStatus
  businessId?: string
  applicationId?: string
  warning?: string
  error?: string
}

export interface MigrationReport {
  runId: string
  mode: "dry-run" | "apply"
  total: number
  planned: number
  created: number
  skipped: number
  failed: number
  items: MigrationItem[]
}

export function newMigrationStamp(runId: string, now = Date.now()): MigrationStamp {
  return { id: `mig_${cryptoId()}`, runId, createdAt: now }
}

/** Application identity from a project's site address, or null when unusable. */
export function applicationIdentityFrom(
  sourceUrl: string | undefined,
): { hostname: string; basePath: string; primaryUrl: string } | null {
  if (!sourceUrl) return null
  try {
    const parsed = new URL(sourceUrl.includes("://") ? sourceUrl : `https://${sourceUrl}`)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    if (parsed.username || parsed.password) return null
    const hostname = normalizeHostname(parsed.hostname)
    const basePath = canonicalBasePath(parsed.pathname)
    return { hostname, basePath, primaryUrl: `${parsed.protocol}//${hostname}${basePath}` }
  } catch {
    return null
  }
}

export function businessDocFor(project: MirrorProject, stamp: MigrationStamp, now: number): BusinessDoc {
  const name = project.name?.trim() || "Untitled business"
  return {
    id: `biz_${cryptoId()}`,
    legacyProjectId: project.id,
    ownerId: project.userId,
    name,
    status: "active",
    schemaVersion: BUSINESS_SCHEMA_VERSION,
    suggestedName: name,
    suggestedNameSource: "project_name",
    migration: stamp,
    createdAt: project.createdAt ?? now,
    updatedAt: now,
  }
}

export function ownerMemberFor(
  project: MirrorProject,
  businessId: string,
  stamp: MigrationStamp,
  now: number,
): BusinessMemberDoc {
  return {
    id: `mem_${cryptoId()}`,
    businessId,
    userId: project.userId,
    role: "owner",
    status: "active",
    scope: { kind: "all" },
    migration: stamp,
    createdAt: project.createdAt ?? now,
    updatedAt: now,
  }
}

export function applicationDocFor(
  project: MirrorProject,
  businessId: string,
  identity: { hostname: string; basePath: string; primaryUrl: string },
  stamp: MigrationStamp,
  now: number,
): ConnectedApplicationDoc {
  return {
    id: `app_${cryptoId()}`,
    businessId,
    legacyProjectId: project.id,
    name: project.name?.trim() || identity.hostname,
    kind: "other",
    primaryUrl: identity.primaryUrl,
    hostname: identity.hostname,
    basePath: identity.basePath,
    trustDomain: identity.hostname,
    hostVerified: false,
    connection: {},
    migration: stamp,
    createdAt: project.createdAt ?? now,
    updatedAt: now,
  }
}

export async function migrateConnectedBusinesses(options: MigrationOptions): Promise<MigrationReport> {
  const now = options.now ?? Date.now()
  const projects = await loadProjects(options)
  const items: MigrationItem[] = []

  for (const project of projects) {
    const base = { projectId: project.id, userId: project.userId }
    try {
      const existing = await (await businessesCol()).findOne({ legacyProjectId: project.id })
      if (existing) {
        items.push({ ...base, status: "skipped", businessId: existing.id, warning: "already migrated" })
        continue
      }

      const stamp = newMigrationStamp(options.runId, now)
      const business = businessDocFor(project, stamp, now)
      const owner = ownerMemberFor(project, business.id, stamp, now)
      const identity = applicationIdentityFrom(project.sourceUrl)
      const application = identity ? applicationDocFor(project, business.id, identity, stamp, now) : undefined

      // A claim that already has an owner belongs to somebody else's decision.
      // Re-pointing it would move a domain without anyone being asked.
      const ownedClaims = await (await businessDomainsCol()).countDocuments({
        projectId: project.id,
        businessId: { $exists: true },
      })
      const warnings: string[] = []
      if (!identity) warnings.push("no usable site address; business only")
      if (ownedClaims > 0) warnings.push(`${ownedClaims} domain claim(s) already owned; left untouched`)

      if (options.mode === "dry-run") {
        items.push({
          ...base,
          status: "planned",
          businessId: business.id,
          applicationId: application?.id,
          warning: warnings.length ? warnings.join("; ") : undefined,
        })
        continue
      }

      const client = await getMongoClient()
      const session = client.startSession()
      try {
        await session.withTransaction(async () => {
          await (await businessesCol()).insertOne(business, { session })
          await (await businessMembersCol()).insertOne(owner, { session })
          if (application) {
            await (await connectedApplicationsCol()).insertOne(application, { session })
          }
          // The stamp is what makes rollback precise: a claim the founder
          // connects after this run carries no stamp and is never detached.
          const set: Record<string, unknown> = { businessId: business.id, migration: stamp }
          if (application) set.applicationId = application.id
          await (await businessDomainsCol()).updateMany(
            { projectId: project.id, businessId: { $exists: false } },
            { $set: set },
            { session },
          )
        })
      } finally {
        await session.endSession()
      }

      items.push({
        ...base,
        status: "created",
        businessId: business.id,
        applicationId: application?.id,
        warning: warnings.length ? warnings.join("; ") : undefined,
      })
    } catch (error) {
      items.push({ ...base, status: "failed", error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    runId: options.runId,
    mode: options.mode,
    total: items.length,
    planned: items.filter((item) => item.status === "planned").length,
    created: items.filter((item) => item.status === "created").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  }
}

async function loadProjects(options: MigrationOptions): Promise<MirrorProject[]> {
  const filter: Record<string, unknown> = {}
  if (options.projectIds?.length) filter.id = { $in: options.projectIds }
  else if (options.userIds?.length) filter.userId = { $in: options.userIds }
  const rows = await (await projectsCol()).find(filter).toArray()
  const sorted = rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  return options.limit ? sorted.slice(0, options.limit) : sorted
}
