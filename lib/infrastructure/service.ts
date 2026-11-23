import "server-only"
import { cryptoId } from "@/lib/store/store"
import { projectsCol, ensureIndexes } from "@/lib/db/collections"
import {
  getInfrastructurePlan,
  getInfrastructurePlanWithRuntimePrice,
  type InfrastructurePlan,
  type InfrastructurePlanId,
} from "@/lib/infrastructure/plans"
import { setProjectCreditLimits } from "@/lib/integrations/totalum/service"
import { consumeCredits } from "@/lib/billing/credit-service"
import { logger } from "@/lib/logging/logger"
import type {
  InfrastructurePurchasedTerms,
  InfrastructureSubscription,
  MirrorProject,
} from "@/lib/types/project"

/**
 * Infrastructure plan lifecycle service.
 *
 * Infrastructure plans are fixed-duration, credit-funded entitlements:
 *  - a purchase/renewal charges Atai Credits through the existing ledger;
 *  - the purchased terms and paid-through timestamp are stored on the project;
 *  - a daily sweep downgrades an expired paid plan to the free Testing cap;
 *  - there is no automatic recurring provider billing, so `autoRenew` is false.
 */

export const INFRASTRUCTURE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000
export const INFRASTRUCTURE_LOCK_TTL_MS = 5 * 60 * 1000

const DEFAULT_PLAN: InfrastructurePlanId = "testing"
const DEFAULT_STORAGE_LIMIT_BYTES = getInfrastructurePlan(DEFAULT_PLAN)?.storageBytes ?? 50 * 1024 * 1024

function snapshotPlan(plan: InfrastructurePlan, now: number): InfrastructurePurchasedTerms {
  return {
    planId: plan.id,
    planName: plan.name,
    storageLimitBytes: plan.storageBytes,
    totalumInfrastructureCreditLimit: plan.totalumInfrastructureCredits,
    priceCredits: plan.AtaiPrice,
    purchasedAt: now,
    durationMs: INFRASTRUCTURE_PERIOD_MS,
  }
}

function hasValidExpiry(infrastructure: InfrastructureSubscription | null | undefined): boolean {
  return typeof infrastructure?.expiresAt === "number" && Number.isFinite(infrastructure.expiresAt)
}

/**
 * A historical record is unresolved when it has no trustworthy paid-through
 * date, no known plan, or an explicit review marker. It is never auto-expired
 * and never repriced from today's catalog.
 */
export function infrastructureNeedsReview(
  infrastructure: InfrastructureSubscription | null | undefined,
): boolean {
  if (!infrastructure) return false
  if (infrastructure.needsReview || infrastructure.status === "needs_review") return true
  if (infrastructure.planId === "enterprise") return true
  if (!getInfrastructurePlan(infrastructure.planId)) return true
  return !hasValidExpiry(infrastructure)
}

async function acquireInfrastructureLock(
  projectId: string,
  token: string,
  now: number,
): Promise<boolean> {
  const col = await projectsCol()
  const result = await col.updateOne(
    {
      id: projectId,
      $or: [
        { "infrastructure.lifecycleLock": { $exists: false } },
        { "infrastructure.lifecycleLock": null },
        { "infrastructure.lifecycleLock.acquiredAt": { $lt: now - INFRASTRUCTURE_LOCK_TTL_MS } },
      ],
    },
    {
      $set: {
        "infrastructure.lifecycleLock": { token, acquiredAt: now },
        updatedAt: now,
      },
    },
  )
  return result.modifiedCount > 0
}

async function releaseInfrastructureLock(projectId: string, token: string): Promise<void> {
  const col = await projectsCol()
  await col.updateOne(
    { id: projectId, "infrastructure.lifecycleLock.token": token },
    { $unset: { "infrastructure.lifecycleLock": "" } },
  )
}

/**
 * Initialize the infrastructure subscription for a new project.
 * Never overwrites an existing paid entitlement.
 */
