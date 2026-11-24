import "server-only"

import { AppError } from "@/lib/errors"
import {
  businessDomainsCol,
  businessesCol,
  cofounderConversationsCol,
  cofounderPendingActionsCol,
  connectedApplicationsCol,
  projectsCol,
} from "@/lib/db/collections"
import { requireBusinessAccess } from "@/lib/business/access"
import { deleteBusiness } from "@/lib/business/service"
import type { Actor } from "@/lib/business/permissions"
import { logger } from "@/lib/logging/logger"
import { store } from "@/lib/store/store"

/**
 * Permanently delete a connected business and everything that makes it exist.
 *
 * `lib/business/service` owns the business rows and the claims stamped with the
 * business id. This module owns the other half — the hidden anchor project —
 * because it is the only place allowed to know the link. Deleting the project
 * cascades its build runs, chats, assets, analytics events, runtime config and
 * API keys, and releases the claims stamped with the project id.
 *
 * Order matters: the project is removed first so its claims are released and
 * the hostname is free even if the second step has to be retried. Every step is
 * idempotent, so a failed request can simply be sent again.
 */
export interface DeleteConnectedBusinessResult {
  businessId: string
  deletedProjectIds: string[]
  releasedClaims: number
}

export async function deleteConnectedBusiness(input: {
  businessId: string
  actor: Actor
}): Promise<DeleteConnectedBusinessResult> {
  const access = await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "business.manage",
    allowArchived: true,
  })
  if (access.role !== "owner") {
    throw new AppError("BUSINESS_FORBIDDEN", "Only the business owner can delete it.")
  }

  const deletedProjectIds: string[] = []
  for (const projectId of await linkedProjectIds(input.businessId)) {
    if (await deleteAnchorProject(projectId)) deletedProjectIds.push(projectId)
  }

  // Detach the operate co-founder's references: the transcript itself is kept,
  // but it can no longer point at a business that does not exist.
  await (await cofounderConversationsCol()).updateMany(
    { activeBusinessId: input.businessId },
    { $unset: { activeBusinessId: "" } },
  )
  await (await cofounderPendingActionsCol()).updateMany(
    { "parameters.businessId": input.businessId, status: { $in: ["pending", "approved"] } },
    { $set: { status: "expired", expiresAt: Date.now() } },
  )

  const { releasedClaims } = await deleteBusiness({ businessId: input.businessId, actor: input.actor })

  logger.info("connected-business.delete", "business deleted", {
    businessId: input.businessId,
    deletedProjectIds,
    releasedClaims,
  })

  return { businessId: input.businessId, deletedProjectIds, releasedClaims }
}

/** Every project the business could own: forward pointer, legacy pointer, application pointer. */
async function linkedProjectIds(businessId: string): Promise<string[]> {
  const ids = new Set<string>()

  const business = await (await businessesCol()).findOne({ id: businessId }, { projection: { legacyProjectId: 1 } })
  if (typeof business?.legacyProjectId === "string") ids.add(business.legacyProjectId)

  const applications = await (await connectedApplicationsCol())
    .find({ businessId }, { projection: { legacyProjectId: 1 } })
    .toArray()
  for (const application of applications) {
    if (typeof application.legacyProjectId === "string") ids.add(application.legacyProjectId)
  }

  const projects = await (await projectsCol())
    .find({ businessId }, { projection: { id: 1 } })
    .toArray()
  for (const project of projects) {
    if (typeof project.id === "string") ids.add(project.id)
  }

  return [...ids]
}

async function deleteAnchorProject(projectId: string): Promise<boolean> {
  const project = await store.getProject(projectId)
  if (!project) return false

  if (project.userId) return store.deleteProject(projectId, project.userId)

  // A connected project always has an owning account. If a legacy row somehow
  // does not, remove it directly and release its claims so it cannot keep
  // holding a hostname that another account is entitled to.
  const now = Date.now()
  await (await businessDomainsCol()).updateMany(
    { projectId, releasedAt: { $exists: false } },
    {
      $set: { status: "revoked", releasedAt: now, updatedAt: now },
      $unset: { token: "", tokenHash: "", claimExpiresAt: "" },
    },
  )
  await (await projectsCol()).deleteOne({ id: projectId })
  logger.warn("connected-business.delete", "removed ownerless anchor project", { projectId })
  return true
}
