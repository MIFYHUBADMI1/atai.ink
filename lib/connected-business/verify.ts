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
  problems: string[]
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

  const origins = new Map<string, string>()
  for (const application of applications) {
    if (!businessIds.has(application.businessId)) {
      problems.push(`application ${application.id} points at missing business ${application.businessId}`)
    }
    const origin = `${application.hostname}${application.basePath}`
    const previous = origins.get(origin)
    if (previous) problems.push(`origin ${origin} is claimed by ${previous} and ${application.id}`)
    else origins.set(origin, application.id)
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
  }
}
