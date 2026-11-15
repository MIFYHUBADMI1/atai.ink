/**
 * Atai — Entitlement guard helpers for route/server-action enforcement.
 *
 * These helpers are intentionally FAIL-OPEN when the enforcement feature flag is
 * OFF, so enabling the entitlement system is a single env flip and existing
 * live billing is never affected until that flip happens AND migration has run.
 *
 * @module lib/billing/entitlements/require
 */

import { authorize } from "./service"
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
 * permitted. Fail-open on a resolution error: the resolver already degrades to
 * last-known/planning-only inside its own failure ladder, so an exception here
 * means "we could not decide", and a database blip must not freeze a founder's
 * build.
 */
export async function authorizeProductionWork(
  userId: string,
  op: "buildProduction" | "deploy",
): Promise<EntitlementCheck | null> {
  if (!ENTITLEMENT_ENFORCEMENT_ENABLED) return null
  try {
    const check = op === "deploy"
      ? await authorizeProductionDeploy(userId)
      : await authorizeProductionBuild(userId)
    return check.allowed ? null : check
  } catch {
    return null
  }
}

export async function authorizeAgent(userId: string, agent: "start" | "scout" | "optimize"): Promise<EntitlementCheck> {
  return authorize(userId, "useAgent", { agent }, { fresh: true })
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
