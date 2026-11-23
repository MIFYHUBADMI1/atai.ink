import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  resolveAdminCatalogSnapshot: vi.fn(),
  getCollaborateCosts: vi.fn(),
  getBuildTierCosts: vi.fn(),
  getMirrorPipelineCosts: vi.fn(),
  getExistingBusinessCosts: vi.fn(),
  getDeploymentCosts: vi.fn(),
  getVisualPricing: vi.fn(),
  getForkPricing: vi.fn(),
  getInfrastructurePrices: vi.fn(),
  getRewardSettings: vi.fn(),
  getRuntimePricing: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/billing/catalog/admin-context", () => ({
  resolveAdminCatalogSnapshot: mocks.resolveAdminCatalogSnapshot,
}))
vi.mock("@/lib/billing/runtime-config", () => ({
  getCollaborateCosts: mocks.getCollaborateCosts,
  getBuildTierCosts: mocks.getBuildTierCosts,
  getMirrorPipelineCosts: mocks.getMirrorPipelineCosts,
  getExistingBusinessCosts: mocks.getExistingBusinessCosts,
  getSeoAuditCosts: vi.fn(async () => ({ auditCost: 100 })),
  getDeploymentCosts: mocks.getDeploymentCosts,
  getVisualPricing: mocks.getVisualPricing,
  getForkPricing: mocks.getForkPricing,
  getInfrastructurePrices: mocks.getInfrastructurePrices,
  getRewardSettings: mocks.getRewardSettings,
  getRuntimePricing: mocks.getRuntimePricing,
  updateBillingSettings: vi.fn(),
  invalidateBillingSettings: vi.fn(),
  DEFAULT_COLLABORATE_COSTS: { chatMessageCost: 1, planAnalysisCost: 2, autoCompleteSectionCost: 3 },
  DEFAULT_BUILD_TIER_COSTS: { simple: 1, medium: 2, complex: 3 },
  DEFAULT_MIRROR_PIPELINE_COSTS: {
    scrapeCost: 1, heavyScrapeCost: 2, planCost: 3, heavyPlanCost: 4, deepCrawlCost: 5, heavyDeepCrawlCost: 6,
  },
  DEFAULT_EXISTING_BUSINESS_COSTS: { readCost: 1, assessmentCost: 2 },
  DEFAULT_SEO_AUDIT_COSTS: { auditCost: 100 },
  DEFAULT_DEPLOYMENT_COSTS: { deployCost: 1 },
  DEFAULT_VISUAL_PRICING_CONFIG: {
    markup: 1.45, creditsPerUsd: 4000, fallbackCredits: 1600, estimatedCredits: 1000,
  },
  DEFAULT_FORK_PRICING: {
    simpleForkCost: 1, mediumForkCost: 2, complexForkCost: 3,
    simpleOwnerRoyalty: 4, mediumOwnerRoyalty: 5, complexOwnerRoyalty: 6,
  },
  DEFAULT_INFRASTRUCTURE_PRICES: { basicPrice: 1, starterPrice: 2, proPrice: 3, businessPrice: 4 },
  DEFAULT_REWARDS: {},
  DEFAULT_RUNTIME_PRICING: {},
  RUNTIME_PRICING_VERSION: "test",
}))

import { GET } from "./route"

describe("GET /api/admin/billing/configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ id: "admin_1" })
    mocks.getCollaborateCosts.mockResolvedValue({ chatMessageCost: 1, planAnalysisCost: 2, autoCompleteSectionCost: 3 })
    mocks.getBuildTierCosts.mockResolvedValue({ simple: 1, medium: 2, complex: 3 })
    mocks.getMirrorPipelineCosts.mockResolvedValue({
      scrapeCost: 1, heavyScrapeCost: 2, planCost: 3, heavyPlanCost: 4, deepCrawlCost: 5, heavyDeepCrawlCost: 6,
    })
    mocks.getExistingBusinessCosts.mockResolvedValue({ readCost: 1, assessmentCost: 2 })
    mocks.getDeploymentCosts.mockResolvedValue({ deployCost: 1 })
    mocks.getVisualPricing.mockResolvedValue({
      markup: 1.45, creditsPerUsd: 4000, fallbackCredits: 1600, estimatedCredits: 1000,
    })
    mocks.getForkPricing.mockResolvedValue({
      simpleForkCost: 1, mediumForkCost: 2, complexForkCost: 3,
      simpleOwnerRoyalty: 4, mediumOwnerRoyalty: 5, complexOwnerRoyalty: 6,
    })
    mocks.getInfrastructurePrices.mockResolvedValue({
      basicPrice: 1, starterPrice: 2, proPrice: 3, businessPrice: 4,
    })
    mocks.getRewardSettings.mockResolvedValue({
      welcomeBonus: 1,
      referralSignupBonus: 2,
      referralVerificationReward: 3,
      referralMilestoneReward: 4,
      referralMilestoneThreshold: 5,
    })
    mocks.getRuntimePricing.mockResolvedValue({})
    mocks.resolveAdminCatalogSnapshot.mockResolvedValue({
      source: {
        requestedSource: "db",
        adminSource: "db",
        checkoutSource: "code",
        publicReadsEnabled: false,
        gated: true,
        publication: null,
        shadowDifferences: 0,
        error: null,
      },
      plans: [{
        id: "starter",
        name: "Starter",
        tagline: "Start",
        priceUSD: 19,
        annualPriceUSD: 190,
        mirrorCredits: 1000,
        interval: "monthly",
        active: true,
        purchaseState: "available",
        annualPurchaseState: "unavailable",
        features: [],
        notIncluded: [],
      }],
      packs: [{
        id: "perm_200k",
        credits: 200_000,
        priceUSD: 59,
        label: "200,000 Credits",
        saleMode: "self_serve",
        dodoProductId: "dodo_pack",
      }],
      infrastructure: [],
    })
  })

  it("serves catalog values and source state from the shared admin snapshot", async () => {
    const response = await GET()
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.data.catalogSource).toMatchObject({
      requestedSource: "db",
      adminSource: "db",
      checkoutSource: "code",
      gated: true,
    })
    expect(body.data.subscriptionPlans[0]).toMatchObject({
      id: "starter",
      annualPriceUSD: 190,
      purchaseState: "available",
    })
    expect(body.data.permanentCreditPacks[0]).toMatchObject({
      id: "perm_200k",
      saleMode: "self_serve",
      dodoProductId: "dodo_pack",
    })
    expect(mocks.resolveAdminCatalogSnapshot).toHaveBeenCalledTimes(1)
  })
})
