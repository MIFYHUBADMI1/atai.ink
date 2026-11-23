/**
 * Atai — Entitlement guard helpers for route/server-action enforcement.
 *
 * These helpers are intentionally FAIL-OPEN when the enforcement feature flag is
 * OFF, so enabling the entitlement system is a single env flip and existing
 * live billing is never affected until that flip happens AND migration has run.
 *
 * @module lib/billing/entitlements/require
 */

import {
  authorize,
  authorizeOperations,
  countSubdomainsAmongProjects,
  resolveScope,
  scopeKey,
} from "./service"
import { checkEntitlement } from "./catalog"
import {
  DOMAIN_HOLD_TTL_MS,
  SUBDOMAIN_HOLD_TTL_MS,
  ResourceLockBusyError,
  createResourceHold,
  findActiveResourceHold,
  listActiveSlotHolds,
  releaseResourceHold,
  slotHoldId,
  withResourceLock,
} from "./reservations"
import type { EntitlementCheck } from "./types"

/**
 * Master kill-switch for plan enforcement.
 *
 * Enforcement is ON by default: the commercial catalog is the live catalog and
 * every plan's caps are enforced server-side. Set
 * `ENTITLEMENT_ENFORCEMENT_ENABLED=false` to fall back to unrestricted
 * creation (emergency rollback only).
 */
export function isEntitlementEnforcementEnabled(): boolean {
  return process.env.ENTITLEMENT_ENFORCEMENT_ENABLED !== "false"
}

export const ENTITLEMENT_ENFORCEMENT_ENABLED = isEntitlementEnforcementEnabled()

// ADR-8: security-sensitive operations resolve fresh (cache bypass) rather than
// trust a (possibly stale) 60s cached entitlement.
export async function authorizeProjectCreation(userId: string, workspaceId?: string): Promise<EntitlementCheck> {
  return authorize(userId, "createProject", undefined, { fresh: true, workspaceId })
}

export async function authorizeProjectFork(userId: string): Promise<EntitlementCheck> {
  return authorize(userId, "forkProject", undefined, { fresh: true })
}

export async function authorizeProductionBuild(userId: string): Promise<EntitlementCheck> {
  return authorize(userId, "buildProduction", undefined, { fresh: true })
}

export async function authorizeProductionDeploy(userId: string): Promise<EntitlementCheck> {
  return authorize(userId, "deploy", undefined, { fresh: true })
}

/**
 * Gate a production build or deployment.
 *
 * Returns the denial the caller must turn into a 402, or null when the work is
 * permitted. A resolution error is a refusal, not a permission: the resolver
 * already degrades to last-known/planning-only internally, so reaching this
 * catch means we could not decide and the paid operation must wait.
 */
export async function authorizeProductionWork(
  userId: string,
  op: "buildProduction" | "deploy",
  opts: { hasExistingSubdomain?: boolean } = {},
): Promise<EntitlementCheck | null> {
  if (!isEntitlementEnforcementEnabled()) return null
  try {
    // A production build also provisions the application database and engages
    // the specialist team; resolve all three against one fresh snapshot.
    const requests = op === "deploy"
      ? [{ op: "deploy" as const }]
      : [
          { op: "buildProduction" as const },
          { op: "provisionDatabase" as const },
          { op: "useSpecialistTeam" as const },
        ]
    const checks = await authorizeOperations(userId, requests, { fresh: true })
    const denied = checks.find((check) => !check.allowed)
    if (denied) return denied
    if (op === "deploy" && !opts.hasExistingSubdomain) {
      return authorizeSubdomain(userId, false)
    }
    return null
  } catch {
    return {
      allowed: false,
      code: "ENTITLEMENT_UNAVAILABLE",
      reason: "We couldn't confirm your plan just now. Please try again.",
    }
  }
}

export async function authorizeAgent(userId: string, agent: "start" | "scout" | "optimize"): Promise<EntitlementCheck> {
  if (!isEntitlementEnforcementEnabled()) return { allowed: true }
  return authorize(userId, "useAgent", { agent }, { fresh: true })
}

async function checkOperation(
  userId: string,
  op: Parameters<typeof authorize>[1],
  ctx?: Parameters<typeof authorize>[2],
): Promise<EntitlementCheck | null> {
  if (!isEntitlementEnforcementEnabled()) return null
  const [check] = await authorizeOperations(userId, [{ op, ctx }], { fresh: true })
  return check.allowed ? null : check
}

/**
 * Adding a custom domain is a new restricted resource. Replacing or removing a
 * domain already attached to the project remains a management action.
 */
export async function authorizeCustomDomain(
  userId: string,
  hasExistingDomain: boolean,
): Promise<EntitlementCheck | null> {
  if (hasExistingDomain) return null
  return checkOperation(userId, "registerCustomDomain")
}

/** A project that already owns a production URL may always be republished. */
export async function authorizeSubdomain(
  userId: string,
  hasExistingSubdomain: boolean,
): Promise<EntitlementCheck | null> {
  if (hasExistingSubdomain) return null
  return checkOperation(userId, "connectSubdomain")
}

export interface SlotReservation {
  /** Present when the slot was reserved (or an idempotent retry found it). */
  holdId?: string
  /** True when the same project already owns an unexpired hold. */
  existing?: boolean
  /** 402-style denial, including the stable entitlement limit code. */
  denial?: { code: string; message: string }
  /** 409-style refusal while another request holds the capacity lock. */
  busy?: { code: string; message: string }
}

function slotDenial(check: EntitlementCheck): SlotReservation {
  return { denial: entitlementDenial(check) ?? { code: "ENTITLEMENT_DENIED", message: "Your plan does not include this operation." } }
}