export async function initializeProjectInfrastructure(
  projectId: string,
  totalumProjectId: string,
): Promise<void> {
  const plan = getInfrastructurePlan(DEFAULT_PLAN)
  if (!plan) throw new Error("Default infrastructure plan not found")

  const col = await projectsCol()
  const existing = (await col.findOne({ id: projectId })) as MirrorProject | null
  if (existing?.infrastructure && existing.infrastructure.planId !== DEFAULT_PLAN) {
    logger.info("infrastructure.init", "existing paid infrastructure preserved", {
      projectId,
      planId: existing.infrastructure.planId,
    })
    return
  }

  const now = Date.now()
  const subscription: InfrastructureSubscription = {
    planId: plan.id,
    planName: plan.name,
    storageLimitBytes: plan.storageBytes,
    totalumInfrastructureCreditLimit: plan.totalumInfrastructureCredits,
    status: "active",
    startedAt: now,
    expiresAt: now + INFRASTRUCTURE_PERIOD_MS,
    autoRenew: false,
    purchasedTerms: snapshotPlan(plan, now),
    lastPurchaseKey: existing?.infrastructure?.lastPurchaseKey,
    appliedPurchaseKeys: existing?.infrastructure?.appliedPurchaseKeys,
    totalumCreditsUsed: 0,
    storageUsedBytes: 0,
    overQuota: false,
    syncStatus: "synced",
  }

  await col.updateOne(
    { id: projectId },
    { $set: { infrastructure: subscription, updatedAt: now } },
  )

  logger.info("infrastructure.init", "project infrastructure initialized", {
    projectId,
    totalumProjectId,
    planId: plan.id,
    totalumCap: plan.totalumInfrastructureCredits,
  })
}

/**
 * Apply an infrastructure cap to a Totalum project.
 * Used during initial creation, plan changes, renewal and expiration.
 */
export async function applyTotalumCap(
  totalumProjectId: string,
  infrastructureCreditLimit: number,
): Promise<void> {
  try {
    await setProjectCreditLimits(totalumProjectId, {
      maxInfrastructureCreditsPerMonth: infrastructureCreditLimit,
    })
    logger.info("infrastructure.cap", "Totalum cap applied", {
      totalumProjectId,
      cap: infrastructureCreditLimit,
    })
  } catch (e) {
    logger.error("infrastructure.cap", "failed to apply Totalum cap", {
      totalumProjectId,
      cap: infrastructureCreditLimit,
      error: (e as Error).message,
    })
    throw e
  }
}

export interface ActivatePlanOptions {
  /** Explicit renewal of the same plan: extend from the current paid-through date. */
  renewal?: boolean
}

/**
 * Activate, upgrade, or renew an infrastructure plan.
 *
 * Idempotent per purchase key: a retry after a successful charge reuses the
 * existing ledger entry and never extends the period twice. A short lifecycle
 * lock serializes this with the expiration worker.
 */
