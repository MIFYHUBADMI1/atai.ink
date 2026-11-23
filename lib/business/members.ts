import "server-only"

import type { ClientSession } from "mongodb"

import { AppError } from "@/lib/errors"
import { businessMembersCol, connectedApplicationsCol } from "@/lib/db/collections"
import { cryptoId } from "@/lib/store/id"
import {
  BUSINESS_ROLES,
  type BusinessMemberDoc,
  type BusinessRole,
  type MemberScope,
  type MigrationStamp,
} from "@/lib/types/business"

/**
 * Business membership (ADR-8 §6, D2).
 *
 * A membership row is the authorisation record. `businesses.ownerId` exists for
 * lookup and billing only — nothing here compares a business id to a user id.
 *
 * Two rules are enforced here rather than documented elsewhere:
 *
 * 1. Ownership is never granted or removed by member management. `addMember`
 *    cannot create an owner and `removeMember` cannot remove one. Changing
 *    ownership needs a dedicated operation, which does not exist yet.
 * 2. A removed member is never restored implicitly. Reactivation is its own
 *    call, requires an explicit role and scope, never inherits the previous
 *    scope, and records who did it. A history row must not become a way back in.
 *
 * Removal is a status change, never a delete. The access gate re-reads
 * membership on every call, so removal takes effect on the next request; any
 * future cache must key on `updatedAt` to keep that true.
 *
 * @module lib/business/members
 */

export function isBusinessRole(value: string): value is BusinessRole {
  return (BUSINESS_ROLES as readonly string[]).includes(value)
}

function memberId(): string {
  return `mem_${cryptoId()}`
}

export async function addOwner(input: {
  businessId: string
  userId: string
  now?: number
  migration?: MigrationStamp
  session?: ClientSession
}): Promise<BusinessMemberDoc> {
  return createMember({ ...input, role: "owner", scope: { kind: "all" } })
}

export async function addMember(input: {
  businessId: string
  userId: string
  role: BusinessRole
  scope?: MemberScope
  invitedBy?: string
  now?: number
  migration?: MigrationStamp
  session?: ClientSession
}): Promise<BusinessMemberDoc> {
  if (!isBusinessRole(input.role)) throw new AppError("VALIDATION", "That role isn't recognised.")
  if (input.role === "owner") {
    throw new AppError("VALIDATION", "Ownership is not granted by adding a member.")
  }
  const scope = await validateScope(input.businessId, input.scope ?? { kind: "all" })
  return createMember({ ...input, scope })
}

/**
 * Restore a removed member. Separate from `addMember` on purpose: an explicit
 * call, an explicit role, an explicit scope, and a record of who did it.
 */
export async function reactivateMember(input: {
  businessId: string
  userId: string
  role: BusinessRole
  scope: MemberScope
  reactivatedBy: string
  now?: number
}): Promise<BusinessMemberDoc> {
  if (!isBusinessRole(input.role)) throw new AppError("VALIDATION", "That role isn't recognised.")
  if (input.role === "owner") {
    throw new AppError("VALIDATION", "Ownership is not granted by reactivation.")
  }
  const scope = await validateScope(input.businessId, input.scope)

  const col = await businessMembersCol()
  const member = await col.findOne({ businessId: input.businessId, userId: input.userId })
  if (!member || member.status !== "removed") throw new AppError("NOT_FOUND")

  const now = input.now ?? Date.now()
  await col.updateOne(
    { businessId: input.businessId, userId: input.userId },
    {
      $set: {
        status: "active",
        role: input.role,
        scope,
        reactivatedBy: input.reactivatedBy,
        reactivatedAt: now,
        updatedAt: now,
      },
    },
  )

  return {
    ...member,
    status: "active",
    role: input.role,
    scope,
    reactivatedBy: input.reactivatedBy,
    reactivatedAt: now,
    updatedAt: now,
  }
}

export async function removeMember(input: {
  businessId: string
  userId: string
  now?: number
}): Promise<void> {
  const col = await businessMembersCol()
  const member = await col.findOne({ businessId: input.businessId, userId: input.userId })
  if (!member || member.status === "removed") throw new AppError("NOT_FOUND")
  if (member.role === "owner") {
    throw new AppError("VALIDATION", "Ownership is not changed by removing a member.")
  }

  await col.updateOne(
    { businessId: input.businessId, userId: input.userId },
    { $set: { status: "removed", updatedAt: input.now ?? Date.now() } },
  )
}

export async function listMembers(
  businessId: string,
  options: { includeRemoved?: boolean } = {},
): Promise<BusinessMemberDoc[]> {
  const filter: Record<string, unknown> = { businessId }
  if (!options.includeRemoved) filter.status = "active"
  const rows = await (await businessMembersCol()).find(filter).toArray()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function resolveMember(businessId: string, userId: string): Promise<BusinessMemberDoc | null> {
  return (await businessMembersCol()).findOne({ businessId, userId, status: "active" })
}

/**
 * Every application id must exist, belong to this business, and be active.
 * An id from another business is a validation error, never a silent grant.
 */
async function validateScope(businessId: string, scope: MemberScope): Promise<MemberScope> {
  if (scope.kind === "all") return scope

  const ids = [...new Set(scope.applicationIds)]
  if (ids.length === 0) throw new AppError("VALIDATION", "Choose at least one application.")
  if (ids.length !== scope.applicationIds.length) {
    throw new AppError("VALIDATION", "That application list contains duplicates.")
  }

  const found = await (await connectedApplicationsCol())
    .find({ id: { $in: ids }, businessId, archivedAt: { $exists: false } })
    .toArray()
  if (found.length !== ids.length) {
    throw new AppError("VALIDATION", "Every application must belong to this business and be active.")
  }
  return { kind: "applications", applicationIds: ids }
}

async function createMember(input: {
  businessId: string
  userId: string
  role: BusinessRole
  scope: MemberScope
  invitedBy?: string
  now?: number
  migration?: MigrationStamp
  session?: ClientSession
}): Promise<BusinessMemberDoc> {
  const now = input.now ?? Date.now()
  const col = await businessMembersCol()
  const existing = await col.findOne({ businessId: input.businessId, userId: input.userId })

  if (existing) {
    throw new AppError(
      "VALIDATION",
      existing.status === "removed"
        ? "This person was removed from the business. Reactivate them explicitly."
        : "That person is already a member of this business.",
    )
  }

  const member: BusinessMemberDoc = {
    id: memberId(),
    businessId: input.businessId,
    userId: input.userId,
    role: input.role,
    status: "active",
    scope: input.scope,
    createdAt: now,
    updatedAt: now,
  }
  if (input.invitedBy) member.invitedBy = input.invitedBy
  if (input.migration) member.migration = input.migration

  try {
    await col.insertOne(member, input.session ? { session: input.session } : undefined)
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new AppError("VALIDATION", "That person is already a member of this business.")
    }
    throw error
  }
  return member
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000
}
