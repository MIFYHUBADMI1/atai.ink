import "server-only"

import { businessDomainsCol, businessMembersCol, businessesCol, connectedApplicationsCol } from "@/lib/db/collections"

/**
 * Undo one migration run (A′.2, hardened in A′.6).
 *
 * A rollback is a recovery operation, not a delete button. Before it touches
 * anything it inspects every business the run created and asks one question:
 * has a human used this yet? A renamed business, a member added later, an
 * application connected later, an archived application — each of those means
 * the row is no longer migration-owned, and deleting it would destroy real
 * work. When any such signal is present the run is **blocked** and `apply`
 * writes nothing.
 *
 * `allowInUse` is the separately authorised escape hatch. It exists for the
 * operator who has read the impact report and accepts it. Even then only
 * stamped rows are deleted; records a founder created are left in place and
 * reported as orphans.
 *
 * Domain claims are detached only when they carry this run's stamp, so a claim
 * the founder connected afterwards survives.
 *
 * @module lib/connected-business/rollback
 */

export interface RollbackOptions {
  runId: string
  mode: "dry-run" | "apply"
  /** Explicit recovery: proceed even though founders have used these rows. */
  allowInUse?: boolean
}

export interface RollbackImpact {
  businessId: string
  name: string
  /** The business row changed after the run created it. */
  modified: boolean
  /** Members a human added after the run. */
  foreignMemberships: number
  /** Applications a human added after the run. */
  foreignApplications: number
  /** Stamped children a human then changed (removed member, archived app). */
  changedChildren: number
}

export interface RollbackReport {
  runId: string
  mode: "dry-run" | "apply"
  /** True only when the deletes actually ran. */
  applied: boolean
  /** True when founder activity was found and `allowInUse` was not set. */
  blocked: boolean
  businesses: number
  applications: number
  memberships: number
  domains: number
  /** Records that will be left behind pointing at a deleted business. */
  orphanedMemberships: number
  orphanedApplications: number
  impact: RollbackImpact[]
}

export async function rollbackMigration(options: RollbackOptions): Promise<RollbackReport> {
  const stamped = { "migration.runId": options.runId }

  const businesses = await (await businessesCol()).find(stamped).toArray()
  const businessIds = businesses.map((business) => business.id)

  const applications = businessIds.length
    ? await (await connectedApplicationsCol()).find({ businessId: { $in: businessIds } }).toArray()
    : []
  const memberships = businessIds.length
    ? await (await businessMembersCol()).find({ businessId: { $in: businessIds } }).toArray()
    : []
  // Only claims this run linked. A domain the founder connected later carries
  // no stamp and is never in scope.
  const domains = await (await businessDomainsCol())
    .find({ "migration.runId": options.runId, businessId: { $in: businessIds } })
    .toArray()

  const impact: RollbackImpact[] = businesses.map((business) => {
    const created = business.migration?.createdAt ?? business.createdAt
    const mine = memberships.filter((member) => member.businessId === business.id)
    const myApps = applications.filter((application) => application.businessId === business.id)

    const foreignMemberships = mine.filter((member) => member.migration?.runId !== options.runId)
    const foreignApplications = myApps.filter((application) => application.migration?.runId !== options.runId)
    const changedChildren =
      mine.filter(
        (member) => member.migration?.runId === options.runId && (member.status !== "active" || member.updatedAt > created),
      ).length +
      myApps.filter(
        (application) =>
          application.migration?.runId === options.runId &&
          (application.archivedAt != null || application.updatedAt > created),
      ).length

    return {
      businessId: business.id,
      name: business.name,
      modified: business.updatedAt > created,
      foreignMemberships: foreignMemberships.length,
      foreignApplications: foreignApplications.length,
      changedChildren,
    }
  })

  const blocked = impact.some(
    (entry) =>
      entry.modified || entry.foreignMemberships > 0 || entry.foreignApplications > 0 || entry.changedChildren > 0,
  )
  const applied = options.mode === "apply" && (!blocked || options.allowInUse === true)

  const stampedApplications = applications.filter((application) => application.migration?.runId === options.runId)
  const stampedMemberships = memberships.filter((member) => member.migration?.runId === options.runId)

  if (applied) {
    if (domains.length) {
      await (await businessDomainsCol()).updateMany(
        { "migration.runId": options.runId, businessId: { $in: businessIds } },
        { $unset: { businessId: "", applicationId: "", migration: "" } },
      )
    }
    await (await connectedApplicationsCol()).deleteMany(stamped)
    await (await businessMembersCol()).deleteMany(stamped)
    await (await businessesCol()).deleteMany(stamped)
  }

  return {
    runId: options.runId,
    mode: options.mode,
    applied,
    blocked,
    businesses: businesses.length,
    applications: stampedApplications.length,
    memberships: stampedMemberships.length,
    domains: domains.length,
    orphanedMemberships: memberships.length - stampedMemberships.length,
    orphanedApplications: applications.length - stampedApplications.length,
    impact,
  }
}