export async function activatePlan(
  projectId: string,
  userId: string,
  planId: InfrastructurePlanId,
  intentKey?: string,
  options: ActivatePlanOptions = {},
): Promise<{ success: boolean; message: string }> {
  await ensureIndexes()

  const plan = await getInfrastructurePlanWithRuntimePrice(planId)
  if (!plan) return { success: false, message: "Invalid plan." }
  if (plan.id === "enterprise") {
    return { success: false, message: "Enterprise plans require manual setup. Please contact support." }
  }

  const col = await projectsCol()
  const project = (await col.findOne({ id: projectId })) as MirrorProject | null
  if (!project) return { success: false, message: "Project not found." }
  if (project.userId !== userId) return { success: false, message: "Unauthorized." }
  if (!project.totalumProjectId) {
    return { success: false, message: "Project must be built before upgrading infrastructure." }
  }

  const now = Date.now()
  const purchaseKey = intentKey
    ? `infra_${intentKey}`
    : `infra_${projectId}_${plan.id}_${options.renewal ? "renew" : "purchase"}_${Math.floor(now / 60_000)}`
  const lockToken = `infra_lock_${cryptoId()}`
  const lockAcquired = project.infrastructure
    ? await acquireInfrastructureLock(projectId, lockToken, now)
    : true
  if (!lockAcquired) {
    return { success: false, message: "An infrastructure update is already in progress. Try again shortly." }
  }

  try {
    const currentProject = (await col.findOne({ id: projectId })) as MirrorProject | null
    if (!currentProject || currentProject.userId !== userId) {
      return { success: false, message: "Project not found." }
    }
    if (!currentProject.totalumProjectId) {
      return { success: false, message: "Project must be built before upgrading infrastructure." }
    }
    const current = currentProject.infrastructure
    const currentExpiry = hasValidExpiry(current) ? current!.expiresAt : undefined
    const currentActive =
      current?.status === "active" || current?.status === "past_due" || current?.status === "cancelled"
    const samePlan = current?.planId === plan.id
    const alreadyApplied =
      current !== undefined &&
      (current.lastPurchaseKey === purchaseKey ||
        (current.appliedPurchaseKeys ?? []).includes(purchaseKey))

    if (alreadyApplied && current) {
      // Only the most recent key owns the provider retry. A replay must not
      // restore the paid cap after expiration has marked the record expired;
      // the sweep owns that transition and its retry.
      if (
        current.lastPurchaseKey === purchaseKey &&
        current.status !== "expired" &&
        current.syncStatus !== "synced" &&
        currentProject.totalumProjectId
      ) {
        try {
          await applyTotalumCap(currentProject.totalumProjectId, current.totalumInfrastructureCreditLimit)
          await col.updateOne(
            { id: projectId, "infrastructure.lastPurchaseKey": purchaseKey },
            { $set: { "infrastructure.syncStatus": "synced", updatedAt: now } },
          )
        } catch (e) {
          await col.updateOne(
            { id: projectId, "infrastructure.lastPurchaseKey": purchaseKey },
            { $set: { "infrastructure.syncStatus": "failed", updatedAt: now } },
          )
          logger.error("infrastructure.activate", "cap retry failed for applied purchase", {
            projectId,
            error: (e as Error).message,
          })
        }
      }
      return {
        success: true,
        message:
          current?.planId === plan.id
            ? `${plan.name} plan is already active.`
            : "This purchase has already been applied.",
      }
    }

    if (samePlan && currentActive && !options.renewal && (currentExpiry === undefined || currentExpiry > now)) {
      return { success: false, message: `You are already on the ${plan.name} plan.` }
    }

    const renewalApplied =
      options.renewal === true && samePlan && currentActive && currentExpiry !== undefined
    const periodStart = renewalApplied ? Math.max(now, currentExpiry!) : now
    const periodEnd = periodStart + INFRASTRUCTURE_PERIOD_MS
    const startedAt = renewalApplied ? current!.startedAt ?? now : now
    const renewalCount = renewalApplied ? (current!.renewalCount ?? 0) + 1 : 0

    if (plan.isPaid && plan.AtaiPrice > 0) {
      // The ledger's idempotent consume is the authority. A pre-check against
      // the current balance would wrongly refuse a retry whose original charge
      // already succeeded but whose project write was interrupted.
      const consumeResult = await consumeCredits({
        userId,
        amount: plan.AtaiPrice,
        transactionType: "infrastructure_purchase",
        idempotencyKey: purchaseKey,
        projectId,
        metadata: {
          reason: `Infrastructure plan: ${plan.name} — ${plan.storageLabel}`,
          projectId,
          planId: plan.id,
          renewal: renewalApplied,
          periodStart,
          periodEnd,
        },
      })

      if (!consumeResult.success) {
        return {
          success: false,
          message: `Insufficient credits. You need ${plan.AtaiPrice.toLocaleString()} credits for the ${plan.name} plan.`,
        }
      }
    }

    const appliedPurchaseKeys = [
      ...(current?.appliedPurchaseKeys ?? []),
      ...(current?.lastPurchaseKey ? [current.lastPurchaseKey] : []),
      purchaseKey,
    ].filter((key, index, keys) => keys.indexOf(key) === index).slice(-20)

    const subscription: InfrastructureSubscription = {
      planId: plan.id,
      planName: plan.name,
      storageLimitBytes: plan.storageBytes,
      totalumInfrastructureCreditLimit: plan.totalumInfrastructureCredits,
      status: "active",
      startedAt,
      expiresAt: periodEnd,
      autoRenew: false,
      purchasedTerms: snapshotPlan(plan, now),
      renewedAt: renewalApplied ? now : current?.renewedAt,
      renewalCount,
      expiredAt: undefined,
      cancelledAt: undefined,
      needsReview: false,
      reviewReason: undefined,
      lastPurchaseKey: purchaseKey,
      appliedPurchaseKeys,
      totalumCreditsUsed: 0,
      storageUsedBytes: current?.storageUsedBytes ?? 0,
      overQuota: (current?.storageUsedBytes ?? 0) > plan.storageBytes,
      syncStatus: "pending",
      ...(project.infrastructure ? { lifecycleLock: { token: lockToken, acquiredAt: now } } : {}),
    }

    const updated = await col.updateOne(
      project.infrastructure
        ? { id: projectId, "infrastructure.lifecycleLock.token": lockToken }
        : { id: projectId },
      { $set: { infrastructure: subscription, updatedAt: now } },
    )
    if (updated.matchedCount === 0) {
      throw new Error("Infrastructure lifecycle lock was lost before the plan was applied")
    }

    try {
      await applyTotalumCap(currentProject.totalumProjectId, plan.totalumInfrastructureCredits)
      await col.updateOne(
        { id: projectId, "infrastructure.lastPurchaseKey": purchaseKey },
        { $set: { "infrastructure.syncStatus": "synced", updatedAt: now } },
      )
    } catch (e) {
      await col.updateOne(
        { id: projectId, "infrastructure.lastPurchaseKey": purchaseKey },
        { $set: { "infrastructure.syncStatus": "failed", updatedAt: now } },
      )
      logger.error("infrastructure.activate", "Totalum cap update failed after payment", {
        projectId,
        totalumProjectId: currentProject.totalumProjectId,
        error: (e as Error).message,
      })
    }

    logger.info("infrastructure.activate", "plan activated", {
      projectId,
      planId: plan.id,
      price: plan.AtaiPrice,
      renewal: renewalApplied,
      expiresAt: periodEnd,
      totalumCap: plan.totalumInfrastructureCredits,
    })

    return {
      success: true,
      message: renewalApplied
        ? `${plan.name} plan renewed through ${new Date(periodEnd).toISOString().slice(0, 10)}.`
        : `${plan.name} plan activated successfully.`,
    }
  } finally {
    if (lockAcquired) await releaseInfrastructureLock(projectId, lockToken)
  }
}