async function reserveSlot(
  userId: string,
  projectId: string,
  kind: "customDomain" | "subdomain",
  hostname?: string,
): Promise<SlotReservation> {
  if (!isEntitlementEnforcementEnabled()) return {}
  const scope = scopeKey({ kind: "user", userId })
  const lockKey = `entitlement:${scope}:${kind}`

  try {
    return await withResourceLock(lockKey, async () => {
      // A retry for the same project already owns its slot. Return that hold
      // before the cap check; otherwise the retry would see its own hold as a
      // competing registration and be denied.
      const existing = await findActiveResourceHold(slotHoldId(scope, kind, projectId))
      if (existing) {
        const heldHostname = existing.metadata?.hostname
        if (kind === "customDomain" && hostname && typeof heldHostname === "string" && heldHostname !== hostname) {
          return {
            busy: {
              code: "DOMAIN_CHANGE_IN_PROGRESS",
              message: "A custom-domain change is already in progress for this project. Wait for it to finish.",
            },
          }
        }
        return { holdId: existing._id, existing: true }
      }

      const set = await resolveScope({ kind: "user", userId }, { fresh: true })
      const holds = await listActiveSlotHolds(scope, kind)
      const held = holds.length
      // A project that already counts as a subdomain is in `current`; its hold
      // must not count a second time. A hold whose project failed or has not
      // persisted yet is not in `current`, so it must count until released.
      const overlap =
        kind === "subdomain"
          ? await countSubdomainsAmongProjects(
              { kind: "user", userId },
              holds.map((hold) => hold.resourceId),
            )
          : 0
      const check = kind === "customDomain"
        ? checkEntitlement(
            { ...set, customDomainsIncluded: { ...set.customDomainsIncluded, consumed: set.customDomainsIncluded.consumed + held } },
            "registerCustomDomain",
          )
        : checkEntitlement(
            { ...set, subdomains: { ...set.subdomains, current: set.subdomains.current + held - overlap } },
            "connectSubdomain",
          )
      if (!check.allowed) return slotDenial(check)

      const hold = await createResourceHold({
        scopeKey: scope,
        kind,
        resourceId: projectId,
        userId,
        metadata: hostname ? { hostname } : undefined,
        ttlMs: kind === "customDomain" ? DOMAIN_HOLD_TTL_MS : SUBDOMAIN_HOLD_TTL_MS,
      })

      // A different hostname while a custom-domain change is in flight must
      // wait; reusing the same hostname is an idempotent retry.
      if (hold.existing && kind === "customDomain" && hostname) {
        const heldHostname = hold.hold.metadata?.hostname
        if (typeof heldHostname === "string" && heldHostname !== hostname) {
          return {
            busy: {
              code: "DOMAIN_CHANGE_IN_PROGRESS",
              message: "A custom-domain change is already in progress for this project. Wait for it to finish.",
            },
          }
        }
      }

      return { holdId: hold.holdId, existing: hold.existing }
    })
  } catch (error) {
    if (error instanceof ResourceLockBusyError) {
      return { busy: { code: error.code, message: error.message } }
    }
    return {
      denial: {
        code: "ENTITLEMENT_UNAVAILABLE",
        message: "We couldn't confirm your plan just now. Please try again.",
      },
    }
  }
}

/** Reserve the last custom-domain registration before the provider is called. */
export async function reserveCustomDomainSlot(
  userId: string,
  projectId: string,
  hostname: string,
): Promise<SlotReservation> {
  return reserveSlot(userId, projectId, "customDomain", hostname)
}

/** Reserve a first production subdomain before the deploy starts. */
export async function reserveSubdomainSlot(userId: string, projectId: string): Promise<SlotReservation> {
  return reserveSlot(userId, projectId, "subdomain")
}

export async function releaseCustomDomainSlot(userId: string, projectId: string): Promise<void> {
  if (!isEntitlementEnforcementEnabled()) return
  await releaseResourceHold(slotHoldId(scopeKey({ kind: "user", userId }), "customDomain", projectId)).catch(() => {})
}

export async function releaseSubdomainSlot(userId: string, projectId: string): Promise<void> {
  if (!isEntitlementEnforcementEnabled()) return
  await releaseResourceHold(slotHoldId(scopeKey({ kind: "user", userId }), "subdomain", projectId)).catch(() => {})
}

export async function authorizeProvisionDatabase(userId: string): Promise<EntitlementCheck | null> {
  return checkOperation(userId, "provisionDatabase")
}

export async function authorizeStorage(userId: string): Promise<EntitlementCheck | null> {
  return checkOperation(userId, "useStorage")
}

export async function authorizeSpecialistTeam(userId: string): Promise<EntitlementCheck | null> {
  return checkOperation(userId, "useSpecialistTeam")
}

export async function authorizeCompetitionIntel(userId: string): Promise<EntitlementCheck | null> {
  return checkOperation(userId, "useCompetitionIntel")
}

/** Shared machine-readable refusal shape for every entitlement-gated route. */
export function entitlementDenial(
  check: EntitlementCheck | null,
): { code: string; message: string } | null {
  if (!check || check.allowed) return null
  return {
    code: check.code ?? "ENTITLEMENT_DENIED",
    message: check.reason ?? "Your plan does not include this operation.",
  }
}

/** Thrown when enforcement is ON and the operation is not permitted. */
export class EntitlementError extends Error {
  code: string
  status: number
  constructor(check: EntitlementCheck) {
    super(check.reason ?? "Entitlement denied")
    this.name = "EntitlementError"
    this.code = check.code ?? "ENTITLEMENT_DENIED"
    this.status = 402
  }
}
