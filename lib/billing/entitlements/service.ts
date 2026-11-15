/**
 * Atai — Centralized entitlement service (Phase 3).
 *
 * The single authority that answers "what can this account do?". Every route,
 * server action, background job and Runtime endpoint resolves access through
 * here. It is derived purely from server-side state (SubscriptionRecord +
 * project counts); client-supplied plan/price values are never trusted.
 *
 * Safe-degradation (ADR-8):
 *  - A cache abstraction (EntitlementCache) holds a short-lived (≤60s) fast
 *    copy. Invalidation is event-driven from webhooks/grants/downgrades.
 *  - A separate `lastKnown` snapshot is retained so a DB outage falls back to
 *    the most recent resolution within a freshness bound — never to a
 *    permissive state. Only if NO snapshot exists do we fall back to the
 *    conservative planning-only Explorer view.
 *  - Security-sensitive operations resolve fresh (cache bypass) via
 *    `resolveScope(scope, { fresh: true })`.
 *
 * @module lib/billing/entitlements/service
 */

import { subscriptionRecordsCol, projectsCol } from "@/lib/db/collections"
import { buildEntitlementSet, ENTITLEMENT_VERSION } from "./catalog"
import { resolveCommercialPlan, isCommercialPlanId } from "./migration-map"
import { checkEntitlement } from "./catalog"
import { entitlementCache } from "./cache"
import type { EntitlementSet, EntitlementOp, EntitlementCheck, CommercialPlanId } from "./types"

/** How long a last-known snapshot is trusted during a downstream failure. */
const SNAPSHOT_FRESHNESS_MS = 24 * 60 * 60 * 1000
/** Short cache TTL — advisory only for sensitive paths (ADR-8). */
const CACHE_TTL_MS = 60_000

/**
 * Entitlements are workspace-scoped (ADR-7). A user scope is retained for
 * backward compatibility and single-owner accounts; production resolution
 * prefers the workspace so collaborators share one plan cap.
 */
export type EntitlementScope =
  | { kind: "user"; userId: string }
  | { kind: "workspace"; workspaceId: string }

export function scopeKey(scope: EntitlementScope): string {
  return scope.kind === "user" ? `u:${scope.userId}` : `w:${scope.workspaceId}`
}

/** Last-known good snapshot per scope key, used only for safe failure. */
const lastKnown = new Map<string, { set: EntitlementSet; at: number }>()

const PLANNING_ONLY: EntitlementSet = buildEntitlementSet("explorer", {
  businesses: 0,
  productionApps: 0,
  subdomains: 0,
  customDomainsConsumed: 0,
})

/** Count owned, non-deleted projects — the proxy for "businesses". */
export async function getBusinessCount(userId: string): Promise<number> {
  try {
    const col = await projectsCol()
    // All owned projects count toward the business cap (archive does NOT free a slot).
    return await col.countDocuments({ userId })
  } catch {
    return 0
  }
}

async function getWorkspaceOwnerId(workspaceId: string): Promise<string | null> {
  try {
    const col = await projectsCol()
    const sample = await col.findOne({ workspaceId }, { projection: { userId: 1 } })
    return sample?.userId ?? null
  } catch {
    return null
  }
}

async function countBusinessesForScope(scope: EntitlementScope): Promise<number> {
  try {
    const col = await projectsCol()
    return scope.kind === "user"
      ? await col.countDocuments({ userId: scope.userId })
      : await col.countDocuments({ workspaceId: scope.workspaceId })
  } catch {
    return 0
  }
}

async function getActiveSubscriptionForScope(scope: EntitlementScope) {
  try {
    const col = await subscriptionRecordsCol()
    if (scope.kind === "user") {
      return await col.findOne(
        { userId: scope.userId, status: { $in: ["active", "trialing", "past_due"] } },
        { sort: { createdAt: -1 } },
      )
    }
    const ownerId = await getWorkspaceOwnerId(scope.workspaceId)
    if (!ownerId) return null
    return await col.findOne(
      { userId: ownerId, status: { $in: ["active", "trialing", "past_due"] } },
      { sort: { createdAt: -1 } },
    )
  } catch {
    return null
  }
}

function snapshotFromSub(sub: Record<string, unknown>): EntitlementSet | undefined {
  const snap = sub.entitlementSnapshot as EntitlementSet | undefined
  return snap ?? undefined
}

