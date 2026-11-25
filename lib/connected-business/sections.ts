import "server-only"

import { listApplications } from "@/lib/business/applications"
import { listMembers } from "@/lib/business/members"
import type { Actor } from "@/lib/business/permissions"
import { withoutMongoId } from "./client-docs"

/**
 * The collections the Applications and Settings sections both need.
 *
 * These rows are passed straight to the client `BusinessWorkspace`, so the
 * Mongo `_id` (an ObjectId, not serialisable across the RSC boundary) is
 * stripped here — the one place both pages get their data.
 */
export async function businessSections(input: { businessId: string; actor: Actor }) {
  const [applications, all, members] = await Promise.all([
    listApplications({ businessId: input.businessId, actor: input.actor }),
    listApplications({ businessId: input.businessId, actor: input.actor, includeArchived: true }),
    listMembers({ businessId: input.businessId, actor: input.actor }),
  ])

  return {
    applications: applications.map(withoutMongoId),
    archivedApplications: all.filter((application) => application.archivedAt !== null).map(withoutMongoId),
    members: members.map(withoutMongoId),
  }
}
