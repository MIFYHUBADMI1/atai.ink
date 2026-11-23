import { billingResourceHoldsCol, billingResourceLocksCol, projectsCol } from "@/lib/db/collections"
import type { BillingResourceHoldDoc } from "@/lib/types/db"
import type { MirrorProject } from "@/lib/types/project"
import { logger } from "@/lib/logging/logger"

export interface HoldSweepAction {
  holdId: string
  kind: BillingResourceHoldDoc["kind"]
  resourceId: string
  action: "expired" | "orphaned" | "realized"
  applied: boolean
}

export interface HoldSweepReport {
  now: number
  dryRun: boolean
  scanned: number
  expiredLocks: number
  expiredHolds: number
  orphanedHolds: number
  realizedHolds: number
  remainingActiveHolds: number
  actions: HoldSweepAction[]
}

function hasCustomDomain(project: MirrorProject): boolean {
  if (project.deployment?.customDomain) return true
  return (project.deploymentHistory ?? []).some((entry) => Boolean(entry.customDomain))
}

function hasSubdomain(project: MirrorProject): boolean {
  return (
    project.deployment?.status === "success" ||
    Boolean(project.deployment?.productionUrl) ||
    project.state === "deployed"
  )
}

function holdOutcome(hold: BillingResourceHoldDoc, project: MirrorProject | undefined): HoldSweepAction["action"] | null {
  if (!project) return "orphaned"
  if (hold.kind === "customDomain" && hasCustomDomain(project)) return "realized"
  if (hold.kind === "subdomain" && hasSubdomain(project)) return "realized"
  return null
}

/**
 * Remove expired reservations and release holds whose resource is already
 * persisted or whose project no longer exists. A storage hold with a live
 * project is left alone: it is the only record that keeps those bytes counted
 * until the asset row lands or the hold expires.
 */
export async function sweepResourceHolds(opts: {
  now?: number
  apply?: boolean
  limit?: number
} = {}): Promise<HoldSweepReport> {
  const now = opts.now ?? Date.now()
  const apply = opts.apply !== false
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5_000)
  const holds = await billingResourceHoldsCol()
  const locks = await billingResourceLocksCol()

  const expiredLocks = apply
    ? (await locks.deleteMany({ expiresAt: { $lte: now } })).deletedCount
    : await locks.countDocuments({ expiresAt: { $lte: now } })

  const rows = await holds.find({}, { limit }).toArray()
  const projectIds = [...new Set(rows.map((hold) => hold.resourceId))]
  const projects = projectIds.length
    ? await (await projectsCol()).find({ id: { $in: projectIds } }).toArray()
    : []
  const byId = new Map(projects.map((project) => [project.id, project as unknown as MirrorProject]))

  const actions: HoldSweepAction[] = []
  for (const hold of rows) {
    const action = hold.expiresAt <= now ? "expired" : holdOutcome(hold, byId.get(hold.resourceId))
    if (!action) continue
    if (apply) await holds.deleteOne({ _id: hold._id })
    actions.push({
      holdId: hold._id,
      kind: hold.kind,
      resourceId: hold.resourceId,
      action,
      applied: apply,
    })
  }

  const acted = new Set(actions.map((action) => action.holdId))
  const report: HoldSweepReport = {
    now,
    dryRun: !apply,
    scanned: rows.length,
    expiredLocks,
    expiredHolds: actions.filter((action) => action.action === "expired").length,
    orphanedHolds: actions.filter((action) => action.action === "orphaned").length,
    realizedHolds: actions.filter((action) => action.action === "realized").length,
    remainingActiveHolds: apply
      ? await holds.countDocuments({ expiresAt: { $gt: now } })
      : rows.filter((hold) => hold.expiresAt > now && !acted.has(hold._id)).length,
    actions: actions.slice(0, 100),
  }

  logger.info("billing.resource-holds.sweep", apply ? "completed" : "dry-run", {
    scanned: report.scanned,
    expiredLocks: report.expiredLocks,
    expiredHolds: report.expiredHolds,
    orphanedHolds: report.orphanedHolds,
    realizedHolds: report.realizedHolds,
    remainingActiveHolds: report.remainingActiveHolds,
  })

  return report
}
