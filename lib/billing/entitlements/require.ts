/**
 * Atai — Entitlement guard helpers for route/server-action enforcement.
 *
 * These helpers are intentionally FAIL-OPEN when the enforcement feature flag is
 * OFF, so enabling the entitlement system is a single env flip and existing
 * live billing is never affected until that flip happens AND migration has run.
 *
 * @module lib/billing/entitlements/require
 */

import { authorize, authorizeOperations } from "./service"
import type { EntitlementCheck } from "./types"

/**
 * Master kill-switch for plan enforcement.
 *
 * Enforcement is ON by default: the commercial catalog is the live catalog and
 * every plan's caps are enforced server-side. Set
 * `ENTITLEMENT_ENFORCEMENT_ENABLED=false` to fall back to unrestricted
 * creation (emergency rollback only).
 */
export const ENTITLEMENT_ENFORCEMENT_ENABLED =
  process.env.ENTITLEMENT_ENFORCEMENT_ENABLED !== "false"

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
  if (!ENTITLEMENT_ENFORCEMENT_ENABLED) return null
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
  if (!ENTITLEMENT_ENFORCEMENT_ENABLED) return { allowed: true }
  return authorize(userId, "useAgent", { agent }, { fresh: true })
}

async function checkOperation(
  userId: string,
  op: Parameters<typeof authorize>[1],
  ctx?: Parameters<typeof authorize>[2],
): Promise<EntitlementCheck | null> {
  if (!ENTITLEMENT_ENFORCEMENT_ENABLED) return null
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
