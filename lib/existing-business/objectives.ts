import {
  isCampaignsEnabledForUser,
  isGrowthTasksEnabledForUser,
  isSeoAuditEnabledForUser,
  isStudioEnabledForUser,
} from "@/lib/marketing/feature-flags"
import type { BusinessObjectiveId } from "@/lib/types/business-intake"

/**
 * The objective choices offered during existing-business intake, and where in
 * Atai each one is actually worked on.
 *
 * Rule for this table: every `href` must be a route that exists, and anything
 * behind a founder feature switch declares it — a recommendation must never
 * link to a screen the founder cannot open. `executableNow` is honest about
 * what Atai can do itself today.
 */
export interface ObjectiveAction {
  label: string
  /** Template; `{id}` is replaced with the project id. */
  href: string
  detail: string
  /** Founder feature gate, if the route is switch-gated. */
  requires?: "seoAudit" | "growthTasks" | "campaigns" | "studio"
  /** What Atai can carry out without the founder doing the step themselves. */
  executableNow: boolean
  needs?: string
}

export interface ObjectiveDefinition {
  id: BusinessObjectiveId
  label: string
  blurb: string
  actions: ObjectiveAction[]
}

export const BUSINESS_OBJECTIVES: readonly ObjectiveDefinition[] = [
  {
    id: "acquire_customers",
    label: "Acquire more customers",
    blurb: "Find and reach the people most likely to buy.",
    actions: [
      { label: "Review your market position", href: "/project/{id}/market", detail: "Growth overview reads your real workspace signals — visitors and conversions only once an app is live.", executableNow: false, needs: "your input on who you serve" },
      { label: "Research competitors", href: "/project/{id}/competition", detail: "Runs live web research on the names you give, and saves the report.", executableNow: true },
      { label: "Plan advertising", href: "/project/{id}/ads", detail: "Atai drafts the campaign and quotes the spend; you approve and pay on the ad platform.", executableNow: false, needs: "your budget and approval" },
      { label: "Draft marketing content", href: "/project/{id}/studio", detail: "Copy drafts only — Atai never publishes.", requires: "studio", executableNow: true },
    ],
  },
  {
    id: "increase_revenue",
    label: "Increase revenue",
    blurb: "Better pricing, better conversion, clearer offer.",
    actions: [
      { label: "Revisit pricing in the plan", href: "/project/{id}/plan", detail: "Pricing and revenue model are plan sections you can edit and ask the co-founder to revise.", executableNow: true },
      { label: "Check what a customer costs you", href: "/project/{id}/finances", detail: "Money and credits are shown on separate axes; provider costs are real, revenue is only what you record.", executableNow: false },
    ],
  },
  {
    id: "improve_marketing",
    label: "Improve marketing",
    blurb: "Sharpen the message and the channels.",
    actions: [
      { label: "Tighten the marketing plan", href: "/project/{id}/plan", detail: "The marketing plan is one section with the full business context beside it.", executableNow: true },
      { label: "Draft campaign plans", href: "/project/{id}/campaigns", detail: "Plans and tracks only — nothing is posted or scheduled for you.", requires: "campaigns", executableNow: false },
      { label: "Draft content", href: "/project/{id}/studio", detail: "Copy drafts only — Atai never publishes.", requires: "studio", executableNow: true },
    ],
  },
  {
    id: "improve_website",
    label: "Improve my website or application",
    blurb: "Make the thing customers actually see work better.",
    actions: [
      { label: "Ask for changes to your app", href: "/project/{id}/edit", detail: "Requires an application built in Atai; your existing site is not edited by Atai.", executableNow: false, needs: "a business app built in Atai first" },
      { label: "Run an SEO visibility audit", href: "/project/{id}/market/seo", detail: "Audits the deployed Atai app's own URL, page by page.", requires: "seoAudit", executableNow: true },
      { label: "Compare against your current site", href: "/project/{id}/plan", detail: "The assessment keeps what we observed on your site separate from what we suggest.", executableNow: false },
    ],
  },
  {
    id: "understand_competitors",
    label: "Understand my competitors",
    blurb: "Know who else your customers are choosing.",
    actions: [
      { label: "Run competitor research", href: "/project/{id}/competition", detail: "Live research, stored as a report with its evidence.", executableNow: true },
      { label: "Add competitors to your resources", href: "/project/{id}/resources", detail: "Keeps the names you track in one place.", executableNow: false },
    ],
  },
  {
    id: "improve_retention",
    label: "Improve customer retention",
    blurb: "Keep the customers you already paid to win.",
    actions: [
      { label: "Look at product analytics", href: "/project/{id}/intelligence", detail: "Only available once an Atai-built app reports events, and only with your consent on that project.", executableNow: false, needs: "a built app plus analytics consent" },
      { label: "Plan retention work as tasks", href: "/project/{id}/tasks", detail: "Atai proposes tasks; you do the work.", requires: "growthTasks", executableNow: false },
    ],
  },
  {
    id: "automate_operations",
    label: "Automate business operations",
    blurb: "Remove the manual steps that repeat every week.",
    actions: [
      { label: "Review runtime capabilities and keys", href: "/project/{id}/runtime", detail: "What your built app may call, and with which credentials.", executableNow: false },
      { label: "Work a task list", href: "/project/{id}/tasks", detail: "Nothing runs on a timer today — tasks are tracked, not executed.", requires: "growthTasks", executableNow: false, needs: "scheduled execution is not available yet" },
    ],
  },
  {
    id: "improve_finances",
    label: "Improve financial management",
    blurb: "See what comes in, what goes out, and what it costs.",
    actions: [
      { label: "Open your finances", href: "/project/{id}/finances", detail: "Recorded income, provider costs and credits, each in its own unit.", executableNow: false },
    ],
  },
  {
    id: "expand_markets",
    label: "Expand into new markets",
    blurb: "New segments, regions or channels.",
    actions: [
      { label: "Re-examine the market", href: "/project/{id}/market", detail: "Position and channel thinking, grounded in your workspace.", executableNow: false },
      { label: "Research the new competitors", href: "/project/{id}/competition", detail: "Live research on the names you give.", executableNow: true },
    ],
  },
  {
    id: "improve_performance",
    label: "Improve overall business performance",
    blurb: "Work the biggest constraint first.",
    actions: [
      { label: "Work the priorities from this assessment", href: "/project/{id}/collaborate", detail: "The co-founder keeps your assessment as context for every reply.", executableNow: false },
      { label: "Check visibility of your site", href: "/project/{id}/market/seo", detail: "Deterministic on-page checks plus AI guidance.", requires: "seoAudit", executableNow: true },
    ],
  },
]