async function computeSet(scope: EntitlementScope): Promise<EntitlementSet> {
  const sub = await getActiveSubscriptionForScope(scope)
  const businesses = await countBusinessesForScope(scope)

  if (!sub) {
    // No subscription record means a free account. One that already owns
    // projects is grandfathered (legacy free behaviour) so turning enforcement
    // on never caps a founder's existing assets.
    const preserve = businesses > 0
    return buildEntitlementSet(
      "explorer",
      {
        businesses,
        productionApps: businesses,
        subdomains: 0,
        customDomainsConsumed: 0,
      },
      {
        legacyPlanId: "free",
        grandfathered: preserve,
        preserveLegacyBehavior: preserve,
      },
    )
  }

  // Post-migration path: a stored snapshot + commercialPlanId wins.
  const storedCommercial = sub.commercialPlanId as string | undefined
  const snapshot = snapshotFromSub(sub as unknown as Record<string, unknown>)
  if (storedCommercial && snapshot) {
    const set = snapshot
    set.businesses.current = businesses
    set.productionApps.current = businesses
    return set
  }

  // A stored commercialPlanId without a snapshot: the subscription was created
  // by the new commercial checkout, which writes the plan id but freezes no
  // snapshot. The stored id is authoritative on its own — falling through to
  // the legacy resolver would hand a paying Growth/Scale customer the free
  // Explorer set.
  if (isCommercialPlanId(storedCommercial)) {
    return buildEntitlementSet(storedCommercial, {
      businesses,
      productionApps: businesses,
      subdomains: 0,
      customDomainsConsumed: 0,
    }, {
      legacyPlanId: (sub.planId as string) ?? undefined,
      grandfathered: false,
      preserveLegacyBehavior: false,
    })
  }

  const legacyPlanId = (sub.planId as string) ?? "free"
  const resolved = resolveCommercialPlan(legacyPlanId, { hasProjects: businesses > 0 })
  return buildEntitlementSet(resolved.commercialPlanId, {
    businesses,
    productionApps: businesses,
    subdomains: 0,
    customDomainsConsumed: 0,
  }, {
    legacyPlanId: resolved.legacyPlanId,
    grandfathered: resolved.grandfathered,
    preserveLegacyBehavior: resolved.preserveLegacyBehavior,
  })
}

/**
 * Resolve the entitlement set for a scope. Returns a cached copy when fresh,
 * otherwise computes from the database. On a downstream failure it degrades to
 * the last-known snapshot (within freshness) and only then to the conservative
 * planning-only Explorer view — never to a permissive state.
 */
export async function resolveScope(
  scope: EntitlementScope,
  opts: { fresh?: boolean } = {},
): Promise<EntitlementSet> {
  const key = scopeKey(scope)
  if (!opts.fresh) {
    const cached = entitlementCache.get(key)
    if (cached) return cached
  }

  try {
    const set = await computeSet(scope)
    entitlementCache.set(key, set)
    lastKnown.set(key, { set, at: Date.now() })
    return set
  } catch {
    // Safe failure ladder (ADR-8): last-known → planning-only. Never permissive.
    const recent = lastKnown.get(key)
    if (recent && Date.now() - recent.at <= SNAPSHOT_FRESHNESS_MS) {
      return recent.set
    }
    return PLANNING_ONLY
  }
}

/** Backward-compatible user-scope resolver. */
export async function resolveEntitlements(userId: string): Promise<EntitlementSet> {
  return resolveScope({ kind: "user", userId })
}

/** Workspace-scope resolver (ADR-7). */
export async function resolveForWorkspace(workspaceId: string): Promise<EntitlementSet> {
  return resolveScope({ kind: "workspace", workspaceId })
}

export interface AuthorizeOpts {
  /** Resolve at workspace scope instead of the user scope. */
  workspaceId?: string
  /** Bypass the cache and force a fresh DB read (security-sensitive ops). */
  fresh?: boolean
}

/** Authorize an operation. Always returns a structured decision. */
export async function authorize(
  userId: string,
  op: EntitlementOp,
  ctx?: { agent?: "start" | "scout" | "optimize" },
  opts?: AuthorizeOpts,
): Promise<EntitlementCheck> {
  const scope: EntitlementScope = opts?.workspaceId
    ? { kind: "workspace", workspaceId: opts.workspaceId }
    : { kind: "user", userId }
  const set = await resolveScope(scope, { fresh: opts?.fresh })
  return checkEntitlement(set, op, ctx)
}

/** Invalidate cached entitlements for a scope (call on webhook/grant/downgrade). */
export function invalidateEntitlements(scope: EntitlementScope): void {
  entitlementCache.invalidate(scopeKey(scope))
}

/** Convenience: invalidate by user id (clears both user + any derived key). */
export function invalidateForUser(userId: string): void {
  entitlementCache.invalidate(`u:${userId}`)
}

export { ENTITLEMENT_VERSION }
export type { CommercialPlanId }
