/**
 * Atai — Plan catalog & entitlement computation (Phase 3).
 *
 * This is the NEW five-plan commercial catalog. It is the single source of
 * entitlement truth consumed by the entitlement service. It deliberately does
 * NOT replace lib/billing/config.ts's billing plumbing (Dodo products, ledger
 * types, credit valuation) — it layers entitlements on top.
 *
 * @module lib/billing/entitlements/catalog
 */

import type {
  CommercialPlanId,
  EntitlementSet,
  EntitlementOp,
  EntitlementCheck,
  AICofounderTier,
  TeamTier,
  SupportTier,
} from "./types"
import type { InfrastructurePlanId } from "@/lib/infrastructure/plans"

export const ENTITLEMENT_VERSION = "ENT_V1"

/** Approved commercial prices (USD). Mirrors the master spec §2 / §3. */
export const PLAN_PRICING = {
  explorer: { monthly: 0, annual: 0 },
  starter: { monthly: 89.99, annual: 989.89 },
  growth: { monthly: 199.99, annual: 2199.89 },
  scale: { monthly: 499.99, annual: 5499.89 },
  enterprise: { monthly: null, annual: null },
} as const

export const POPULAR_PLAN: CommercialPlanId = "growth"

/**
 * ⚠️ PROVISIONAL — DO NOT TREAT AS FINAL (hard rule #1).
 *
 * These monthly credit allocations are placeholders. The Phase 4 contribution-
 * margin model MUST ratify the real numbers before launch. They are overridable
 * per-plan via admin app_settings (setPlanCreditAllocation) and the entitlement
 * service falls back to legacy mirrorCredits for migrated subscribers.
 */
export const PROVISIONAL_MONTHLY_CREDITS: Record<CommercialPlanId, number | null> = {
  explorer: 500, // planning-only, scope-restricted
  starter: 150_000,
  growth: 400_000,
  scale: 1_200_000,
  enterprise: null, // negotiated
}

interface PlanBase {
  businesses: number | "unlimited"
  productionApps: number | "unlimited"
  subdomains: number
  customDomains: number
  infraDefault: InfrastructurePlanId | null
  infraMax: InfrastructurePlanId | null
  computePriority: boolean
  cofounderTier: AICofounderTier
  teams: TeamTier
  teamCustomization: boolean
  agents: { start: boolean; scout: boolean; optimize: boolean }
  marketing: {
    seo: boolean
    content: boolean
    ads: boolean
    automation: boolean
    socialPublish: boolean
    knowledgeBase: boolean
  }
  bi: {
    financial: boolean
    analytics: boolean
    competitionMonitoring: boolean
    multiBusiness: boolean
    customerInsights: boolean
    knowledgeBase: boolean
  }
  education: { paths: boolean; lessons: "selected" | "full"; playbooks: boolean }
  support: SupportTier
  availability: { agents: boolean; marketingAutomation: boolean; knowledgeBase: boolean }
}