/**
 * Cancel future renewal. Paid-through access remains until `expiresAt`.
 * Infrastructure has no automatic recurring billing today, so this is a
 * lifecycle marker, not a provider subscription cancellation.
 */
export async function cancelInfrastructurePlan(
  projectId: string,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  const col = await projectsCol()
  const project = (await col.findOne({ id: projectId })) as MirrorProject | null
  if (!project) return { success: false, message: "Project not found." }
  if (project.userId !== userId) return { success: false, message: "Unauthorized." }
  if (!project.infrastructure) return { success: false, message: "No infrastructure plan is active." }

  const now = Date.now()
  const lockToken = `infra_cancel_${cryptoId()}`
  if (!(await acquireInfrastructureLock(projectId, lockToken, now))) {
    return { success: false, message: "An infrastructure update is already in progress. Try again shortly." }
  }

  try {
    const currentProject = (await col.findOne({ id: projectId })) as MirrorProject | null
    const current = currentProject?.infrastructure
    if (!current) return { success: false, message: "No infrastructure plan is active." }
    if (current.planId === "testing") {
      return { success: true, message: "The free Testing plan does not require cancellation." }
    }
    if (current.status === "cancelled") {
      return { success: true, message: "Infrastructure renewal is already cancelled." }
    }

    await col.updateOne(
      { id: projectId, "infrastructure.lifecycleLock.token": lockToken },
      {
        $set: {
          "infrastructure.status": "cancelled",
          "infrastructure.cancelledAt": now,
          "infrastructure.autoRenew": false,
          updatedAt: now,
        },
      },
    )
    const through = hasValidExpiry(current)
      ? new Date(current.expiresAt).toISOString().slice(0, 10)
      : "the end of the recorded period"
    return {
      success: true,
      message: `Renewal cancelled. Your ${current.planName} access remains active through ${through}.`,
    }
  } finally {
    await releaseInfrastructureLock(projectId, lockToken)
  }
}

