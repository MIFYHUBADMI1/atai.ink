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
import type { SubscriptionRecord } from "@/lib/billing/billing-types"

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

function scopeFilter(scope: EntitlementScope): Record<string, string> {
  return scope.kind === "user" ? { userId: scope.userId } : { workspaceId: scope.workspaceId }
}

/**
 * A production subdomain belongs to a project once it has ever deployed
 * successfully. A failed later deploy must not free the slot: the live URL
 * still exists.
 */
async function countSubdomainsForScope(scope: EntitlementScope): Promise<number> {
  try {
    const col = await projectsCol()
    return await col.countDocuments({
      ...scopeFilter(scope),
      $or: [
        { "deployment.status": "success" },
        { "deployment.productionUrl": { $exists: true, $ne: "" } },
        { state: "deployed" },
        // A first deploy in flight has already claimed its slot; the hold is
        // released only when the deployment fails or resolves.
        { state: "deploying" },
      ],
    })
  } catch {
    return 0
  }
}

/** Projects currently in the first-deploy window; their slot is also held. */
export async function countDeployingProjectsForScope(scope: EntitlementScope): Promise<number> {
  try {
    const col = await projectsCol()
    return await col.countDocuments({ ...scopeFilter(scope), state: "deploying" })
  } catch {
    return 0
  }
}

/**
 * Count projects that have consumed a custom-domain registration. New records
 * persist the active hostname on `deployment.customDomain`; legacy records are
 * recognised from their deployment history so an existing paid domain is never
 * silently treated as unused.
 */
async function countCustomDomainsForScope(scope: EntitlementScope): Promise<number> {
  try {
    const col = await projectsCol()
    return await col.countDocuments({
      ...scopeFilter(scope),
      $or: [
        { "deployment.customDomain": { $exists: true, $ne: null } },
        { "deploymentHistory.customDomain": { $exists: true, $ne: null } },
      ],
    })
  } catch {
    return 0
  }
}

interface ScopeUsage {
  businesses: number
  subdomains: number
  customDomainsConsumed: number
}

async function getUsageForScope(scope: EntitlementScope): Promise<ScopeUsage> {
  const [businesses, subdomains, customDomainsConsumed] = await Promise.all([
    countBusinessesForScope(scope),
    countSubdomainsForScope(scope),
    countCustomDomainsForScope(scope),
  ])
  return { businesses, subdomains, customDomainsConsumed }
}

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const
const TERMINATED_SUBSCRIPTION_STATUSES = new Set<string>([
  "cancelled",
  "canceled",
  "terminated",
  "expired",
])

async function getSubscriptionForScope(
  scope: EntitlementScope,
  status?: readonly SubscriptionRecord["status"][],
) {
  const col = await subscriptionRecordsCol()
  const userId = scope.kind === "user" ? scope.userId : await getWorkspaceOwnerId(scope.workspaceId)
  if (!userId) return null
  return await col.findOne(
    { userId, ...(status ? { status: { $in: status } } : {}) },
    { sort: { createdAt: -1 } },
  )
}

async function getActiveSubscriptionForScope(scope: EntitlementScope) {
  return getSubscriptionForScope(scope, ACTIVE_SUBSCRIPTION_STATUSES)
}

/**
 * A terminated paid subscription is not the same as a legacy free account.
 * The free plan's grandfathering exists to protect founders who never bought a
 * paid plan; it must not restore production capability after cancellation.
 */
async function hasTerminatedSubscription(scope: EntitlementScope): Promise<boolean> {
  const latest = await getSubscriptionForScope(scope)
  return Boolean(latest && TERMINATED_SUBSCRIPTION_STATUSES.has(latest.status))
}

/**
 * Copy a frozen snapshot before attaching live counts. The stored snapshot is
 * the purchase-time record and must never be mutated in place.
 */
function cloneEntitlementSet(set: EntitlementSet): EntitlementSet {
  return JSON.parse(JSON.stringify(set)) as EntitlementSet
}

