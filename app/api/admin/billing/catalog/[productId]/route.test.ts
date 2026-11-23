import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/errors"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getCatalogProduct: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/billing/catalog/service", () => ({
  getCatalogProduct: mocks.getCatalogProduct,
}))

import { GET } from "./route"

const params = (productId: string) => ({ params: Promise.resolve({ productId }) })

describe("GET /api/admin/billing/catalog/[productId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("refuses non-admin callers", async () => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError("UNAUTHORIZED", "Admin access required.", 403),
    )

    const response = await GET(new Request("http://localhost"), params("prod_subscription_starter"))
    expect(response.status).toBe(403)
    expect(mocks.getCatalogProduct).not.toHaveBeenCalled()
  })

  it("returns 404 for an unknown product", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "admin_1" } as never)
    mocks.getCatalogProduct.mockResolvedValue(null)

    const response = await GET(new Request("http://localhost"), params("prod_missing"))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe("NOT_FOUND")
  })

  it("returns the product detail for an admin", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "admin_1" } as never)
    mocks.getCatalogProduct.mockResolvedValue({ id: "prod_subscription_starter" })

    const response = await GET(new Request("http://localhost"), params("prod_subscription_starter"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.product.id).toBe("prod_subscription_starter")
  })
})
