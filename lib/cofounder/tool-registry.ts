import "server-only"
import {
  getWorkspaceOverviewTool,
  listProjectsTool,
} from "./tools/workspace"
import {
  getProjectTool,
  getProjectActivityTool,
  createProjectTool,
  deleteProjectTool,
} from "./tools/projects"
import {
  getPlanTool,
  proposePlanUpdateTool,
  applyPlanUpdateTool,
  analyzePlanTool,
  autoCompletePlanTool,
} from "./tools/plans"
import {
  getBuildStatusTool,
  getBuildLogsTool,
  getBuildConversationTool,
  stopBuildTool,
  requestBuildTool,
  requestFollowupEditTool,
  requestDeployTool,
} from "./tools/applications"
import {
  navigateTool,
  getAccountSummaryTool,
  getCreditCostsTool,
} from "./tools/navigation"
import { getGrowthOverviewTool } from "./tools/growth"
import { getProductAnalyticsTool } from "./tools/analytics"
import { getBusinessAssessmentTool } from "./tools/business"
import { runBusinessSeoAuditTool, runSeoAuditTool } from "./tools/seo"
import {
  generateMarketingCopyTool,
  searchMarketingContentTool,
  refineMarketingContentTool,
} from "./tools/studio"
import { proposeGrowthTaskTool, listGrowthTasksTool } from "./tools/tasks"
import { proposeCampaignTool, listCampaignsTool } from "./tools/campaigns"
import type { ToolDefinition, ToolRisk } from "./types"

/**
 * CLOSED tool registry (spec section 10). This list is the explicit
 * allow-list of everything the Co-founder can ever do. Only registered tools
 * are exposed to the model; an unregistered tool name can never execute —
 * the registry lookup IS the authorization for tool existence.
 *
 * v1 deliberately excludes (spec section 51): runtime API key lifecycle,
 * api_keys, runtime/v1 invocation, Totalum secrets, provider credentials,
 * billing mutations, checkout, top-ups, subscriptions, webhooks, admin APIs,
 * self-credit manipulation, ledger reconciliation, password/session
 * management, email verification, and direct generated-app database writes.
 */

const REGISTRY: readonly ToolDefinition[] = [
  // READ — workspace
  getWorkspaceOverviewTool,
  listProjectsTool,
  getProjectTool,
  getProjectActivityTool,
  getPlanTool,
  analyzePlanTool,
  getBuildStatusTool,
  getBuildLogsTool,
  getBuildConversationTool,
  navigateTool,
  getAccountSummaryTool,
  getCreditCostsTool,
  // READ — growth overview (Phase 2; read-only projection of trusted data)
  getGrowthOverviewTool,
  // READ — product analytics insights (first-party analytics capability; gated
  // by the operator flag AND the founder's per-project consent, default OFF)
  getProductAnalyticsTool,
  // READ — existing-business initial assessment (owner-gated; full founder
  // artifact, never verification tokens)
  getBusinessAssessmentTool,
  // READ — growth task list (Phase 5; read-only projection of the founder's own tasks)
  listGrowthTasksTool,
  // READ — campaign list (Phase 6; read-only projection of the founder's own campaign plans)
  listCampaignsTool,
  // READ — marketing library search (Phase 4 v2; the founder's own drafts only)
  searchMarketingContentTool,
  // LOW_RISK_WRITE
  stopBuildTool,
  // CONFIRM
  proposePlanUpdateTool,
  applyPlanUpdateTool,
  autoCompletePlanTool,
  createProjectTool,
  // CONFIRM — SEO visibility audit (Phase 3; credits + crawl, gated behind a
  // pending action and the SEO_AUDIT flag)
  runSeoAuditTool,
  runBusinessSeoAuditTool,
  // CONFIRM — Marketing Studio copy draft (Phase 4; credits + one-shot AI
  // generation, gated behind a pending action and the STUDIO flag; drafts only,
  // never publishes)
  generateMarketingCopyTool,
  // CONFIRM — AI rewrite of an existing draft (Phase 4 v2; credits + one-shot AI,
  // appends an immutable version; never overwrites and never publishes)
  refineMarketingContentTool,
  // CONFIRM — growth task proposal (Phase 5; FREE AI-proposed task, gated behind
  // a pending action and the GROWTH_TASKS flag; the founder works through tasks
  // manually — nothing here runs on a timer)
  proposeGrowthTaskTool,
  // CONFIRM — campaign plan proposal (Phase 6; FREE AI-proposed plan, gated
  // behind a pending action and the CAMPAIGNS flag; plans/tracks only — nothing
  // is sent, posted, spent, or scheduled)
  proposeCampaignTool,
  // HARD_CONFIRM
  requestBuildTool,
  requestFollowupEditTool,
  requestDeployTool,
  deleteProjectTool,
]

