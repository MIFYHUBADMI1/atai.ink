import "server-only"

import {
  getBuildTierCosts,
  getDeploymentCosts,
  getMirrorPipelineCosts,
  getPromotionalOffers,
  getRewardSettings,
  getVisualPricing,
} from "./runtime-config"
import { publicPromotionalOffers } from "./offers"
import type { PublicBillingConfig } from "./public-config-types"

/**
 * One read of the billing authority for public marketing/help surfaces.
 * Every number is admin-configurable; pages must not repeat these values.
 */
export async function getPublicBillingConfig(): Promise<PublicBillingConfig> {
  const [rewards, buildTierCosts, mirrorPipelineCosts, deploymentCosts, visualPricing, offers] = await Promise.all([
    getRewardSettings(),
    getBuildTierCosts(),
    getMirrorPipelineCosts(),
    getDeploymentCosts(),
    getVisualPricing(),
    getPromotionalOffers(),
  ])

  return {
    rewards,
    buildTierCosts,
    mirrorPipelineCosts,
    deploymentCosts,
    visualPricing,
    offers: publicPromotionalOffers(offers),
  }
}
