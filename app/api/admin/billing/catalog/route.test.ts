import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/errors"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listCatalogProducts: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/billing/catalog/service", () => ({
  listCatalogProducts: mocks.listCatalogProducts,
}))

import { GET } from "./route"

describe("GET /api/admin/billing/catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("refuses non-admin callers before reading the catalog", async () => {
    mocks.requireAdmin.mockRejectedValue(
      new AppError("UNAUTHORIZED", "Admin access required.", 403),
    )

    const response = await GET()
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.code).toBe("UNAUTHORIZED")
    expect(mocks.listCatalogProducts).not.toHaveBeenCalled()
  })

  it("returns the read-only product list for an admin", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "admin_1" } as never)
    mocks.listCatalogProducts.mockResolvedValue([{ id: "prod_subscription_starter" }])

    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      ok: true,
      data: { products: [{ id: "prod_subscription_starter" }] },
    })
  })
})