const BY_ID = new Map(BUSINESS_OBJECTIVES.map((o) => [o.id, o]))

export function objectiveDefinition(id: BusinessObjectiveId): ObjectiveDefinition | undefined {
  return BY_ID.get(id)
}

export function objectiveLabel(id: BusinessObjectiveId): string {
  return BY_ID.get(id)?.label ?? id
}

export function isBusinessObjectiveId(value: unknown): value is BusinessObjectiveId {
  return typeof value === "string" && BY_ID.has(value as BusinessObjectiveId)
}

export interface ResolvedAction extends ObjectiveAction {
  href: string
  /** Which selected objective produced this destination. The assessment
   * attaches a model priority to an action through this id. */
  objective: BusinessObjectiveId
}

/**
 * Turn selected objectives into concrete destinations. Anything requiring a
 * founder feature that is switched off is dropped here, so no screen can offer
 * a link the founder cannot open.
 */
export function resolveObjectiveActions(input: {
  projectId: string
  userId: string
  prefs?: Parameters<typeof isSeoAuditEnabledForUser>[1]
  objectives: readonly BusinessObjectiveId[]
}): ResolvedAction[] {
  const enabled: Record<NonNullable<ObjectiveAction["requires"]>, boolean> = {
    seoAudit: isSeoAuditEnabledForUser(input.userId, input.prefs),
    growthTasks: isGrowthTasksEnabledForUser(input.userId, input.prefs),
    campaigns: isCampaignsEnabledForUser(input.userId, input.prefs),
    studio: isStudioEnabledForUser(input.userId),
  }

  const seen = new Set<string>()
  const out: ResolvedAction[] = []
  for (const id of input.objectives) {
    for (const action of BY_ID.get(id)?.actions ?? []) {
      if (action.requires && !enabled[action.requires]) continue
      const href = action.href.replace("{id}", input.projectId)
      const key = `${href}::${action.label}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...action, href, objective: id })
    }
  }
  return out
}
