import "server-only"

import { AppError } from "@/lib/errors"
import { businessMembersCol, businessesCol, connectedApplicationsCol } from "@/lib/db/collections"
import type { BusinessDoc, BusinessMemberDoc, BusinessRole } from "@/lib/types/business"
import {
  type Actor,
  type Permission,
  SYSTEM_PERMISSIONS,
  isWritePermission,
  permissionsForRole,
} from "./permissions"

/**
 * The only authorisation entry point for a connected business.
 *
 * Routes call it and service functions call it. A route gate does not excuse a
 * missing service gate: a service can be invoked by the AI orchestrator without
 * a route ever running.
 *
 * Order is deliberate — a non-member must not learn whether the business exists,
 * so the membership check returns 404, not 403.
 *
 * @module lib/business/access
 */

export interface BusinessAccess {
  business: BusinessDoc
  /** null for a system actor: a system caller is not a member. */
  member: BusinessMemberDoc | null
  role: BusinessRole | null
  permissions: ReadonlySet<Permission>
}

export interface RequireBusinessAccessInput {
  businessId: string
  actor: Actor
  permission: Permission
  /** When present, the member's application scope is checked too. */
  applicationId?: string
}

export async function requireBusinessAccess(input: RequireBusinessAccessInput): Promise<BusinessAccess> {
  const business = await (await businessesCol()).findOne({ id: input.businessId })
  if (!business) throw new AppError("BUSINESS_NOT_FOUND")

  if (input.actor.kind === "system") {
    if (!SYSTEM_PERMISSIONS.has(input.permission)) throw new AppError("BUSINESS_FORBIDDEN")
    if (input.applicationId) await assertApplicationInBusiness(business.id, input.applicationId)
    return { business, member: null, role: null, permissions: SYSTEM_PERMISSIONS }
  }

  const member = await (await businessMembersCol()).findOne({
    businessId: business.id,
    userId: input.actor.id,
    status: "active",
  })
  if (!member) throw new AppError("NOT_FOUND")

  const permissions = permissionsForRole(member.role)
  const isWrite = isWritePermission(input.permission)

  if (business.status === "archived" && isWrite) {
    throw new AppError("BUSINESS_FORBIDDEN", "This business is archived. Restore it before making changes.")
  }

  if (business.status === "suspended") {
    const mayRead = member.role === "owner" || member.role === "admin"
    if (isWrite || !mayRead) throw new AppError("BUSINESS_SUSPENDED")
  }

  if (!permissions.has(input.permission)) throw new AppError("BUSINESS_FORBIDDEN")

  if (input.applicationId) {
    const application = await assertApplicationInBusiness(business.id, input.applicationId)
    if (member.scope.kind === "applications" && !member.scope.applicationIds.includes(application.id)) {
      throw new AppError("BUSINESS_FORBIDDEN", "Your access is limited to specific applications.")
    }
  }

  return { business, member, role: member.role, permissions }
}

async function assertApplicationInBusiness(businessId: string, applicationId: string) {
  const application = await (await connectedApplicationsCol()).findOne({
    id: applicationId,
    businessId,
    archivedAt: { $exists: false },
  })
  // Another business's application and an archived one are both "not found":
  // the caller has no business knowing which.
  if (!application) throw new AppError("NOT_FOUND")
  return application
}
