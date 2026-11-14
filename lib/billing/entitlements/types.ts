/**
 * Atai — Centralized Entitlement types (Phase 3, built on Phase 2 design).
 *
 * These types are the contract for the single authoritative entitlement
 * service. Every route, server action, background job and Runtime endpoint
 * resolves access through `EntitlementSet` + `checkEntitlement` — never by
 * reading plan names or prices from the client.
 *
 * @module lib/billing/entitlements/types
 */

import type { InfrastructurePlanId } from "@/lib/infrastructure/plans"

export type CommercialPlanId = "explorer" | "starter" | "growth" | "scale" | "enterprise"

export type EntitlementOp =
  | "createProject"
  | "forkProject"
  | "buildProduction"
  | "deploy"
  | "provisionDatabase"
  | "useStorage"
  | "connectSubdomain"
  | "registerCustomDomain"
  | "useAICofounder"
  | "useSpecialistTeam"
  | "useAgent"
  | "useCompetitionIntel"
  | "useMarketingAutomation"
  | "publishSocial"
  | "useSEO"
  | "useKnowledgeBase"
  | "accessLearningPath"
  | "accessBI"
  | "accessAds"

export type AICofounderTier = "limited" | "core" | "advanced" | "premium"
export type TeamTier = "none" | "core" | "expanded" | "premium"
export type SupportTier = "community" | "standard" | "direct" | "priority" | "premium"

/**
 * The fully resolved authorization view for one account.
 * Computed by the entitlement service; never constructed from client input.
 */
export interface EntitlementSet {
  commercialPlanId: CommercialPlanId
  legacyPlanId?: string
  entitlementVersion: string
  grandfathered: boolean
  /** Legacy free users keep production capability during the transition. */
  preserveLegacyBehavior: boolean
  /** True only for genuine planning-only (new Explorer) accounts. */
  planningOnly: boolean

  businesses: { max: number | "unlimited"; current: number }
  productionApps: { max: number | "unlimited"; current: number }
  subdomains: { max: number; current: number }
  customDomainsIncluded: { max: number; consumed: number }

  infra: {
    defaultTier: InfrastructurePlanId | null
    maxTier: InfrastructurePlanId | null
    storageBytes: number | null
    computePriority: boolean
  }

  credits: {
    /** Provisional + admin-overridable. Final value set by Phase 4 financial model. */
    monthlyGrant: number | null
    planningOnlyAmount: number | null
    consumptionOrder: ("subscription" | "permanent")[]
  }

  ai: {
    cofounderTier: AICofounderTier
    teams: TeamTier
    teamCustomization: boolean
    agents: { start: boolean; scout: boolean; optimize: boolean }
  }

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

  /** Gates UI advertising of not-yet-launched Scale features (hard rule #3). */
  availability: { agents: boolean; marketingAutomation: boolean; knowledgeBase: boolean }
}

export interface EntitlementCheck {
  allowed: boolean
  code?: string
  reason?: string
}
