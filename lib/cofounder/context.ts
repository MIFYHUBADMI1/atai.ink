import "server-only"
import { store } from "@/lib/store/store"
import { getAvailableCredits, getBalance } from "@/lib/billing/credit-service"
import { computePlanHealth, PLAN_SECTIONS, isPlaceholderValue } from "@/lib/analysis/plan-sections"
import { buildPlanBrief } from "@/lib/analysis/cofounder"
import { planIsLocked } from "@/lib/types/project"
import { businessStartingPointOf } from "@/lib/types/business-intake"
import { objectiveLabel } from "@/lib/existing-business/objectives"
import { listProjectDomains } from "@/lib/domain/service"
import { CONNECTION_STATUS_LABEL, businessConnectionStatus } from "@/lib/connected-business/status"
import type {
  CofounderBuildSummary,
  CofounderCreditCosts,
  CofounderEventSummary,
  CofounderExistingBusinessBrief,
  CofounderProjectSummary,
  ToolContext,
} from "./types"

/**
 * Compact context builders (spec sections 29, 77–78).
 *
 * Never ships a full MirrorProject to the model. Every builder returns a
 * small, purpose-built summary composed from the same underlying stores the
 * rest of Atai reads.
 */

export function summarizeProject(p: {
  id: string
  name: string
  mode: string
  state: string
  idea?: string
  sourceUrl?: string
  updatedAt: number
}): CofounderProjectSummary {
  return {
    id: p.id,
    name: p.name,
    mode: (p.mode as CofounderProjectSummary["mode"]) ?? "scratch",
    state: p.state,
    ...(p.idea ? { idea: p.idea.slice(0, 200) } : {}),
    ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
    updatedAt: p.updatedAt,
  }
}

export function summarizeEvents(events: ProjectEventInput[] | undefined, limit = 8): CofounderEventSummary[] {
  if (!events?.length) return []
  return events
    .slice(-limit)
    .reverse()
    .map((e) => ({ id: e.id, at: e.at, level: e.level, stage: e.stage, message: e.message.slice(0, 160) }))
}

type ProjectEventInput = { id: string; at: number; level: string; stage: string; message: string }

/** Build the tool execution context from the authenticated user (never from
 * model output) plus validated request metadata. */
export async function buildToolContext(
  user: { id: string; name: string; email: string; emailVerified: boolean },
  meta: { activeProjectId?: string; currentRoute?: string; currentSurface?: string; conversationId?: string; pendingActionId?: string } = {},
): Promise<ToolContext> {
  let available = 0
  let balance = 0
  try {
    const b = await getBalance(user.id)
    available = b.total
    balance = b.total
  } catch {
    // Credits unavailable → zeros; read tools still work.
  }
  return {
    user,
    credits: { available, balance, reserved: 0 },
    ...(meta.activeProjectId ? { activeProjectId: meta.activeProjectId } : {}),
    ...(meta.currentRoute ? { currentRoute: meta.currentRoute } : {}),
    ...(meta.currentSurface ? { currentSurface: meta.currentSurface } : {}),
    ...(meta.conversationId ? { conversationId: meta.conversationId } : {}),
    ...(meta.pendingActionId ? { pendingActionId: meta.pendingActionId } : {}),
  }
}

export async function buildWorkspaceOverview(userId: string): Promise<{
  creditsAvailable: number
  projects: CofounderProjectSummary[]
  suggestedActiveProject?: CofounderProjectSummary
}> {
  const [projects, credits] = await Promise.all([
    store.listProjects(userId, 20),
    getAvailableCredits(userId),
  ])
  const summarized = projects.map((p) => summarizeProject(p))
  const suggested = [...summarized]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((p) => p.state !== "deployed")
  return {
    creditsAvailable: credits,
    projects: summarized,
    ...(suggested ? { suggestedActiveProject: suggested } : {}),
  }
}

/** Bounded existing-business digest for the prompt block. Reads the same
 * intake record the profile page shows; domain truth comes from the domain
 * records (the intake projection is only written at registration). */
async function buildExistingBusinessBrief(
  project: {
    id: string
    startingPoint?: string
    intake?: import("@/lib/types/business-intake").BusinessIntake
    connection?: import("@/lib/types/business-intake").BusinessConnection
  },
  options: { includeAssessment?: boolean } = {},
): Promise<CofounderExistingBusinessBrief> {
  const intake = project.intake
  const domains = await listProjectDomains(project.id).catch(() => [])
  const result = intake?.assessment?.result
  const domainVerified = domains.some((d) => d.status === "verified" && !d.releasedAt)
  const connectionStatus = businessConnectionStatus({ connection: project.connection, domainVerified })
  const websiteError =
    intake?.website &&
    (intake.website.status === "failed" || intake.website.status === "partially_completed") &&
    intake.website.errorMessage
      ? intake.website.errorMessage.slice(0, 160)
      : undefined
  return {
    ...(intake?.displayName ? { displayName: intake.displayName } : {}),
    ...(intake?.description ? { description: intake.description.slice(0, 500) } : {}),
    ...(intake?.targetCustomers ? { targetCustomers: intake.targetCustomers.slice(0, 300) } : {}),
    objectives: (intake?.objectives ?? []).map((id) => objectiveLabel(id)),
    website: {
      submitted: Boolean(intake?.website?.url),
      analyzed: intake?.website?.status === "completed",
      ...(intake?.website?.url ? { url: intake.website.url } : {}),
      status: intake?.website?.status ?? "skipped",
      ...(websiteError ? { error: websiteError } : {}),
    },
    connection: {
      status: connectionStatus,
      label: CONNECTION_STATUS_LABEL[connectionStatus],
      ...(project.connection?.lastSeenAt ? { lastSeenAt: project.connection.lastSeenAt } : {}),
    },
    domainVerified,
    assessment:
      options.includeAssessment === false
        ? {
            status: "excluded by the founder's context settings",
            priorities: [],
            openQuestions: [],
          }
        : {
            status: intake?.assessment?.status ?? "pending",
            ...(result?.understanding ? { understanding: result.understanding.slice(0, 700) } : {}),
            ...(result?.currentPosition ? { currentPosition: result.currentPosition.slice(0, 700) } : {}),
            priorities: (result?.priorities ?? []).slice(0, 6).map((p) => ({
              title: p.title,
              priority: p.priority,
              ...(p.route ? { route: p.route } : {}),
            })),
            openQuestions: (result?.openQuestions ?? []).slice(0, 5),
          },
  }
}

