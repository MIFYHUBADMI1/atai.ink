import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDodoConfig: vi.fn(),
  resolveAdminCatalogSnapshot: vi.fn(),
  listProducts: vi.fn(),
  DodoPayments: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/env", () => ({ getDodoConfig: mocks.getDodoConfig }))
vi.mock("@/lib/billing/catalog/admin-context", () => ({
  resolveAdminCatalogSnapshot: mocks.resolveAdminCatalogSnapshot,
}))
vi.mock("dodopayments", () => ({ DodoPayments: mocks.DodoPayments }))

import { GET } from "./route"

describe("GET /api/admin/dodo-products", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ id: "admin_1" })
    mocks.getDodoConfig.mockReturnValue({ apiKey: "test_key", environment: "test_mode" })
    mocks.DodoPayments.mockImplementation(function (this: {
      products: { list: typeof mocks.listProducts }
    }) {
      this.products = { list: mocks.listProducts }
    })
    mocks.listProducts.mockResolvedValue([
      { product_id: "dodo_starter", name: "Starter" },
      { product_id: "dodo_pack", name: "200,000 Credits" },
    ])
    mocks.resolveAdminCatalogSnapshot.mockResolvedValue({
      source: {
        requestedSource: "db",
        adminSource: "db",
        checkoutSource: "db",
        publicReadsEnabled: true,
        gated: false,
        publication: null,
        shadowDifferences: 0,
        error: null,
      },
      plans: [{
        id: "starter",
        name: "Starter",
        tagline: "Start",
        priceUSD: 19,
        annualPriceUSD: null,
        mirrorCredits: 1000,
        interval: "monthly",
        active: true,
        purchaseState: "available",
        annualPurchaseState: "unavailable",
        dodoProductId: "dodo_starter",
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

  it("lists products from the active catalog and reports the source", async () => {
    const response = await GET(new Request("http://localhost/api/admin/dodo-products"))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.data.catalogSource).toMatchObject({
      adminSource: "db",
      checkoutSource: "db",
    })
    expect(body.data.products).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "starter",
        dodoProductId: "dodo_starter",
        dodoStatus: "synced",
        saleMode: "self_serve",
      }),
      expect.objectContaining({
        id: "perm_200k",
        dodoProductId: "dodo_pack",
        dodoStatus: "synced",
        saleMode: "self_serve",
      }),
    ]))
  })
})
