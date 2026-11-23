import { checkEntitlement } from "./catalog"
import { resolveEntitlements } from "./service"
import type { EntitlementCheck, EntitlementSet, ProjectAccessView } from "./types"
import { getProjectStorageUsage } from "@/lib/infrastructure/service"
import type { MirrorProject } from "@/lib/types/project"

function allow(): EntitlementCheck {
  return { allowed: true }
}
function deny(code: string, reason: string): EntitlementCheck {
  return { allowed: false, code, reason }
}

function hasExistingCustomDomain(project: MirrorProject): boolean {
  if (project.deployment?.customDomain) return true
  return (project.deploymentHistory ?? []).some((entry) => Boolean(entry.customDomain))
}

function hasExistingSubdomain(project: MirrorProject): boolean {
  return (
    project.deployment?.status === "success" ||
    Boolean(project.deployment?.productionUrl) ||
    project.state === "deployed"
  )
}

/**
 * Build the presentation view for one project. It is derived from the same
 * entitlement set the mutating routes enforce; the frontend may use it to
 * explain availability, never as the authority for an action.
 */
export async function buildProjectAccessView(
  userId: string,
  project: MirrorProject,
): Promise<ProjectAccessView> {
  const set: EntitlementSet = await resolveEntitlements(userId)
  const existingDomain = hasExistingCustomDomain(project)
  const existingSubdomain = hasExistingSubdomain(project)
  const storageUsage = await getProjectStorageUsage(project.id)

  const customDomainCheck = existingDomain ? allow() : checkEntitlement(set, "registerCustomDomain")
  const subdomainCheck = existingSubdomain ? allow() : checkEntitlement(set, "connectSubdomain")
  const storageCheck = checkEntitlement(set, "useStorage")
  const storageAllowed =
    storageCheck.allowed &&
    (storageUsage.limitBytes === null || storageUsage.usedBytes < storageUsage.limitBytes)
  const storageAccess = storageAllowed
    ? allow()
    : storageCheck.allowed
      ? deny(
          "STORAGE_LIMIT_REACHED",
          "This project has reached its infrastructure storage limit. Upgrade the infrastructure plan to add more.",
        )
      : storageCheck

  return {
    customDomain: {
      ...customDomainCheck,
      limit: set.customDomainsIncluded.max,
      consumed: set.customDomainsIncluded.consumed,
    },
    subdomain: {
      ...subdomainCheck,
      limit: set.subdomains.max,
      current: set.subdomains.current,
    },
    storage: {
      ...storageAccess,
      limitBytes: storageUsage.limitBytes,
      usedBytes: storageUsage.usedBytes,
    },
    database: checkEntitlement(set, "provisionDatabase"),
    specialistTeam: checkEntitlement(set, "useSpecialistTeam"),
    competition: checkEntitlement(set, "useCompetitionIntel"),
    agent: checkEntitlement(set, "useAgent", { agent: "start" }),
  }
}
