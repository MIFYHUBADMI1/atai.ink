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

/** Master kill-switch. Off by default — existing flows are untouched. */
export const ENTITLEMENT_ENFORCEMENT_ENABLED =
  process.env.ENTITLEMENT_ENFORCEMENT_ENABLED === "true"

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