const PLAN_BASE: Record<CommercialPlanId, PlanBase> = {
  explorer: {
    businesses: 0,
    productionApps: 0,
    subdomains: 0,
    customDomains: 0,
    infraDefault: null,
    infraMax: null,
    computePriority: false,
    cofounderTier: "limited",
    teams: "none",
    teamCustomization: false,
    agents: { start: false, scout: false, optimize: false },
    marketing: { seo: false, content: false, ads: false, automation: false, socialPublish: false, knowledgeBase: false },
    bi: { financial: false, analytics: false, competitionMonitoring: false, multiBusiness: false, customerInsights: false, knowledgeBase: false },
    education: { paths: false, lessons: "selected", playbooks: false },
    support: "community",
    availability: { agents: false, marketingAutomation: false, knowledgeBase: false },
  },
  starter: {
    businesses: 1,
    productionApps: 1,
    subdomains: 1,
    customDomains: 0,
    infraDefault: "starter",
    infraMax: "starter",
    computePriority: false,
    cofounderTier: "core",
    teams: "core",
    teamCustomization: false,
    agents: { start: false, scout: false, optimize: false },
    marketing: { seo: true, content: true, ads: false, automation: false, socialPublish: false, knowledgeBase: false },
    bi: { financial: true, analytics: true, competitionMonitoring: false, multiBusiness: false, customerInsights: false, knowledgeBase: false },
    education: { paths: false, lessons: "selected", playbooks: false },
    support: "standard",
    availability: { agents: false, marketingAutomation: false, knowledgeBase: false },
  },
  growth: {
    businesses: 4,
    productionApps: 4,
    subdomains: 1,
    customDomains: 1,
    infraDefault: "business",
    infraMax: "business",
    computePriority: false,
    cofounderTier: "advanced",
    teams: "expanded",
    teamCustomization: false,
    agents: { start: false, scout: false, optimize: false },
    marketing: { seo: true, content: true, ads: true, automation: false, socialPublish: false, knowledgeBase: false },
    bi: { financial: true, analytics: true, competitionMonitoring: true, multiBusiness: false, customerInsights: false, knowledgeBase: false },
    education: { paths: true, lessons: "full", playbooks: true },
    support: "direct",
    availability: { agents: false, marketingAutomation: false, knowledgeBase: false },
  },
  scale: {
    businesses: "unlimited",
    productionApps: "unlimited",
    subdomains: 1,
    customDomains: 4,
    infraDefault: "enterprise",
    infraMax: "enterprise",
    computePriority: true,
    cofounderTier: "premium",
    teams: "premium",
    teamCustomization: true,
    agents: { start: true, scout: true, optimize: true }, // capability slot; gated by availability
    marketing: { seo: true, content: true, ads: true, automation: true, socialPublish: true, knowledgeBase: false },
    bi: { financial: true, analytics: true, competitionMonitoring: true, multiBusiness: true, customerInsights: true, knowledgeBase: true },
    education: { paths: true, lessons: "full", playbooks: true },
    support: "premium",
    availability: { agents: false, marketingAutomation: false, knowledgeBase: false }, // NOT YET LAUNCHED
  },
  enterprise: {
    businesses: "unlimited",
    productionApps: "unlimited",
    subdomains: 99,
    customDomains: 99,
    infraDefault: "enterprise",
    infraMax: "enterprise",
    computePriority: true,
    cofounderTier: "premium",
    teams: "premium",
    teamCustomization: true,
    agents: { start: true, scout: true, optimize: true },
    marketing: { seo: true, content: true, ads: true, automation: true, socialPublish: true, knowledgeBase: true },
    bi: { financial: true, analytics: true, competitionMonitoring: true, multiBusiness: true, customerInsights: true, knowledgeBase: true },
    education: { paths: true, lessons: "full", playbooks: true },
    support: "premium",
    availability: { agents: false, marketingAutomation: false, knowledgeBase: false }, // tuned per contract
  },
}

export interface BuildCounts {
  businesses: number
  productionApps: number
  subdomains: number
  customDomainsConsumed: number
}

export interface BuildOpts {
  grandfathered?: boolean
  preserveLegacyBehavior?: boolean
  legacyPlanId?: string
  /** Override the provisional monthly grant (admin-configured). */
  monthlyGrantOverride?: number | null
}

export function buildEntitlementSet(
  planId: CommercialPlanId,
  counts: BuildCounts,
  opts: BuildOpts = {},
): EntitlementSet {
  const base = PLAN_BASE[planId]
  const isExplorer = planId === "explorer"

  // Grandfathered legacy free users keep production capability during transition.
  const preserve = !!opts.preserveLegacyBehavior
  const planningOnly = isExplorer && !preserve

  // When preserving legacy behavior, remove the artificial caps (legacy free
  // accounts had no creation cap) so existing users are never silently reduced.
  const businessMax = preserve ? "unlimited" : base.businesses
  const appMax = preserve ? "unlimited" : base.productionApps

  return {
    commercialPlanId: planId,
    legacyPlanId: opts.legacyPlanId,
    entitlementVersion: ENTITLEMENT_VERSION,
    grandfathered: !!opts.grandfathered,
    preserveLegacyBehavior: preserve,
    planningOnly,
    businesses: { max: businessMax, current: counts.businesses },
    productionApps: { max: appMax, current: counts.productionApps },
    subdomains: { max: base.subdomains, current: counts.subdomains },
    customDomainsIncluded: { max: base.customDomains, consumed: counts.customDomainsConsumed },
    infra: {
      defaultTier: base.infraDefault,
      maxTier: base.infraMax,
      storageBytes: null,
      computePriority: base.computePriority,
    },
    credits: {
      monthlyGrant:
        opts.monthlyGrantOverride !== undefined ? opts.monthlyGrantOverride : PROVISIONAL_MONTHLY_CREDITS[planId],
      planningOnlyAmount: isExplorer ? 500 : null,
      consumptionOrder: ["subscription", "permanent"],
    },
    ai: {
      cofounderTier: base.cofounderTier,
      teams: base.teams,
      teamCustomization: base.teamCustomization,
      agents: { ...base.agents },
    },
    marketing: { ...base.marketing },
    bi: { ...base.bi },
    education: { ...base.education },
    support: base.support,
    availability: { ...base.availability },
  }
}

function allow(): EntitlementCheck {
  return { allowed: true }
}

function deny(code: string, reason: string): EntitlementCheck {
  return { allowed: false, code, reason }
}

