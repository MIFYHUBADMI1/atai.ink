import "server-only"

import { businessDomainsCol, businessMembersCol, businessesCol, connectedApplicationsCol } from "@/lib/db/collections"

/**
 * Read-only integrity check for the connected-business model (A′.2).
 *
 * It reports; it never repairs. Anything it finds is a decision for a human,
 * because an automatic repair could delete a real customer's membership.
 *
 * @module lib/connected-business/verify
 */

export interface VerificationReport {
  businesses: number
  applications: number
  memberships: number
  domains: number
  /** States the data model forbids. A non-zero count must fail a deploy gate. */
  problems: string[]
  /** States the model permits but a human should look at. Never gates. */
  warnings: string[]
}

export async function verifyConnectedBusinesses(): Promise<VerificationReport> {
  const businesses = await (await businessesCol()).find({}).toArray()
  const memberships = await (await businessMembersCol()).find({}).toArray()
  const applications = await (await connectedApplicationsCol()).find({}).toArray()
  const domains = await (await businessDomainsCol()).find({}).toArray()

  const problems: string[] = []
  const businessIds = new Set(businesses.map((business) => business.id))
  const activeOwners = new Map<string, number>()

  for (const membership of memberships) {
    if (membership.role === "owner" && membership.status === "active") {
      activeOwners.set(membership.businessId, (activeOwners.get(membership.businessId) ?? 0) + 1)
    }
    if (!businessIds.has(membership.businessId)) {
      problems.push(`membership ${membership.id} points at missing business ${membership.businessId}`)
    }
  }

  for (const business of businesses) {
    const owners = activeOwners.get(business.id) ?? 0
    if (owners !== 1) problems.push(`business ${business.id} has ${owners} active owners`)
    const ownerRow = memberships.some(
      (membership) =>
        membership.businessId === business.id &&
        membership.userId === business.ownerId &&
        membership.role === "owner" &&
        membership.status === "active",
    )
    if (!ownerRow) problems.push(`business ${business.id} owner ${business.ownerId} has no active owner row`)
  }

  // Duplicate detection must mirror the unique index exactly: it covers
  // (businessId, hostname, basePath) among non-archived rows only. An archived
  // application and its replacement legitimately share an origin, and two
  // different businesses may each claim the same one — that is a warning, not
  // a broken invariant.
  const warnings: string[] = []
  const origins = new Map<string, string>()
  const businessesByOrigin = new Map<string, Set<string>>()
  for (const application of applications) {
    if (!businessIds.has(application.businessId)) {
      problems.push(`application ${application.id} points at missing business ${application.businessId}`)
    }
    if (application.archivedAt !== undefined) continue

    const origin = `${application.hostname}${application.basePath}`
    const key = `${application.businessId}\u0000${origin}`
    const previous = origins.get(key)
    if (previous) problems.push(`origin ${origin} is claimed twice within ${application.businessId}: ${previous} and ${application.id}`)
    else origins.set(key, application.id)

    const claimants = businessesByOrigin.get(origin) ?? new Set<string>()
    claimants.add(application.businessId)
    businessesByOrigin.set(origin, claimants)
  }
  for (const [origin, claimants] of businessesByOrigin) {
    if (claimants.size > 1) warnings.push(`origin ${origin} is claimed by ${claimants.size} businesses`)
  }

  for (const domain of domains) {
    const businessId = (domain as { businessId?: string }).businessId
    if (businessId && !businessIds.has(businessId)) {
      problems.push(`domain ${domain.hostname} points at missing business ${businessId}`)
    }
  }

  return {
    businesses: businesses.length,
    applications: applications.length,
    memberships: memberships.length,
    domains: domains.length,
    problems,
    warnings,
  }
}