const BY_NAME = new Map(REGISTRY.map((t) => [t.name, t]))

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name)
}

export function listTools(): readonly ToolDefinition[] {
  return REGISTRY
}

/**
 * Tools that only make sense for an app Atai builds. A connected business has
 * no source, database, deployment or plan-at-build, so offering these would let
 * the co-founder propose work the founder cannot do — or, worse, approve a
 * deploy of a site Atai does not host.
 */
const BUILD_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "create_project",
  "delete_project",
  "request_build",
  "request_deploy",
  "request_followup_edit",
  "stop_build",
  "get_build_status",
  "get_build_logs",
  "get_build_conversation",
  "get_plan",
  "propose_plan_update",
  "apply_plan_update",
  "autocomplete_plan",
  "analyze_plan",
  // The project-addressed audit cannot resolve an address for a business Atai
  // does not host; `run_business_seo_audit` is the operate-surface equivalent.
  "run_seo_audit",
])

/** Tools that only make sense on the operate surface. */
const OPERATE_ONLY_TOOLS: ReadonlySet<string> = new Set(["run_business_seo_audit"])

export type ToolSurface = "build" | "operate"

function forSurface(tool: ToolDefinition, surface: ToolSurface): boolean {
  if (surface === "operate") return !BUILD_ONLY_TOOLS.has(tool.name)
  return !OPERATE_ONLY_TOOLS.has(tool.name)
}

/** Tools the model may call immediately (READ / LOW_RISK_WRITE). */
export function immediateTools(surface: ToolSurface = "build", settings: ToolFilterSettings = {}): ToolDefinition[] {
  return REGISTRY.filter(
    (t) => !t.requiresConfirmation && forSurface(t, surface) && allowedBySettings(t, settings),
  )
}

/** Tools requiring confirmation — prepared during the loop, executed only via
 * the approval endpoint. */
export function confirmationTools(surface: ToolSurface = "build", settings: ToolFilterSettings = {}): ToolDefinition[] {
  return REGISTRY.filter(
    (t) => t.requiresConfirmation && forSurface(t, surface) && allowedBySettings(t, settings),
  )
}

/** Risk check helper for tests and the approval path. */
export function riskOf(name: string): ToolRisk | undefined {
  return BY_NAME.get(name)?.risk
}

// ─── Founder narrowing (settings rail) ──────────────────────────────────────

/** Founder-controlled narrowing of the closed registry. Removal only: the
 * registry stays the ceiling, so no setting can introduce a tool. */
export interface ToolFilterSettings {
  disabledTools?: readonly string[]
  allowConsequential?: boolean
}

export function allowedBySettings(tool: ToolDefinition, settings: ToolFilterSettings): boolean {
  if (settings.disabledTools?.includes(tool.name)) return false
  if (settings.allowConsequential === false && tool.risk !== "READ") return false
  return true
}

export function isKnownToolName(name: unknown): name is string {
  return typeof name === "string" && BY_NAME.has(name)
}

export interface ToolCatalogEntry {
  name: string
  description: string
  risk: ToolRisk
  requiresConfirmation: boolean
  surfaces: ToolSurface[]
}

function surfacesFor(tool: ToolDefinition): ToolSurface[] {
  const surfaces: ToolSurface[] = []
  if (forSurface(tool, "build")) surfaces.push("build")
  if (forSurface(tool, "operate")) surfaces.push("operate")
  return surfaces
}

/** Read-only view of the ceiling for the settings rail. */
export function listToolCatalog(): ToolCatalogEntry[] {
  return REGISTRY.map((t) => ({
    name: t.name,
    description: t.description,
    risk: t.risk,
    requiresConfirmation: t.requiresConfirmation,
    surfaces: surfacesFor(t),
  }))
}
