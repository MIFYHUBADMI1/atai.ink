import { describe, expect, it, vi } from "vitest"

const { CONFIG } = vi.hoisted(() => ({
  CONFIG: {
    rewards: {
      welcomeBonus: 750,
      referralSignupBonus: 600,
      referralVerificationReward: 700,
      referralMilestoneReward: 1_800,
      referralMilestoneThreshold: 80_000,
    },
    buildTierCosts: { simple: 1, medium: 2, complex: 3 },
    mirrorPipelineCosts: {
      scrapeCost: 4,
      heavyScrapeCost: 5,
      planCost: 6,
      heavyPlanCost: 7,
      deepCrawlCost: 8,
      heavyDeepCrawlCost: 9,
    },
    deploymentCosts: { deployCost: 10 },
    visualPricing: {
      markup: 1.45,
      creditsPerUsd: 4000,
      fallbackCredits: 1600,
      estimatedCredits: 1000,
    },
    offers: [
      {
        id: "offer_1",
        name: "Launch bonus",
        description: "Extra credits",
        target: "all",
        productIds: [],
        bonusCredits: 1_000,
        startsAt: null,
        endsAt: null,
      },
    ],
  },
}))

vi.mock("@/lib/billing/public-config", () => ({
  getPublicBillingConfig: vi.fn(async () => CONFIG),
}))

import { GET } from "./route"

describe("GET /api/billing/public-config", () => {
  it("returns the configured public billing values with a short cache", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(CONFIG)
    expect(response.headers.get("Cache-Control")).toContain("max-age=60")
  })
})
