import type { ApplicationSpecification } from "@/lib/types/specification"
import type { ProjectPreferences } from "@/lib/types/project"
import { readCombinedMarketingPlan } from "@/lib/analysis/plan-sections"
import { externalProviderClaims } from "@/lib/analysis/runtime-capabilities"

/**
 * A plan can contain two instructions that cannot both be followed — the
 * reviewer's "contradictory instructions remain in the plan" defect. This
 * detector finds the platform-policy collisions the builder would otherwise
 * receive as simultaneous mandates, and hands each one a single authority.
 */
export interface PlanContradiction {
  readonly quote: string
  /** What the plan promises that the platform forbids. */
  readonly conflict: string
  /** The one instruction the builder must follow instead. */
  readonly resolution: string
}

// The runtime mandate owns every product capability, so a plan line that hands
// one to an outside provider is not a preference the builder may weigh — it is
// a contradiction to resolve. The provider names and their money-context guard
// live with the capability catalog (runtime-capabilities.ts) so the plan, the
// section status, and this block can never disagree about what counts.
export function findPlanContradictions(
  spec: ApplicationSpecification,
  preferences?: ProjectPreferences,
  founderIdea?: string,
): PlanContradiction[] {
  const found: PlanContradiction[] = []

  const sources = [
    // The founder's own words collide with the platform rules just as loudly as
    // the plan paraphrase does — scan them too, or the literal "use Stripe" in
    // the composer arrives at the builder un-resolved.
    founderIdea,
    spec.runtimeIntegrations,
    spec.adminConsole,
    spec.integrations,
    spec.additionalInstructions,
    spec.backendRequirements,
    spec.pricingStructure,
    spec.revenueModel,
    readCombinedMarketingPlan(spec),
    spec.coreFlows.map((f) => `${f.name}: ${f.description ?? ""}`),
    spec.suggestedFeatures.map((f) => `${f.label ?? ""} ${f.description ?? ""}`),
  ]
  for (const claim of externalProviderClaims(sources)) {
    const isPayments = claim.capability === "payments"
    found.push({
      quote: claim.quote,
      conflict: isPayments
        ? "names an external payment gateway, which the Atai Runtime mandate forbids"
        : `names ${claim.provider} for ${claim.capability}, which the Atai Runtime mandate owns`,
      resolution: isPayments
        ? "Move this money flow through atai.payments (@atai-group/sdk, ATAI_API_KEY). Do not install, configure, or ask for the named gateway or its keys — the runtime mandate is the single authority for payments."
        : `Implement this with ${claim.sdk} (@atai-group/sdk, ATAI_API_KEY) and keep the business outcome the founder described. ${claim.provider} is not an option here: do not install its SDK, do not ask for its key, and do not offer it as a fallback.`,
    })
  }

  if (preferences?.databaseChoice === "custom" && preferences.customDbProvider) {
    found.push({
      quote: `Database preference: custom provider “${preferences.customDbProvider}”${
        preferences.customDbProviderDetail ? ` — ${preferences.customDbProviderDetail}` : ""
      }`,
      conflict: "asks for an external database, which the Totalum-only stack rule forbids",
      resolution:
        "Implement all storage with the Totalum SDK built-in database, mirroring the schema the founder described so the data could later be exported to the provider they had in mind. Never add an external database or ORM.",
    })
  }

  return found
}

/** The brief block that gives the builder exactly one instruction per conflict. */
export function buildContradictionResolutionBlock(contradictions: PlanContradiction[]): string {
  if (contradictions.length === 0) return ""
  return [
    "═══ CONTRADICTIONS RESOLVED — ONE AUTHORITY EACH ═══",
    "These plan lines conflict with non-negotiable platform rules above. Do NOT implement both sides and do NOT treat the plan line as a competing instruction — follow the resolution for each, and leave the business outcome the founder wanted intact.",
    ...contradictions.map((c) => `- "${c.quote}" — ${c.conflict}. RESOLUTION: ${c.resolution}`),
  ].join("\n")
}
