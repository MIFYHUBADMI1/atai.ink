import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
const { FREE_PLAN, PLAN, PACK } = vi.hoisted(() => ({
  FREE_PLAN: {
    id: "explorer",
    name: "SENTINEL_FREE",
    tagline: "Free",
    priceUSD: 0,
    mirrorCredits: 500,
    interval: "monthly",
    active: true,
    features: [],
  },
  PLAN: {
    id: "starter",
    name: "SENTINEL_PLAN",
    tagline: "Resolved plan",
    priceUSD: 89.99,
    mirrorCredits: 150_000,
    interval: "monthly",
    active: true,
    features: ["Resolved feature"],
  },
  PACK: {
    id: "perm_200k",
    label: "SENTINEL_PACK",
    credits: 200_000,
    priceUSD: 20,
  },
}))

vi.mock("swr", () => ({
  default: () => ({
    data: {
      balance: { total: 100, subscription: 100, permanent: 0 },
      history: [],
      subscription: null,
      usageAlerts: null,
      plans: [FREE_PLAN, PLAN],
      packs: [PACK],
      activeCommercialPlanId: "explorer",
      businessCount: 0,
    },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("@/lib/client/api", () => ({
  useSession: () => ({ session: { id: "user_1" }, isLoading: false }),
  jsonFetcher: vi.fn(),
}))

vi.mock("@/components/settings/settings-shell", () => ({
  SettingsShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/billing/plan-card", () => ({
  PlanCard: ({ plan }: { plan: { name: string } }) => <div>{plan.name}</div>,
}))

vi.mock("@/components/billing/checkout-button", () => ({
  CheckoutButton: ({ productId, children }: { productId: string; children?: ReactNode }) => (
    <span data-product={productId}>{children}</span>
  ),
}))

vi.mock("@/components/billing/cancel-subscription-button", () => ({
  CancelSubscriptionButton: () => null,
}))

vi.mock("@/components/billing/billing-checkout-return", () => ({
  BillingCheckoutReturn: () => null,
}))

import BillingSettingsPage from "./page"

describe("/settings/billing catalog source", () => {
  it("renders plans and packs supplied by the billing overview API", () => {
    const html = renderToStaticMarkup(<BillingSettingsPage />)

    expect(html).toContain("SENTINEL_FREE")
    expect(html).toContain("SENTINEL_PLAN")
    expect(html).toContain("SENTINEL_PACK")
  })
})
