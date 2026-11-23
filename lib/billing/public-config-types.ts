import type { PublicPromotionalOffer } from "./offers"
import type { VisualPricingConfig } from "./visual-pricing"

/** Public, non-secret billing values safe to render on marketing and help pages. */
export interface PublicRewards {
  welcomeBonus: number
  referralSignupBonus: number
  referralVerificationReward: number
  referralMilestoneReward: number
  referralMilestoneThreshold: number
}

export interface PublicBuildTierCosts {
  simple: number
  medium: number
  complex: number
}

export interface PublicMirrorPipelineCosts {
  scrapeCost: number
  heavyScrapeCost: number
  planCost: number
  heavyPlanCost: number
  deepCrawlCost: number
  heavyDeepCrawlCost: number
}

export interface PublicDeploymentCosts {
  deployCost: number
}

export interface PublicSeoAuditCosts {
  auditCost: number
}

export interface PublicBillingConfig {
  rewards: PublicRewards
  buildTierCosts: PublicBuildTierCosts
  mirrorPipelineCosts: PublicMirrorPipelineCosts
  deploymentCosts: PublicDeploymentCosts
  seoAuditCosts: PublicSeoAuditCosts
  visualPricing: VisualPricingConfig
  offers: PublicPromotionalOffer[]
}
