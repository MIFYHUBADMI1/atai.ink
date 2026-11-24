import "server-only"

import { AppError } from "@/lib/errors"
import {
  businessDomainsCol,
  businessMembersCol,
  businessesCol,
  connectedApplicationsCol,
} from "@/lib/db/collections"
import { MAX_DOMAIN_HISTORY } from "@/lib/domain/service"
import { getMongoClient } from "@/lib/db/mongodb"
import { cryptoId } from "@/lib/store/id"
import {
  BUSINESS_SCHEMA_VERSION,
  type BusinessDoc,
  type MigrationStamp,
  type SuggestedNameSource,
} from "@/lib/types/business"
import { requireBusinessAccess } from "./access"
import { addOwner } from "./members"
import { type Actor, systemActor } from "./permissions"

/**
 * Business lifecycle (ADR-8 §5, §7).
 *
 * Creation is the one operation with no business to authorise against, so it
 * carries its own rule: the owner is the authenticated actor, never a caller-
 * supplied id. Every other operation gates itself.
 *
 * Creation is also the only operation that writes two collections, so it runs
 * in one transaction: a business without its owner membership is a corrupt
 * record the access gate would treat as unreachable.
 *
 * The name is founder-owned once set. `suggestedName` records where the first
 * suggestion came from and is never used to re-derive `name`.
 *
 * @module lib/business/service
 */

export interface CreateBusinessInput {
  actor: Actor
  name?: string
  suggestedName?: string
  suggestedNameSource?: SuggestedNameSource
  /** Present only when a migration creates the business; absent for founders. */
  migration?: MigrationStamp
  now?: number
}

export async function createBusiness(input: CreateBusinessInput): Promise<BusinessDoc> {
  if (input.actor.kind !== "user") {
    throw new AppError("VALIDATION", "A business is created by a signed-in person.")
  }

  const now = input.now ?? Date.now()
  const suggested = input.suggestedName?.trim() || undefined
  const name = (input.name ?? suggested ?? "").trim()
  if (!name) throw new AppError("VALIDATION", "Give the business a name.")

  const business: BusinessDoc = {
    id: `biz_${cryptoId()}`,
    ownerId: input.actor.id,
    name,
    status: "draft",
    schemaVersion: BUSINESS_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  }
  if (suggested) {
    business.suggestedName = suggested
    business.suggestedNameSource = input.suggestedNameSource ?? "hostname"
  }
  if (input.migration) business.migration = input.migration

  const client = await getMongoClient()
  const session = client.startSession()
  try {
    await session.withTransaction(async () => {
      await (await businessesCol()).insertOne(business, { session })
      await addOwner({
        businessId: business.id,
        userId: input.actor.id,
        actor: systemActor("business-creation"),
        migration: input.migration,
        now,
        session,
      })
    })
  } finally {
    await session.endSession()
  }
  return business
}

export async function getBusiness(input: { businessId: string; actor: Actor }): Promise<BusinessDoc> {
  const access = await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "business.read",
  })
  return access.business
}

/** Renaming never touches `suggestedName` — the suggestion is history, not a fallback. */
export async function renameBusiness(input: {
  businessId: string
  name: string
  actor: Actor
  now?: number
}): Promise<BusinessDoc> {
  await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "business.manage",
  })

  const name = input.name.trim()
  if (!name) throw new AppError("VALIDATION", "Give the business a name.")

  const col = await businessesCol()
  const result = await col.updateOne(
    { id: input.businessId },
    { $set: { name, updatedAt: input.now ?? Date.now() } },
  )
  if (result.matchedCount === 0) throw new AppError("BUSINESS_NOT_FOUND")
  const updated = await col.findOne({ id: input.businessId })
  if (!updated) throw new AppError("BUSINESS_NOT_FOUND")
  return updated
}

/** Archiving is a status change. Claims, events, usage and charges are untouched. */
export async function archiveBusiness(input: {
  businessId: string
  actor: Actor
  now?: number
}): Promise<BusinessDoc> {
  const access = await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "business.manage",
  })

  const now = input.now ?? Date.now()
  const col = await businessesCol()
  const result = await col.updateOne(
    { id: input.businessId },
    { $set: { status: "archived", archivedAt: now, archivedFrom: access.business.status, updatedAt: now } },
  )
  if (result.matchedCount === 0) throw new AppError("BUSINESS_NOT_FOUND")
  const updated = await col.findOne({ id: input.businessId })
  if (!updated) throw new AppError("BUSINESS_NOT_FOUND")
  return updated
}

