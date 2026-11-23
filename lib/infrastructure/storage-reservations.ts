import "server-only"
import {
  ResourceLockBusyError,
  STORAGE_HOLD_TTL_MS,
  createResourceHold,
  releaseResourceHold,
  sumActiveStorageHolds,
  withResourceLock,
} from "@/lib/billing/entitlements/reservations"
import { checkEntitlement } from "@/lib/billing/entitlements/catalog"
import { isEntitlementEnforcementEnabled } from "@/lib/billing/entitlements/require"
import { resolveScope, scopeKey } from "@/lib/billing/entitlements/service"
import { getProjectStorageUsage } from "./service"

export interface StorageReservation {
  holdId?: string
  denial?: { code: string; message: string }
  busy?: { code: string; message: string }
}

const STORAGE_LIMIT_MESSAGE =
  "This project has reached its infrastructure storage limit. Upgrade the infrastructure plan to add more."

/**
 * Reserve bytes before an upload or generated asset is written. The lock
 * serializes the check against other writers; the hold keeps the bytes counted
 * until the asset row exists or the operation fails.
 */
export async function reserveProjectStorage(params: {
  userId: string
  projectId: string
  bytes: number
  operationId?: string
}): Promise<StorageReservation> {
  const { userId, projectId, bytes, operationId } = params
  if (!Number.isFinite(bytes) || bytes <= 0) return {}

  const scope = scopeKey({ kind: "user", userId })
  try {
    return await withResourceLock(`storage:${projectId}`, async () => {
      // Re-check the capability inside the lock: a downgrade racing the upload
      // must not slip through the route's earlier guard. With enforcement OFF,
      // the pre-existing infrastructure byte quota still applies.
      if (isEntitlementEnforcementEnabled()) {
        const set = await resolveScope({ kind: "user", userId }, { fresh: true })
        const capability = checkEntitlement(set, "useStorage")
        if (!capability.allowed) {
          return {
            denial: {
              code: capability.code ?? "STORAGE_UNAVAILABLE",
              message: capability.reason ?? "Your plan does not include infrastructure storage.",
            },
          }
        }
      }

      const usage = await getProjectStorageUsage(projectId)
      if (usage.limitBytes === null) return {}

      const held = await sumActiveStorageHolds(projectId)
      if (usage.usedBytes + held + bytes > usage.limitBytes) {
        return { denial: { code: "STORAGE_LIMIT_REACHED", message: STORAGE_LIMIT_MESSAGE } }
      }

      const hold = await createResourceHold({
        scopeKey: scope,
        kind: "storage",
        resourceId: projectId,
        userId,
        bytes,
        operationId,
        ttlMs: STORAGE_HOLD_TTL_MS,
      })
      return { holdId: hold.holdId }
    })
  } catch (error) {
    if (error instanceof ResourceLockBusyError) {
      return { busy: { code: error.code, message: error.message } }
    }
    return {
      denial: {
        code: "STORAGE_UNAVAILABLE",
        message: "We couldn't confirm the project's storage allowance just now. Please try again.",
      },
    }
  }
}

export async function releaseProjectStorage(holdId: string | undefined): Promise<void> {
  if (!holdId) return
  await releaseResourceHold(holdId).catch(() => {})
}

export async function getReservedStorageBytes(projectId: string): Promise<number> {
  return sumActiveStorageHolds(projectId)
}
