import { beforeEach, describe, expect, it, vi } from "vitest"

const { createSession, getCurrentUser, resolvePublicCommercialCatalog } = vi.hoisted(() => ({
  createSession: vi.fn(),
  getCurrentUser: vi.fn(),
  resolvePublicCommercialCatalog: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }))
vi.mock("@/lib/env", () => ({
  getDodoConfig: () => ({ apiKey: "test_key", environment: "test_mode" }),
}))
vi.mock("@/lib/cache/locks", () => ({
  checkoutRateLimiter: { allowed: () => true },
  checkoutSessionLocks: { acquire: () => () => {} },
  productCreationLocks: { acquire: () => () => {} },
}))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => {}) }))
vi.mock("@/lib/billing/currency", () => ({
  detectCountryFromRequest: vi.fn(async () => undefined),
  resolveBillingCurrency: vi.fn(() => undefined),
}))
vi.mock("@/lib/billing/checkout-return", () => ({
  checkoutReturnUrl: () => "https://atai.ink/settings/billing",
}))

vi.mock("@/lib/billing/runtime-config", () => ({ getPromotionalOffers: vi.fn(async () => []) }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/billing/catalog/published-resolver", () => ({
  resolvePublicCommercialCatalog,
  PublishedCatalogError: class PublishedCatalogError extends Error {
    reason = "DB_UNAVAILABLE"
  },
}))
vi.mock("dodopayments", () => {
  class FakeDodoPayments {
    checkoutSessions = { create: createSession }
    products = { list: vi.fn(), create: vi.fn() }
  }
  return { default: FakeDodoPayments, DodoPayments: FakeDodoPayments }
})

import { POST } from "./route"

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    source: "db",
    requestedSource: "db",
    publicReadsEnabled: true,
    gated: false,
    publication: null,
    entries: [],
    plans: [
      {
        id: "growth",
        name: "Growth DB",
        tagline: "Database catalog",
        priceUSD: 199.99,
        annualPriceUSD: 2199.89,
        mirrorCredits: 400_000,
        interval: "monthly",
        active: true,
        features: [],
        dodoProductId: "db_growth_m",
        annualDodoProductId: "db_growth_y",
        commercialPlanId: "growth",
      },
    ],
    packs: [
      {
        id: "perm_500k",
        credits: 500_000,
        priceUSD: 119,
        label: "500,000 Credits",
        dodoProductId: "db_perm_500k",
      },
    ],
    infrastructure: [],
    shadow: { compared: true, differences: [] },
    ...overrides,
  }
}

describe("POST /api/billing/checkout — active database catalog", () => {
  beforeEach(() => {
    getCurrentUser.mockReset().mockResolvedValue({ id: "u1" })
    createSession.mockReset().mockResolvedValue({
      checkout_url: "https://test.dodopayments.com/checkout/x",
      session_id: "cks_1",
    })
    resolvePublicCommercialCatalog.mockReset().mockResolvedValue(catalog())
  })

  it("uses the database subscription product and price", async () => {
    const response = await POST(
      post({ type: "subscription", productId: "growth", billingCycle: "annual" }),
    )
    expect(response.status).toBe(200)
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "db_growth_y", quantity: 1 }])
    expect(session.metadata).toMatchObject({
      planId: "growth",
      billingCycle: "annual",
      credits: "400000",
      userId: "u1",
    })
  })

  it("uses the database credit pack and its provisioned Dodo product", async () => {
    const response = await POST(post({ type: "permanent", productId: "perm_500k" }))
    expect(response.status).toBe(200)
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "db_perm_500k", quantity: 1 }])
    expect(session.metadata).toMatchObject({
      type: "permanent",
      packageId: "perm_500k",
      credits: "500000",
    })
  })

  it("refuses a credit pack that is not self-serve", async () => {
    const current = catalog()
    current.packs = [{ ...current.packs[0], saleMode: "contact" }]
    resolvePublicCommercialCatalog.mockResolvedValue(current)

    const response = await POST(post({ type: "permanent", productId: "perm_500k" }))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe("PLAN_UNAVAILABLE")
    expect(createSession).not.toHaveBeenCalled()
  })

  it("refuses a plan whose purchase state is not available", async () => {
    const current = catalog()
    current.plans = [{ ...current.plans[0], purchaseState: "soon" }]
    resolvePublicCommercialCatalog.mockResolvedValue(current)

    const response = await POST(post({ type: "subscription", productId: "growth" }))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe("PLAN_UNAVAILABLE")
    expect(createSession).not.toHaveBeenCalled()
  })

  it("refuses a plan that the active database catalog does not sell", async () => {
    resolvePublicCommercialCatalog.mockResolvedValue(catalog({ plans: [] }))
    const response = await POST(post({ type: "subscription", productId: "growth" }))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe("PLAN_UNAVAILABLE")
    expect(createSession).not.toHaveBeenCalled()
  })
})
