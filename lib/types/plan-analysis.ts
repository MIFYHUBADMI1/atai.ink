import { z } from "zod"

/**
 * Structured AI-analysis types for the Collaborate workspace.
 *
 * Zod schemas because the ANALYSIS response comes from the AI and is
 * validated server-side before anything is stored or rendered (spec
 * sections 17 & 31). Findings feed the insights panel; proposals never
 * touch the plan until the user approves them.
 */

export const PlanFindingSchema = z.object({
  section: z.string(), // plan section id — re-validated against PLAN_SECTIONS at render time
  severity: z.enum(["gap", "weakness", "strength"]),
  title: z.string(),
  currentState: z.string(),
  why: z.string(),
  recommendation: z.string(),
})
export type PlanFinding = z.infer<typeof PlanFindingSchema>

export const PlanProposalSchema = z.object({
  id: z.string(),
  section: z.string(),
  currentValue: z.string(),
  proposedValue: z.string(),
  reason: z.string(),
  /** How the proposal entered the system: from chat or from analysis. */
  source: z.enum(["chat", "analysis"]).default("chat"),
  /** ISO timestamp — used for freshness display. */
  createdAt: z.string(),
})
export type PlanProposal = z.infer<typeof PlanProposalSchema>

export const PlanAnalysisSchema = z.object({
  generatedAt: z.number(),
  /** Deterministic snapshot of section statuses at generation time. */
  healthPercent: z.number().min(0).max(100),
  summary: z.string(),
  findings: z.array(PlanFindingSchema).default([]),
  proposals: z.array(PlanProposalSchema).default([]),
  /** Model-independent advice on what to do next, derived from findings. */
  nextBestAction: z
    .object({
      section: z.string(),
      title: z.string(),
      why: z.string(),
    })
    .optional(),
  /** Cost accounting for display next to cached analyses. */
  creditsCharged: z.number().optional(),
})
export type PlanAnalysis = z.infer<typeof PlanAnalysisSchema>

/** Plan sections that state the same reality from different angles, grouped
 * into clusters (spec section 11). These are static product knowledge, not AI
 * guesses.
 *
 * Declared as clusters rather than pairwise hints on purpose: a pairwise map
 * can only ever show part of a cluster (a chat about Target Customers reached
 * Pricing Tiers but ran out of room before Pricing Structure, Business Model
 * and Revenue Model), and a half-shown cluster is exactly how the plan drifts
 * — two tier lists, two prices. Any section inside a cluster ships WITH every
 * other member of that cluster, so the co-founder AI and the accept-card
 * always see the whole money story, the whole market story, the whole product
 * story. A section may belong to several clusters; their union is its context.
 * List the most load-bearing members first: the context cap keeps the front. */
export const SECTION_CLUSTERS: ReadonlyArray<{ name: string; sections: readonly string[] }> = [
  {
    // The money story: what is sold, to whom, for how much, and what limits
    // justify each price. Pricing Structure is what the build consumes;
    // Pricing Tiers is the detailed catalogue — they must say the same thing.
    name: "Money & offer",
    sections: ["pricingTiers", "pricingTiersDetail", "revenueModel", "businessModel", "targetUsers", "features", "runtimeIntegrations"],
  },
  {
    name: "Go-to-market",
    sections: ["marketingPlan", "targetUsers", "seo", "vision", "overview", "pricingTiersDetail"],
  },
  {
    name: "Product shape",
    sections: ["features", "flows", "data", "userRoles", "auth", "adminConsole", "pricingTiersDetail"],
  },
  {
    name: "Foundation",
    sections: ["vision", "overview", "applicationType", "targetUsers", "marketingPlan"],
  },
  {
    name: "Experience",
    sections: ["designDirection", "features", "flows", "marketingPlan"],
  },
  {
    name: "Technical",
    sections: ["backend", "integrations", "runtimeIntegrations", "adminConsole", "data"],
  },
]

/** Sections that must be told which field is authoritative, because the same
 * money story lives in two of them. */
export const PRICING_PAIR_SECTIONS: readonly string[] = ["pricingTiers", "pricingTiersDetail"]