/**
 * Undo an archive. Restoration is its own operation because the gate blocks
 * every other write on an archived business: without this, archiving would be
 * a one-way door.
 *
 * It restores the status the business held before archiving and records who
 * did it. It never touches a suspended business, and it leaves memberships,
 * applications, claims and history exactly as they were.
 */
export async function restoreBusiness(input: {
  businessId: string
  actor: Actor
  now?: number
}): Promise<BusinessDoc> {
  const access = await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "business.manage",
    allowArchived: true,
  })

  if (access.business.status !== "archived") {
    throw new AppError("VALIDATION", "This business isn't archived.")
  }

  const now = input.now ?? Date.now()
  const col = await businessesCol()
  const result = await col.updateOne(
    { id: input.businessId, status: "archived" },
    {
      $set: {
        status: access.business.archivedFrom ?? "active",
        restoredBy: input.actor.id,
        restoredAt: now,
        updatedAt: now,
      },
    },
  )
  if (result.matchedCount === 0) throw new AppError("BUSINESS_NOT_FOUND")
  const updated = await col.findOne({ id: input.businessId })
  if (!updated) throw new AppError("BUSINESS_NOT_FOUND")
  return updated
}

/**
 * Permanently delete a connected business.
 *
 * Only the owner may delete it: an admin can run the business, but removing it
 * destroys the owner's record and frees its website for someone else.
 *
 * The business row, its memberships, its applications and every domain claim it
 * still holds are removed in one transaction. Claims are *released*, not
 * deleted — the same rule project deletion follows — so the hostname leaves the
 * uniqueness index and another account can connect it.
 *
 * The hidden anchor project is deleted by `lib/connected-business/deletion`,
 * because this module must not import a project. Billing, refunds and audit
 * records stay outside this operation.
 */
export async function deleteBusiness(input: {
  businessId: string
  actor: Actor
  now?: number
}): Promise<{ business: BusinessDoc; releasedClaims: number }> {
  const access = await requireBusinessAccess({
    businessId: input.businessId,
    actor: input.actor,
    permission: "business.manage",
    allowArchived: true,
  })
  if (access.role !== "owner") {
    throw new AppError("BUSINESS_FORBIDDEN", "Only the business owner can delete it.")
  }

  const now = input.now ?? Date.now()
  const client = await getMongoClient()
  const session = client.startSession()
  let releasedClaims = 0
  try {
    await session.withTransaction(async () => {
      const claims = await (await businessDomainsCol()).updateMany(
        { businessId: input.businessId, releasedAt: { $exists: false } },
        {
          $set: { status: "revoked", releasedAt: now, updatedAt: now },
          $unset: { token: "", tokenHash: "", claimExpiresAt: "" },
          $push: {
            history: {
              $each: [{ status: "revoked", at: now, detail: "business deleted" }],
              $position: 0,
              $slice: MAX_DOMAIN_HISTORY,
            },
          },
        },
        { session },
      )
      releasedClaims = claims.modifiedCount ?? 0

      await (await connectedApplicationsCol()).deleteMany({ businessId: input.businessId }, { session })
      await (await businessMembersCol()).deleteMany({ businessId: input.businessId }, { session })
      await (await businessesCol()).deleteOne({ id: input.businessId }, { session })
    })
  } finally {
    await session.endSession()
  }

  return { business: access.business, releasedClaims }
}

/**
 * Self-scoped listing: the actor can only ever see their own memberships.
 * There is no parameter through which another user's businesses could be named.
 */
export async function listBusinessesForUser(input: { actor: Actor }): Promise<BusinessDoc[]> {
  if (input.actor.kind !== "user") {
    throw new AppError("VALIDATION", "A system actor has no businesses to list.")
  }

  const memberships = await (await businessMembersCol())
    .find({ userId: input.actor.id, status: "active" })
    .toArray()
  const ids = memberships.map((membership) => membership.businessId)
  if (ids.length === 0) return []
  const rows = await (await businessesCol()).find({ id: { $in: ids } }).toArray()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}
