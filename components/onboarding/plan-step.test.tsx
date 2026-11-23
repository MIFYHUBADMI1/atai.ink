import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"

const { PLAN } = vi.hoisted(() => ({
  PLAN: {
    id: "starter",
    name: "SENTINEL_PLAN",
    tagline: "Resolved plan",
    priceUSD: 89.99,
    mirrorCredits: 150_000,
    interval: "monthly",
    active: true,
    features: [],
  },
}))

vi.mock("swr", () => ({
  default: () => ({
    data: { subscription: null, plans: [PLAN] },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

vi.mock("@/lib/client/api", () => ({
  jsonFetcher: vi.fn(),
}))

vi.mock("@/components/billing/checkout-button", () => ({
  CheckoutButton: ({ productId, children }: { productId: string; children?: ReactNode }) => (
    <span data-product={productId}>{children}</span>
  ),
}))

vi.mock("@/components/billing/plan-change-dialog", () => ({
  PlanChangeDialog: () => null,
}))

import { OnboardingPlanStep } from "./plan-step"

describe("onboarding plan step catalog source", () => {
  it("renders plans from the billing overview API", () => {
    const html = renderToStaticMarkup(
      <OnboardingPlanStep selectedPlanId="starter" onSelect={vi.fn()} />,
    )

    expect(html).toContain("SENTINEL_PLAN")
    expect(html).toContain('data-product="starter"')
  })
})