/** Compact active-project brief for the system prompt block. */
export async function buildActiveProjectBrief(
  projectId: string,
  userId: string,
  options: {
    operate?: boolean
    includePlanBrief?: boolean
    includeAnalytics?: boolean
    includeBusinessAssessment?: boolean
  } = {},
): Promise<{
  id: string
  name: string
  mode: string
  state: string
  idea?: string
  planHealthPercent?: number
  /** One line per plan section — the content the application was built from,
   * so co-founder suggestions are grounded in the real plan. */
  planBrief?: string
  /** True once the built application exists: the plan is an archive and
   * change requests must flow to the builder, not back into plan sections. */
  hasBuiltApp?: boolean
  buildState?: string
  deployedUrl?: string
  /** Founder's per-project permission for the co-founder to read product
   * analytics (default false). Lets the model know before it calls the tool. */
  analyticsConsentEnabled?: boolean
  /** Present only for businesses that joined with an existing business. */
  existingBusiness?: CofounderExistingBusinessBrief
} | null> {
  const project = await store.getProject(projectId)
  if (!project || project.userId !== userId) return null
  const spec = project.specification
  const existingBusiness =
    businessStartingPointOf(project) === "existing_business"
      ? await buildExistingBusinessBrief(project, {
          includeAssessment: options.includeBusinessAssessment !== false,
        })
      : undefined
  if (options.operate) {
    // A connected business has no plan, build or deployment. Shipping those
    // fields would describe a pipeline that does not exist for it.
    return {
      id: project.id,
      name: project.name,
      mode: project.mode,
      state: project.state,
      ...(existingBusiness ? { existingBusiness } : {}),
    }
  }
  return {
    id: project.id,
    name: project.name,
    mode: project.mode,
    state: project.state,
    ...(project.idea ? { idea: project.idea.slice(0, 300) } : {}),
    ...(options.includePlanBrief === false || !spec
      ? {}
      : { planHealthPercent: computePlanHealth(spec).percent, planBrief: buildPlanBrief(spec) }),
    ...(planIsLocked(project.state) ? { hasBuiltApp: true } : {}),
    ...(project.state === "building" || project.state === "deploying" ? { buildState: project.state } : {}),
    ...(project.deployment?.productionUrl ? { deployedUrl: project.deployment.productionUrl } : {}),
    ...(options.includeAnalytics === false
      ? {}
      : { analyticsConsentEnabled: project.analyticsConsent?.enabled === true }),
    ...(existingBusiness ? { existingBusiness } : {}),
  }
}

/** Build status summary from existing project state (no new query system). */
export function buildStatusFromProject(project: {
  state: string
  totalumProjectId?: string
  developmentUrl?: string
  buildRuns?: Array<{ id: string; status: string; kind: string; startedAt: number; error?: string }>
}): CofounderBuildSummary {
  const last = project.buildRuns?.length ? project.buildRuns[project.buildRuns.length - 1] : undefined
  return {
    state: project.state,
    ...(project.totalumProjectId ? { totalumProjectId: project.totalumProjectId } : {}),
    ...(last
      ? { lastBuildRun: { id: last.id, status: last.status, kind: last.kind, startedAt: last.startedAt, ...(last.error ? { error: last.error } : {}) } }
      : {}),
    ...(project.developmentUrl ? { developmentUrl: project.developmentUrl } : {}),
  }
}

/** Credit cost table for get_credit_costs (spec section 52). Reads the SAME
 * admin-configurable sources every other surface uses. */
export async function buildCreditCosts(): Promise<CofounderCreditCosts> {
  const { getCollaborateCosts, getBuildTierCosts, getDeploymentCosts } = await import("@/lib/billing/runtime-config")
  const [collab, tiers, deploy] = await Promise.all([
    getCollaborateCosts(),
    getBuildTierCosts(),
    getDeploymentCosts(),
  ])
  return {
    chatMessageCost: collab.chatMessageCost,
    planAnalysisCost: collab.planAnalysisCost,
    autoCompleteSectionCost: collab.autoCompleteSectionCost,
    buildTiers: { simple: tiers.simple, medium: tiers.medium, complex: tiers.complex },
    deployCost: deploy.deployCost,
  }
}
