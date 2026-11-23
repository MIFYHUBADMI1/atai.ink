import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/errors"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createCatalogProduct: vi.fn(),
  updateCatalogProduct: vi.fn(),
  createCatalogVersion: vi.fn(),
  publishCatalogProduct: vi.fn(),
  archiveCatalogProduct: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/billing/catalog/authoring", () => ({
  createCatalogProduct: mocks.createCatalogProduct,
  updateCatalogProduct: mocks.updateCatalogProduct,
  createCatalogVersion: mocks.createCatalogVersion,
  publishCatalogProduct: mocks.publishCatalogProduct,
  archiveCatalogProduct: mocks.archiveCatalogProduct,
}))

import { POST as createProduct } from "./products/route"
import { PATCH as updateProduct } from "./[productId]/route"
import { POST as createVersion } from "./[productId]/versions/route"
import { POST as publishProduct } from "./[productId]/publish/route"
import { POST as archiveProduct } from "./[productId]/archive/route"

const ADMIN = { id: "admin_1", email: "admin@example.com" }

type Handler = (req: Request, context: { params: Promise<{ productId: string }> }) => Promise<Response>

function request(body: unknown = {}) {
  return new Request("http://localhost/api/admin/billing/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function context(productId = "prod_subscription_studio") {
  return { params: Promise.resolve({ productId }) }
}

const routes: Array<{
  name: string
  handler: Handler
  body?: unknown
  productId?: string
  status?: number
  service: keyof typeof mocks
}> = [
  { name: "create product", handler: createProduct as Handler, body: { type: "subscription" }, status: 201, service: "createCatalogProduct" },
  { name: "update product", handler: updateProduct, body: { expectedUpdatedAt: 1 }, productId: "prod_subscription_studio", service: "updateCatalogProduct" },
  { name: "create version", handler: createVersion, body: { expectedUpdatedAt: 1 }, productId: "prod_subscription_studio", status: 201, service: "createCatalogVersion" },
  { name: "publish product", handler: publishProduct, body: { expectedUpdatedAt: 1 }, productId: "prod_subscription_studio", service: "publishCatalogProduct" },
  { name: "archive product", handler: archiveProduct, body: { expectedUpdatedAt: 1 }, productId: "prod_subscription_studio", service: "archiveCatalogProduct" },
]

describe("A7.2 catalog authoring routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  for (const route of routes) {
    it(`${route.name} refuses non-admin callers before mutating`, async () => {
      mocks.requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))

      const response = await route.handler(request(route.body), context(route.productId))
      expect(response.status).toBe(403)
      expect(mocks[route.service]).not.toHaveBeenCalled()
    })

    it(`${route.name} calls the service with the admin actor`, async () => {
      mocks.requireAdmin.mockResolvedValue(ADMIN as never)
      mocks[route.service].mockResolvedValue({ productId: "prod_subscription_studio" })

      const response = await route.handler(request(route.body), context(route.productId))
      expect(response.status).toBe(route.status ?? 200)
      expect(mocks[route.service]).toHaveBeenCalledWith(
        expect.objectContaining({
          ...(route.productId ? { productId: route.productId } : {}),
          actor: { id: ADMIN.id, email: ADMIN.email },
        }),
      )
    })
  }

  it("returns 201 when creating a product", async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN as never)
    mocks.createCatalogProduct.mockResolvedValue({ productId: "prod_subscription_studio" })

    const response = await createProduct(request({ type: "subscription" }), context())
    expect(response.status).toBe(201)
  })

  it("returns 422 for a validation error", async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN as never)
    mocks.createCatalogProduct.mockRejectedValue(new AppError("VALIDATION", "Invalid product.", 422))

    const response = await createProduct(request({ type: "subscription" }), context())
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.error.code).toBe("VALIDATION")
  })

  it("returns 409 for an optimistic-concurrency conflict", async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN as never)
    mocks.updateCatalogProduct.mockRejectedValue(
      new AppError("CATALOG_CONFLICT", "Product changed.", 409),
    )

    const response = await updateProduct(request({ expectedUpdatedAt: 1 }), context())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.code).toBe("CATALOG_CONFLICT")
  })
})
