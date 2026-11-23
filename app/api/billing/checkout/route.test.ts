import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

/**
 * Checkout route — commercial catalog + billing cycle.
 *
 * Invariants under test:
 *  - The commercial five-plan catalog is the ONLY sellable catalog: a legacy
 *    plan id is refused, never converted into a purchase.
 *  - Annual checkout uses the plan's ANNUAL Dodo product and stamps
 *    metadata.billingCycle so webhook attribution can persist the cycle.
 *  - When the owner has not provisioned a Dodo product, checkout creates it on
 *    demand at the catalog price and bills that product — never a legacy price.
 *  - The free plan (Explorer) and the custom plan (Enterprise) are not
 *    purchasable through checkout.
 */

const { createSession, getCurrentUser, listProducts, createProduct, getPromotionalOffers } = vi.hoisted(() => ({
  createSession: vi.fn(),
  getCurrentUser: vi.fn(),
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  getPromotionalOffers: vi.fn(),
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

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/billing/runtime-config", () => ({ getPromotionalOffers }))

vi.mock("dodopayments", () => {
  class FakeDodoPayments {
    checkoutSessions = { create: createSession }
    products = { list: listProducts, create: createProduct }
  }
  return { default: FakeDodoPayments, DodoPayments: FakeDodoPayments }
})

const ENV_KEYS = [
  "DODO_COMMERCIAL_PRODUCT_STARTER",
  "DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL",
  "DODO_COMMERCIAL_PRODUCT_GROWTH",
  "DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL",
  "DODO_COMMERCIAL_PRODUCT_SCALE",
]

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function loadRoute() {
  vi.resetModules()
  return (await import("./route")).POST
}

describe("POST /api/billing/checkout — commercial cycles", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
    process.env.DODO_COMMERCIAL_PRODUCT_STARTER = "pdt_starter_m"
    process.env.DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL = "pdt_starter_y"
    process.env.DODO_COMMERCIAL_PRODUCT_GROWTH = "pdt_growth_m"
    process.env.DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL = "pdt_growth_y"
    process.env.DODO_COMMERCIAL_PRODUCT_SCALE = "pdt_scale_m"
    getCurrentUser.mockReset().mockResolvedValue({ id: "u1" })
    createSession.mockReset().mockResolvedValue({
      checkout_url: "https://test.dodopayments.com/checkout/x",
      session_id: "cks_1",
    })
    listProducts.mockReset().mockResolvedValue([])
    createProduct.mockReset().mockResolvedValue({ product_id: "pdt_created" })
    getPromotionalOffers.mockReset().mockResolvedValue([])
  })
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
    vi.resetModules()
  })

  it("monthly commercial checkout uses the monthly product and stamps the cycle", async () => {
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "growth" }))
    expect(res.status).toBe(200)
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "pdt_growth_m", quantity: 1 }])
    expect(session.metadata).toMatchObject({ planId: "growth", billingCycle: "monthly", userId: "u1" })
  })

  it("annual commercial checkout uses the ANNUAL product and stamps billingCycle", async () => {
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "growth", billingCycle: "annual" }))
    expect(res.status).toBe(200)
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "pdt_growth_y", quantity: 1 }])
    expect(session.metadata).toMatchObject({ planId: "growth", billingCycle: "annual" })
    // Credits metadata stays the MONTHLY grant even on annual billing.
    expect(session.metadata.credits).toBe("400000")
  })

  it("creates the annual product on demand at the catalog price when it is not provisioned", async () => {
    delete process.env.DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "growth", billingCycle: "annual" }))
    expect(res.status).toBe(200)
    expect(createProduct).toHaveBeenCalledTimes(1)
    const created = createProduct.mock.calls[0][0]
    expect(created.name).toBe("Atai — Growth — $2199.89/yr")
    expect(created.price.price).toBe(219989)
    expect(created.price.payment_frequency_interval).toBe("Year")
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "pdt_created", quantity: 1 }])
    expect(session.metadata).toMatchObject({ planId: "growth", billingCycle: "annual" })
  })

  it("creates the monthly product on demand at the catalog price when it is not provisioned", async () => {
    delete process.env.DODO_COMMERCIAL_PRODUCT_GROWTH
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "growth" }))
    expect(res.status).toBe(200)
    expect(createProduct).toHaveBeenCalledTimes(1)
    const created = createProduct.mock.calls[0][0]
    expect(created.name).toBe("Atai — Growth — $199.99/mo")
    expect(created.price.price).toBe(19999)
    expect(created.price.payment_frequency_interval).toBe("Month")
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "pdt_created", quantity: 1 }])
  })

  it("stamps a live offer's bonus credits on the checkout metadata", async () => {
    getPromotionalOffers.mockResolvedValue([
      {
        id: "offer_launch",
        name: "Launch bonus",
        description: "",
        status: "active",
        target: "subscription",
        productIds: ["growth"],
        bonusCredits: 25_000,
        startsAt: null,
        endsAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "growth" }))
    expect(res.status).toBe(200)
    const session = createSession.mock.calls[0][0]
    expect(session.metadata).toMatchObject({
      planId: "growth",
      offerId: "offer_launch",
      offerBonusCredits: "25000",
    })
  })

  it("refuses a legacy plan id — the commercial catalog is the only one sold", async () => {
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "business" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe("PLAN_UNAVAILABLE")
    expect(createSession).not.toHaveBeenCalled()
  })

  it("refuses the free Explorer plan — there is nothing to purchase", async () => {
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "explorer" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe("INVALID_REQUEST")
    expect(createSession).not.toHaveBeenCalled()
  })

  it("refuses Enterprise — it is a custom contract", async () => {
    const POST = await loadRoute()
    const res = await POST(post({ type: "subscription", productId: "enterprise" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe("PLAN_UNAVAILABLE")
    expect(createSession).not.toHaveBeenCalled()
  })
})