export type InfrastructureExpirationOutcome =
  | "expired"
  | "not_found"
  | "no_subscription"
  | "not_due"
  | "needs_review"
  | "testing"
  | "locked"
  | "cap_failed"
  | "skipped"

export interface InfrastructureExpirationResult {
  projectId: string
  outcome: InfrastructureExpirationOutcome
  planId?: string
  previousPlanId?: string
  paidThroughAt?: number
  error?: string
}

/**
 * Expire one project's paid infrastructure after its paid-through timestamp.
 *
 * The lifecycle lock serializes this with activation/renewal. The paid plan is
 * marked expired before the provider cap is changed; if the cap update fails,
 * the record remains `expired` + `syncStatus: "failed"` and the sweep retries.
 * The app-level access policy already denies paid operations while that
 * provider sync is pending, so a failed cap update cannot leave a paid plan
 * silently usable.
 *
 * Historical records with no trustworthy terms are marked for review and left
 * active. No customer data or deployed application is deleted.
 */
export async function handleExpiration(
  projectId: string,
  now: number = Date.now(),
): Promise<InfrastructureExpirationResult> {
  const col = await projectsCol()
  const project = (await col.findOne({ id: projectId })) as MirrorProject | null
  if (!project) return { projectId, outcome: "not_found" }
  if (!project.infrastructure) return { projectId, outcome: "no_subscription" }

  const current = project.infrastructure
  if (current.planId === "testing") return { projectId, outcome: "testing", planId: current.planId }

  const lockToken = `infra_expire_${cryptoId()}`
  if (!(await acquireInfrastructureLock(projectId, lockToken, now))) {
    return { projectId, outcome: "locked", planId: current.planId }
  }

  try {
    const currentProject = (await col.findOne({ id: projectId })) as MirrorProject | null
    const latest = currentProject?.infrastructure
    if (!latest) return { projectId, outcome: "no_subscription" }
    if (latest.planId === "testing") {
      return { projectId, outcome: "testing", planId: latest.planId }
    }

    if (infrastructureNeedsReview(latest)) {
      const reason = !hasValidExpiry(latest)
        ? "missing paid-through date"
        : "unknown or manually managed infrastructure terms"
      await col.updateOne(
        { id: projectId, "infrastructure.lifecycleLock.token": lockToken },
        {
          $set: {
            "infrastructure.needsReview": true,
            "infrastructure.reviewReason": reason,
            "infrastructure.status": latest.status === "expired" ? "expired" : "needs_review",
            updatedAt: now,
          },
        },
      )
      logger.warn("infrastructure.expiration", "historical infrastructure left active for review", {
        projectId,
        planId: latest.planId,
        reason,
      })
      return {
        projectId,
        outcome: "needs_review",
        planId: latest.planId,
        paidThroughAt: latest.expiresAt,
      }
    }

    if (latest.status !== "expired" && latest.expiresAt > now) {
      return {
        projectId,
        outcome: "not_due",
        planId: latest.planId,
        paidThroughAt: latest.expiresAt,
      }
    }

    const marked = await col.updateOne(
      {
        id: projectId,
        "infrastructure.lifecycleLock.token": lockToken,
        "infrastructure.planId": latest.planId,
        ...(latest.status === "expired" ? {} : { "infrastructure.expiresAt": { $lte: now } }),
      },
      {
        $set: {
          "infrastructure.status": "expired",
          "infrastructure.expiredAt": latest.expiredAt ?? now,
          "infrastructure.syncStatus": "pending",
          updatedAt: now,
        },
      },
    )
    if (marked.matchedCount === 0) {
      return { projectId, outcome: "skipped", planId: latest.planId, paidThroughAt: latest.expiresAt }
    }

    const testingPlan = getInfrastructurePlan(DEFAULT_PLAN)
    if (!testingPlan) throw new Error("Testing infrastructure plan not found")

    if (currentProject?.totalumProjectId) {
      try {
        await applyTotalumCap(currentProject.totalumProjectId, testingPlan.totalumInfrastructureCredits)
      } catch (e) {
        await col.updateOne(
          { id: projectId, "infrastructure.lifecycleLock.token": lockToken },
          { $set: { "infrastructure.syncStatus": "failed", updatedAt: now } },
        )
        logger.error("infrastructure.expiration", "failed to downgrade Totalum cap; will retry", {
          projectId,
          error: (e as Error).message,
        })
        return {
          projectId,
          outcome: "cap_failed",
          planId: latest.planId,
          previousPlanId: latest.planId,
          paidThroughAt: latest.expiresAt,
          error: (e as Error).message,
        }
      }
    }

    const downgraded: InfrastructureSubscription = {
      planId: testingPlan.id,
      planName: testingPlan.name,
      storageLimitBytes: testingPlan.storageBytes,
      totalumInfrastructureCreditLimit: testingPlan.totalumInfrastructureCredits,
      status: "active",
      startedAt: now,
      expiresAt: now + INFRASTRUCTURE_PERIOD_MS,
      autoRenew: false,
      purchasedTerms: snapshotPlan(testingPlan, now),
      renewedAt: undefined,
      renewalCount: 0,
      expiredAt: now,
      cancelledAt: undefined,
      needsReview: false,
      reviewReason: undefined,
      lastPurchaseKey: latest.lastPurchaseKey,
      appliedPurchaseKeys: latest.appliedPurchaseKeys,
      totalumCreditsUsed: 0,
      storageUsedBytes: latest.storageUsedBytes ?? 0,
      overQuota: (latest.storageUsedBytes ?? 0) > testingPlan.storageBytes,
      syncStatus: "synced",
      lifecycleLock: { token: lockToken, acquiredAt: now },
    }

    const updated = await col.updateOne(
      { id: projectId, "infrastructure.lifecycleLock.token": lockToken, "infrastructure.status": "expired" },
      { $set: { infrastructure: downgraded, updatedAt: now } },
    )
    if (updated.matchedCount === 0) {
      logger.error("infrastructure.expiration", "downgrade state update lost its lifecycle lock", {
        projectId,
      })
      return { projectId, outcome: "skipped", planId: latest.planId, paidThroughAt: latest.expiresAt }
    }

    logger.info("infrastructure.expiration", "downgraded to testing", {
      projectId,
      previousPlan: latest.planId,
      previousPlanName: latest.planName,
      paidThroughAt: latest.expiresAt,
      totalumCap: testingPlan.totalumInfrastructureCredits,
    })

    return {
      projectId,
      outcome: "expired",
      planId: testingPlan.id,
      previousPlanId: latest.planId,
      paidThroughAt: latest.expiresAt,
    }
  } catch (e) {
    logger.error("infrastructure.expiration", "expiration failed", {
      projectId,
      error: (e as Error).message,
    })
    return {
      projectId,
      outcome: "cap_failed",
      planId: current.planId,
      paidThroughAt: current.expiresAt,
      error: (e as Error).message,
    }
  } finally {
    await releaseInfrastructureLock(projectId, lockToken)
  }
}

