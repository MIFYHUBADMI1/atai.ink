import { randomUUID } from "crypto"
import { billingResourceHoldsCol, billingResourceLocksCol } from "@/lib/db/collections"
import type { BillingResourceHoldDoc, BillingResourceKind } from "@/lib/types/db"

/**
 * Database-backed capacity reservations.
 *
 * A fresh entitlement read is not atomic: two requests can both see the last
 * free slot. The lock serializes the read-check-reserve section, and the hold
 * is the durable claim that keeps counting until the provider succeeds and the
 * real resource is persisted. Holds expire so a crashed request cannot consume
 * capacity forever; they are never trusted after `expiresAt`.
 */

export const RESOURCE_LOCK_TTL_MS = 30_000
export const RESOURCE_LOCK_WAIT_MS = 2_000
export const RESOURCE_LOCK_RETRY_MS = 25
export const DOMAIN_HOLD_TTL_MS = 30 * 60_000
export const SUBDOMAIN_HOLD_TTL_MS = 6 * 60 * 60_000
export const STORAGE_HOLD_TTL_MS = 60 * 60_000

export class ResourceLockBusyError extends Error {
  readonly code = "ENTITLEMENT_BUSY"

  constructor(readonly key: string) {
    super("Another plan change is being processed. Please try again.")
    this.name = "ResourceLockBusyError"
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireLock(key: string, holder: string, ttlMs: number): Promise<boolean> {
  const col = await billingResourceLocksCol()
  const now = Date.now()
  try {
    const result = await col.findOneAndUpdate(
      { _id: key, $or: [{ expiresAt: { $lt: now } }, { holder }] },
      { $set: { holder, expiresAt: now + ttlMs } },
      { upsert: true, returnDocument: "after" },
    )
    return Boolean(result)
  } catch (error) {
    // The only expected error is a duplicate `_id`: another request inserted
    // the lock between our read and our upsert. Treat it as contention.
    if (isDuplicateKeyError(error)) return false
    throw error
  }
}

async function releaseLock(key: string, holder: string): Promise<void> {
  const col = await billingResourceLocksCol()
  await col.deleteOne({ _id: key, holder })
}

/** Run `fn` while holding a short database lock. Throws ResourceLockBusyError
 * if the lock cannot be acquired within the wait window. */
export async function withResourceLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number; retryMs?: number } = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? RESOURCE_LOCK_TTL_MS
  const waitMs = opts.waitMs ?? RESOURCE_LOCK_WAIT_MS
  const retryMs = opts.retryMs ?? RESOURCE_LOCK_RETRY_MS
  const holder = randomUUID()
  const deadline = Date.now() + waitMs

  for (;;) {
    if (await acquireLock(key, holder, ttlMs)) {
      try {
        return await fn()
      } finally {
        await releaseLock(key, holder).catch(() => {})
      }
    }
    if (Date.now() >= deadline) throw new ResourceLockBusyError(key)
    await sleep(retryMs)
  }
}

export function slotHoldId(scopeKey: string, kind: BillingResourceKind, resourceId: string): string {
  return `${scopeKey}:${kind}:${resourceId}`
}

export interface CreateHoldInput {
  scopeKey: string
  kind: BillingResourceKind
  resourceId: string
  userId: string
  bytes?: number
  operationId?: string
  metadata?: Record<string, unknown>
  ttlMs?: number
}

export interface CreateHoldResult {
  holdId: string
  existing: boolean
  hold: BillingResourceHoldDoc
}

function holdIdFor(input: CreateHoldInput): string {
  if (input.kind === "storage") {
    return `${input.scopeKey}:storage:${input.resourceId}:${input.operationId ?? randomUUID()}`
  }
  return slotHoldId(input.scopeKey, input.kind, input.resourceId)
}

/**
 * Insert a hold, or return the existing unexpired hold for the same id. The
 * deterministic id makes a slot reservation idempotent; a storage hold uses a
 * per-operation id so two distinct uploads are counted separately.
 */
export async function createResourceHold(input: CreateHoldInput): Promise<CreateHoldResult> {
  const col = await billingResourceHoldsCol()
  const now = Date.now()
  const holdId = holdIdFor(input)
  const doc: BillingResourceHoldDoc = {
    _id: holdId,
    scopeKey: input.scopeKey,
    kind: input.kind,
    resourceId: input.resourceId,
    userId: input.userId,
    ...(input.bytes !== undefined ? { bytes: input.bytes } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? STORAGE_HOLD_TTL_MS),
  }

  // A crashed request may have left an expired row with the same deterministic
  // id. Remove only the expired row; an unexpired hold is the idempotent answer.
  await col.deleteOne({ _id: holdId, expiresAt: { $lt: now } }).catch(() => {})
  try {
    await col.insertOne(doc)
    return { holdId, existing: false, hold: doc }
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    const existing = await col.findOne({ _id: holdId })
    if (!existing) throw error
    return { holdId, existing: true, hold: existing }
  }
}

export async function findActiveResourceHold(
  holdId: string,
  now = Date.now(),
): Promise<BillingResourceHoldDoc | null> {
  const col = await billingResourceHoldsCol()
  return col.findOne({ _id: holdId, expiresAt: { $gt: now } })
}

export async function releaseResourceHold(holdId: string): Promise<void> {
  const col = await billingResourceHoldsCol()
  await col.deleteOne({ _id: holdId })
}

export async function listActiveSlotHolds(
  scopeKey: string,
  kind: BillingResourceKind,
  now = Date.now(),
): Promise<BillingResourceHoldDoc[]> {
  const col = await billingResourceHoldsCol()
  return col.find({ scopeKey, kind, expiresAt: { $gt: now } }).toArray()
}

export async function countActiveSlotHolds(
  scopeKey: string,
  kind: BillingResourceKind,
  now = Date.now(),
): Promise<number> {
  const col = await billingResourceHoldsCol()
  return col.countDocuments({ scopeKey, kind, expiresAt: { $gt: now } })
}

export async function sumActiveStorageHolds(projectId: string, now = Date.now()): Promise<number> {
  const col = await billingResourceHoldsCol()
  const rows = await col
    .find({ resourceId: projectId, kind: "storage", expiresAt: { $gt: now } }, { projection: { bytes: 1 } })
    .toArray()
  return rows.reduce(
    (total, row) => total + (typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : 0),
    0,
  )
}