async function computeSet(scope: EntitlementScope): Promise<EntitlementSet> {
  const sub = await getActiveSubscriptionForScope(scope)
  const usage = await getUsageForScope(scope)
  const businesses = usage.businesses

  if (!sub) {
    // No active subscription means free access. A legacy free account that
    // already owns projects keeps its old capability, but a terminated paid
    // subscription must fall back to Explorer rather than re-acquiring it.
    const terminated = await hasTerminatedSubscription(scope)
    const preserve = businesses > 0 && !terminated
    return {
      ...buildEntitlementSet(
        "explorer",
        {
          businesses,
          productionApps: businesses,
          subdomains: usage.subdomains,
          customDomainsConsumed: usage.customDomainsConsumed,
        },
        {
          legacyPlanId: "free",
          grandfathered: preserve,
          preserveLegacyBehavior: preserve,
        },
      ),
      entitlementSource: "free",
    }
  }

  // Post-migration path: a frozen snapshot wins over the live catalog. The
  // purchased plan, caps and benefits stay exactly as bought. A provisional
  // snapshot is used for review-pending records but is labelled as such.
  const terms = sub.purchasedTerms
  const snapshot =
    terms?.entitlementSnapshot ?? (sub.entitlementSnapshot as EntitlementSet | undefined)
  if (snapshot) {
    const set = cloneEntitlementSet(snapshot)
    set.businesses.current = businesses
    set.productionApps.current = businesses
    set.subdomains.current = usage.subdomains
    set.customDomainsIncluded.consumed = usage.customDomainsConsumed
    // The purchased allocation is authoritative even if the snapshot was
    // frozen from a different catalog generation.
    if (typeof terms?.monthlyCredits === "number") {
      set.credits = { ...set.credits, monthlyGrant: terms.monthlyCredits }
    }
    const provisional =
      sub.termsStatus === "needs_review" ||
      terms?.entitlementEvidence === "legacy_mapping_provisional"
    set.entitlementSource = provisional ? "review_provisional" : "pinned"
    return set
  }

  const storedCommercial = sub.commercialPlanId as string | undefined
  // A record the migration could not pin is deliberately NOT downgraded while
  // it awaits review: preserve its legacy capability until an operator settles
  // the terms. This mirrors grandfathered free behaviour.
  const needsReview = sub.termsStatus === "needs_review"
  if (isCommercialPlanId(storedCommercial)) {
    // No frozen snapshot exists. Do NOT persist today's commercial catalog as
    // if it were purchased: resolve the record's legacy-compatible plan, keep
    // its current capability, and label the gap `needs_review`. The migration
    // freezes this provisional resolution and flags the record.
    const legacyResolved = resolveCommercialPlan((sub.planId as string) ?? storedCommercial)
    return {
      ...buildEntitlementSet(storedCommercial, {
        businesses,
        productionApps: businesses,
        subdomains: usage.subdomains,
        customDomainsConsumed: usage.customDomainsConsumed,
      }, {
        legacyPlanId: (sub.planId as string) ?? legacyResolved.legacyPlanId,
        grandfathered: needsReview || sub.grandfathered === true || legacyResolved.grandfathered,
        preserveLegacyBehavior:
          needsReview || sub.grandfathered === true || legacyResolved.preserveLegacyBehavior,
      }),
      entitlementSource: "needs_review",
    }
  }

  const legacyPlanId = (sub.planId as string) ?? "free"
  const resolved = resolveCommercialPlan(legacyPlanId, { hasProjects: businesses > 0 })
  return {
    ...buildEntitlementSet(resolved.commercialPlanId, {
      businesses,
      productionApps: businesses,
      subdomains: usage.subdomains,
      customDomainsConsumed: usage.customDomainsConsumed,
    }, {
      legacyPlanId: resolved.legacyPlanId,
      grandfathered: resolved.grandfathered || needsReview,
      preserveLegacyBehavior: resolved.preserveLegacyBehavior || needsReview,
    }),
    entitlementSource: "legacy",
  }
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

/** Live usage counters used by the entitlement snapshot and access views. */
export async function getUsageCounts(userId: string): Promise<ScopeUsage> {
  return getUsageForScope({ kind: "user", userId })
}

export interface AuthorizeOpts {
  /** Resolve at workspace scope instead of the user scope. */
  workspaceId?: string
  /** Bypass the cache and force a fresh DB read (security-sensitive ops). */
  fresh?: boolean
}

export interface AuthorizeRequest {
  op: EntitlementOp
  ctx?: { agent?: "start" | "scout" | "optimize" }
}

/**
 * Resolve once and check several operations against the same snapshot. Used by
 * compound actions (a build also provisions a database) so a plan change cannot
 * be observed half-way between two independent resolutions.
 */
export async function authorizeOperations(
  userId: string,
  requests: readonly AuthorizeRequest[],
  opts?: AuthorizeOpts,
): Promise<EntitlementCheck[]> {
  const scope: EntitlementScope = opts?.workspaceId
    ? { kind: "workspace", workspaceId: opts.workspaceId }
    : { kind: "user", userId }
  const set = await resolveScope(scope, { fresh: opts?.fresh })
  return requests.map((request) => checkEntitlement(set, request.op, request.ctx))
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
