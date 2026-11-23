import "server-only"

import {
  businessDomainsCol,
  businessMembersCol,
  businessesCol,
  connectedApplicationsCol,
  projectsCol,
} from "@/lib/db/collections"
import { ensureIndexes } from "@/lib/db/collections"
import { getMongoClient } from "@/lib/db/mongodb"
import { applicationIdentityFrom } from "./migrate"

/**
 * Read-only readiness check for the legacy → connected-business migration (A′.9).
 *
 * It answers one question: is it safe to run `apply` against this database right
 * now? It writes nothing, so it is safe to run against production, and it is
 * meant to be run immediately before every apply — the answer can change when
 * data changes.
 *
 * The distinction that matters is between a finding the operator must resolve
 * (`blocking`) and one they must simply know about (`warnings`). A missing
 * unique index is blocking: without it the migration can write duplicates that
 * no later step can tell apart. A project with no owner is a warning: the
 * migration skips it, but somebody has to decide what to do with it.
 *
 * @module lib/connected-business/preflight
 */

export const REQUIRED_INDEXES = [
  { collection: "businesses", name: "businesses_legacy_project_unique" },
  { collection: "connected_applications", name: "connected_applications_origin_unique" },
  { collection: "connected_applications", name: "connected_applications_legacy_unique" },
  { collection: "business_members", name: "business_members_one_owner" },
] as const

export interface PreflightReport {
  verdict: "go" | "no-go"
  blocking: string[]
  warnings: string[]
  transactions: boolean
  missingIndexes: string[]
  totals: {
    projects: number
    eligible: number
    alreadyMigrated: number
    withoutOwner: number
    withoutSiteAddress: number
    domainClaims: number
    domainClaimsAlreadyOwned: number
    orphanApplications: number
    ownerlessBusinesses: number
    danglingDomainClaims: number
  }
}

export async function preflightConnectedBusinessMigration(): Promise<PreflightReport> {
  const blocking: string[] = []
  const warnings: string[] = []

  const [projects, allBusinesses, applications, members, domains] = await Promise.all([
    (await projectsCol()).find({}).toArray(),
    (await businessesCol()).find({}).toArray(),
    (await connectedApplicationsCol()).find({ legacyProjectId: { $exists: true } }).toArray(),
    (await businessMembersCol()).find({ role: "owner", status: "active" }).toArray(),
    (await businessDomainsCol()).find({}).toArray(),
  ])

  // Transactions are not optional: every project is written as one unit, and a
  // half-written business is worse than an unmigrated project.
  const client = await getMongoClient()
  const hello = (await client.db().admin().command({ hello: 1 })) as { setName?: string }
  const transactions = Boolean(hello.setName)
  if (!transactions) {
    blocking.push("This deployment is not a replica set. Apply uses transactions and will fail.")
  }

  // Index creation is lazy, so a fresh database would report every index
  // missing purely because nobody has touched it yet. Asking for them first
  // turns the check into the question that matters: can they be created? If
  // duplicate rows block a unique index, they stay missing and the run is
  // blocked, which is exactly the finding worth having.
  await ensureIndexes()

  const missingIndexes: string[] = []
  for (const required of REQUIRED_INDEXES) {
    const collection = await client.db().collection(required.collection)
    const names = (await collection.listIndexes().toArray()).map((index) => index.name)
    if (!names.includes(required.name)) missingIndexes.push(`${required.collection}.${required.name}`)
  }
  if (missingIndexes.length > 0) {
    blocking.push(`Missing unique index: ${missingIndexes.join(", ")}. Duplicates could be written.`)
  }

  const businesses = allBusinesses.filter((business) => business.legacyProjectId)
  const businessIds = new Set(allBusinesses.map((business) => business.id))
  const projectIds = new Set(projects.map((project) => project.id))
  const migratedProjectIds = new Set(businesses.map((business) => business.legacyProjectId).filter(Boolean))

  const withoutOwner = projects.filter((project) => !project.userId)
  const withoutSiteAddress = projects.filter((project) => !applicationIdentityFrom(project.sourceUrl))
  const eligible = projects.filter((project) => project.userId && !migratedProjectIds.has(project.id))

  if (withoutOwner.length > 0) {
    warnings.push(
      `${withoutOwner.length} project(s) have no owner and will be skipped: ${withoutOwner
        .slice(0, 5)
        .map((project) => project.id)
        .join(", ")}${withoutOwner.length > 5 ? " …" : ""}`,
    )
  }
  if (withoutSiteAddress.length > 0) {
    warnings.push(
      `${withoutSiteAddress.length} project(s) have no usable site address; they migrate as a business with no application.`,
    )
  }

  const orphanApplications = applications.filter(
    (application) => application.legacyProjectId && !projectIds.has(application.legacyProjectId),
  )
  if (orphanApplications.length > 0) {
    warnings.push(
      `${orphanApplications.length} connected application(s) point at a project that no longer exists. Inspect before migrating.`,
    )
  }

  const ownedBusinessIds = new Set(members.map((member) => member.businessId))
  const ownerlessBusinesses = businesses.filter((business) => !ownedBusinessIds.has(business.id))
  if (ownerlessBusinesses.length > 0) {
    warnings.push(
      `${ownerlessBusinesses.length} migrated business(es) have no active owner member: ${ownerlessBusinesses
        .slice(0, 5)
        .map((business) => business.id)
        .join(", ")}${ownerlessBusinesses.length > 5 ? " …" : ""}`,
    )
  }

  const domainClaimsAlreadyOwned = domains.filter((domain) => domain.businessId !== undefined).length
  if (domainClaimsAlreadyOwned > 0) {
    warnings.push(
      `${domainClaimsAlreadyOwned} domain claim(s) already have an owner and will be left untouched (F-02).`,
    )
  }

  // A claim pointing at a business that no longer exists is pre-existing damage.
  // The migration neither creates nor repairs it, but verify will report it, and
  // an operator should not discover that only after applying.
  const danglingClaims = domains.filter(
    (domain) => domain.businessId !== undefined && !businessIds.has(domain.businessId),
  )
  if (danglingClaims.length > 0) {
    warnings.push(
      `${danglingClaims.length} domain claim(s) point at a business that does not exist: ${danglingClaims
        .slice(0, 5)
        .map((domain) => `${domain.hostname} → ${domain.businessId}`)
        .join(", ")}${danglingClaims.length > 5 ? " …" : ""}`,
    )
  }

  return {
    verdict: blocking.length > 0 ? "no-go" : "go",
    blocking,
    warnings,
    transactions,
    missingIndexes,
    totals: {
      projects: projects.length,
      eligible: eligible.length,
      alreadyMigrated: migratedProjectIds.size,
      withoutOwner: withoutOwner.length,
      withoutSiteAddress: withoutSiteAddress.length,
      domainClaims: domains.length,
      domainClaimsAlreadyOwned,
      orphanApplications: orphanApplications.length,
      ownerlessBusinesses: ownerlessBusinesses.length,
      danglingDomainClaims: danglingClaims.length,
    },
  }
}

