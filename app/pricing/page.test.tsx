import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
const { PLAN, PACK } = vi.hoisted(() => ({
  PLAN: {
    id: "starter",
    name: "SENTINEL_PLAN",
    tagline: "Resolved plan",
    priceUSD: 89.99,
    mirrorCredits: 150_000,
    interval: "monthly",
    active: true,
    features: ["Resolved feature"],
    purchaseState: "available",
    annualPurchaseState: "soon",
  },
  PACK: {
    id: "perm_200k",
    label: "SENTINEL_PACK",
    credits: 200_000,
    priceUSD: 20,
  },
}))

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "user_1" })),
}))

vi.mock("@/lib/billing/runtime-config", () => ({
  getBuildTierCosts: vi.fn(async () => ({ simple: 50_000, medium: 75_000, complex: 100_000 })),
  getMirrorPipelineCosts: vi.fn(async () => ({
    scrapeCost: 5,
    heavyScrapeCost: 100,
    planCost: 5,
    heavyPlanCost: 100,
    deepCrawlCost: 500,
    heavyDeepCrawlCost: 1_000,
  })),
  getDeploymentCosts: vi.fn(async () => ({ deployCost: 10_000 })),
  getSeoAuditCosts: vi.fn(async () => ({ auditCost: 100 })),
  getRewardSettings: vi.fn(async () => ({
    welcomeBonus: 500,
    referralSignupBonus: 500,
    referralVerificationReward: 500,
    referralMilestoneReward: 1_500,
    referralMilestoneThreshold: 75_000,
  })),
  getPromotionalOffers: vi.fn(async () => []),
  getVisualPricing: vi.fn(async () => ({
    markup: 1.45,
    creditsPerUsd: 4000,
    fallbackCredits: 1600,
    estimatedCredits: 1000,
  })),
}))

vi.mock("@/lib/billing/catalog/published-resolver", () => ({
  resolvePublicCommercialCatalog: vi.fn(async () => ({
    source: "db",
    plans: [PLAN],
    packs: [PACK],
  })),
}))

vi.mock("@/components/site-header", () => ({
  SiteHeader: () => null,
}))

vi.mock("@/components/site-footer", () => ({
  SiteFooter: () => null,
}))

vi.mock("@/components/billing/pricing-plan-grid", () => ({
  PricingPlanGrid: ({ plans }: { plans: Array<{ id: string; name: string }> }) => (
    <div data-testid="pricing-grid">
      {plans.map((plan) => (
        <span key={plan.id}>{plan.name}</span>
      ))}
    </div>
  ),
}))

vi.mock("@/components/billing/checkout-button", () => ({
  CheckoutButton: ({ productId, children }: { productId: string; children?: ReactNode }) => (
    <span data-product={productId}>{children}</span>
  ),
}))

vi.mock("@/components/auth/auth-trigger", () => ({
  AuthTrigger: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

import PricingPage from "./page"
import { resolvePublicCommercialCatalog } from "@/lib/billing/catalog/published-resolver"

describe("/pricing catalog source", () => {
  it("renders plans and packs from the published resolver", async () => {
    const html = renderToStaticMarkup(await PricingPage())

    expect(html).toContain("SENTINEL_PLAN")
    expect(html).toContain("perm_200k")
    expect(resolvePublicCommercialCatalog).toHaveBeenCalledTimes(1)
  })
})