/**
 * Pure authorization decision. Given an EntitlementSet and an operation,
 * returns whether it is permitted. This is the single place plan semantics
 * are interpreted — keep it exhaustive and side-effect free.
 */
export function checkEntitlement(
  set: EntitlementSet,
  op: EntitlementOp,
  ctx?: { agent?: "start" | "scout" | "optimize" },
): EntitlementCheck {
  switch (op) {
    case "createProject":
    case "forkProject": {
      if (set.planningOnly) {
        return deny("EXPLORER_PLANNING_ONLY", "Explorer is a planning-only environment and cannot create production businesses.")
      }
      if (set.businesses.max === "unlimited") return allow()
      if (set.businesses.current >= set.businesses.max) {
        return deny("BUSINESS_LIMIT_REACHED", `Your plan allows ${set.businesses.max} business(es). Upgrade to create more.`)
      }
      return allow()
    }
    case "buildProduction":
    case "deploy":
    case "provisionDatabase":
    case "useStorage": {
      if (set.planningOnly) {
        return deny("EXPLORER_PLANNING_ONLY", "Explorer cannot generate, deploy, or host production applications.")
      }
      return allow()
    }
    case "connectSubdomain": {
      if (set.subdomains.max <= 0) return deny("SUBDOMAIN_NOT_INCLUDED", "Your plan does not include a free subdomain.")
      if (set.subdomains.current >= set.subdomains.max) return deny("SUBDOMAIN_LIMIT", "Subdomain limit reached for your plan.")
      return allow()
    }
    case "registerCustomDomain": {
      if (set.customDomainsIncluded.max <= 0) {
        return deny("CUSTOM_DOMAIN_NOT_INCLUDED", "Your plan does not include a custom domain registration.")
      }
      if (set.customDomainsIncluded.consumed >= set.customDomainsIncluded.max) {
        return deny("CUSTOM_DOMAIN_LIMIT", "Included custom-domain registrations consumed. Additional domains can be purchased separately.")
      }
      return allow()
    }
    case "useAICofounder": {
      // Every plan (incl. Explorer "limited") provides at least a limited Co-founder.
      return allow()
    }
    case "useSpecialistTeam": {
      if (set.ai.teams === "none") return deny("NO_TEAMS", "Specialist teams are not available on this plan.")
      return allow()
    }
    case "useAgent": {
      const which = ctx?.agent ?? "start"
      if (!set.ai.agents[which]) return deny("AGENT_UNAVAILABLE", `Agent ${which} is not available on this plan.`)
      if (!set.availability.agents) return deny("AGENT_NOT_LAUNCHED", `Agent ${which} is not yet available.`)
      return allow()
    }
    case "useCompetitionIntel": {
      if (set.bi.competitionMonitoring) return allow()
      if (set.planningOnly) return allow() // explorer research-only path
      return deny("COMPETITION_MONITORING_UNAVAILABLE", "Competition monitoring requires Growth or higher.")
    }
    case "useMarketingAutomation": {
      if (!set.marketing.automation) return deny("MARKETING_AUTOMATION_UNAVAILABLE", "Marketing automation requires Scale.")
      if (!set.availability.marketingAutomation) return deny("MARKETING_AUTOMATION_NOT_LAUNCHED", "Marketing automation is not yet available.")
      return allow()
    }
    case "publishSocial": {
      if (!set.marketing.socialPublish) return deny("SOCIAL_PUBLISH_UNAVAILABLE", "Social publishing requires Scale.")
      if (!set.availability.marketingAutomation) return deny("SOCIAL_PUBLISH_NOT_LAUNCHED", "Social publishing is not yet available.")
      return allow()
    }
    case "useSEO":
      return set.marketing.seo ? allow() : deny("SEO_UNAVAILABLE", "SEO is not available on this plan.")
    case "useKnowledgeBase": {
      if (!set.bi.knowledgeBase) return deny("KNOWLEDGE_BASE_UNAVAILABLE", "Knowledge base is not available on this plan.")
      if (!set.availability.knowledgeBase) return deny("KNOWLEDGE_BASE_NOT_LAUNCHED", "Knowledge base is not yet available.")
      return allow()
    }
    case "accessLearningPath":
      return set.education.paths ? allow() : deny("LEARNING_PATHS_UNAVAILABLE", "Learning paths are not available on this plan.")
    case "accessBI":
      return set.bi.financial ? allow() : deny("BI_UNAVAILABLE", "Business intelligence is not available on this plan.")
    case "accessAds":
      return set.marketing.ads ? allow() : deny("ADS_UNAVAILABLE", "Advertising is not available on this plan.")
    default:
      return deny("UNKNOWN_OPERATION", "Unknown entitlement operation.")
  }
}