export interface InfrastructureSweepReport {
  scanned: number
  expired: number
  needsReview: number
  skipped: number
  locked: number
  failed: number
  errors: Array<{ projectId: string; error: string }>
}

/**
 * Daily infrastructure lifecycle sweep. Durable and repeatable: the query
 * selects paid records at/past their paid-through date plus expired records
 * whose provider cap still needs syncing. Each record is handled under a
 * short-lived lock, so an interrupted worker is retried after the lock TTL.
 */
export async function runInfrastructureLifecycleSweep(
  now: number = Date.now(),
): Promise<InfrastructureSweepReport> {
  const col = await projectsCol()
  const report: InfrastructureSweepReport = {
    scanned: 0,
    expired: 0,
    needsReview: 0,
    skipped: 0,
    locked: 0,
    failed: 0,
    errors: [],
  }

  const rows = await col
    .find({
      "infrastructure.planId": { $exists: true, $nin: ["testing", "enterprise"] },
      $or: [
        {
          "infrastructure.status": { $in: ["active", "past_due", "cancelled"] },
          "infrastructure.expiresAt": { $lte: now },
        },
        {
          "infrastructure.status": "expired",
        },
        {
          "infrastructure.status": { $in: ["active", "past_due", "cancelled"] },
          "infrastructure.expiresAt": { $exists: false },
        },
      ],
    })
    .sort({ "infrastructure.expiresAt": 1 })
    .limit(100)
    .toArray()

  report.scanned = rows.length
  for (const row of rows) {
    const result = await handleExpiration(row.id, now)
    if (result.outcome === "expired") report.expired++
    else if (result.outcome === "needs_review") report.needsReview++
    else if (result.outcome === "locked") report.locked++
    else if (result.outcome === "cap_failed") {
      report.failed++
      report.errors.push({ projectId: row.id, error: result.error ?? "cap update failed" })
    } else report.skipped++
  }

  return report
}

