import "server-only"

import { listApplications } from "@/lib/business/applications"
import { listMembers } from "@/lib/business/members"
import type { Actor } from "@/lib/business/permissions"

/** The collections the Applications and Settings sections both need. */
export async function businessSections(input: { businessId: string; actor: Actor }) {
  const [applications, all, members] = await Promise.all([
    listApplications({ businessId: input.businessId, actor: input.actor }),
    listApplications({ businessId: input.businessId, actor: input.actor, includeArchived: true }),
    listMembers({ businessId: input.businessId, actor: input.actor }),
  ])

  return {
    applications,
    archivedApplications: all.filter((application) => application.archivedAt !== null),
    members,
  }
}
