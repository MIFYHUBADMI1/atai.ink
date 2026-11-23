import "server-only"

import { businessDomainsCol, businessMembersCol, businessesCol, connectedApplicationsCol } from "@/lib/db/collections"

/**
 * Undo one migration run (A′.2).
 *
 * Only rows stamped with the given run id are touched, so a rollback can never
 * reach a business a founder created through the product. Domain claims are
 * detached rather than deleted: the claim predates the business model and
 * belongs to the project system.
 *
 * @module lib/connected-business/rollback
 */

export interface RollbackOptions {
  runId: string
  mode: "dry-run" | "apply"
}

export interface RollbackReport {
  runId: string
  mode: "dry-run" | "apply"
  businesses: number
  applications: number
  memberships: number
  domains: number
}

export async function rollbackMigration(options: RollbackOptions): Promise<RollbackReport> {
  const stamped = { "migration.runId": options.runId }

  const businesses = await (await businessesCol()).find(stamped).toArray()
  const applications = await (await connectedApplicationsCol()).find(stamped).toArray()
  const memberships = await (await businessMembersCol()).find(stamped).toArray()

  const businessIds = businesses.map((business) => business.id)
  const domains = businessIds.length
    ? await (await businessDomainsCol()).find({ businessId: { $in: businessIds } }).toArray()
    : []

  if (options.mode === "apply") {
    if (businessIds.length) {
      await (await businessDomainsCol()).updateMany(
        { businessId: { $in: businessIds } },
        { $unset: { businessId: "", applicationId: "" } },
      )
    }
    await (await connectedApplicationsCol()).deleteMany(stamped)
    await (await businessMembersCol()).deleteMany(stamped)
    await (await businessesCol()).deleteMany(stamped)
  }

  return {
    runId: options.runId,
    mode: options.mode,
    businesses: businesses.length,
    applications: applications.length,
    memberships: memberships.length,
    domains: domains.length,
  }
}