/** Get the infrastructure subscription for a project. The lifecycle lock is
 * internal coordination state and is never returned to callers. */
export async function getProjectInfrastructure(projectId: string): Promise<InfrastructureSubscription | null> {
  const col = await projectsCol()
  const project = (await col.findOne({ id: projectId })) as MirrorProject | null
  if (!project?.infrastructure) return null
  const { lifecycleLock: _lifecycleLock, ...subscription } = project.infrastructure
  return subscription
}

export interface ProjectStorageUsage {
  usedBytes: number
  limitBytes: number | null
  withinLimit: boolean
}

/**
 * Compute real project storage from the records that hold bytes. The old
 * `storageUsedBytes` counter was never advanced by uploads, so it cannot be
 * trusted as the source of truth.
 */
export async function getProjectStorageUsage(projectId: string): Promise<ProjectStorageUsage> {
  const db = await import("@/lib/db/collections")
  const [assets, attachments, infra] = await Promise.all([
    (await db.projectAssetsCol()).find({ projectId }, { projection: { size: 1 } }).toArray(),
    (await db.projectAttachmentsCol()).find({ projectId }, { projection: { size: 1 } }).toArray(),
    getProjectInfrastructure(projectId),
  ])
  const sum = (rows: Array<{ size?: unknown }>) =>
    rows.reduce((total, row) => total + (typeof row.size === "number" && Number.isFinite(row.size) ? row.size : 0), 0)
  const usedBytes = sum(assets) + sum(attachments)
  // An uninitialized project still gets the free Testing allowance. Leaving it
  // unlimited would let uploads bypass the quota before the first build.
  const limitBytes = infra
    ? Number.isFinite(infra.storageLimitBytes) && infra.storageLimitBytes > 0
      ? infra.storageLimitBytes
      : null
    : DEFAULT_STORAGE_LIMIT_BYTES
  return {
    usedBytes,
    limitBytes,
    withinLimit: limitBytes === null || usedBytes <= limitBytes,
  }
}

/** Persist the observed usage so the infrastructure UI and admin stats agree. */
export async function refreshProjectStorageUsage(projectId: string): Promise<ProjectStorageUsage> {
  const usage = await getProjectStorageUsage(projectId)
  try {
    const col = await projectsCol()
    await col.updateOne(
      { id: projectId, infrastructure: { $exists: true } },
      {
        $set: {
          "infrastructure.storageUsedBytes": usage.usedBytes,
          "infrastructure.overQuota": !usage.withinLimit,
        },
      },
    )
  } catch {
    // Usage display is advisory; the upload decision already happened.
  }
  return usage
}

/** Check if a project has exceeded its storage limit. */
export async function checkStorageLimit(projectId: string): Promise<{ withinLimit: boolean; used: number; limit: number }> {
  const usage = await getProjectStorageUsage(projectId)
  return {
    withinLimit: usage.withinLimit,
    used: usage.usedBytes,
    limit: usage.limitBytes ?? Infinity,
  }
}
