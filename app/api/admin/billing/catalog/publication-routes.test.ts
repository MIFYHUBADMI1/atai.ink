import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/errors"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  previewCatalogPublication: vi.fn(),
  mongoCatalogSeedStore: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/billing/catalog/publication-preview", () => ({
  previewCatalogPublication: mocks.previewCatalogPublication,
}))
vi.mock("@/lib/billing/catalog/seed", () => ({
  mongoCatalogSeedStore: mocks.mongoCatalogSeedStore,
}))

import { GET as preview } from "./publications/preview/route"

const ADMIN = { id: "admin_1", email: "admin@example.com" }

describe("A7.3 catalog publication routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mongoCatalogSeedStore.mockResolvedValue({})
  })

  it("refuses non-admin callers before reading the catalog", async () => {
    mocks.requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))

    const response = await preview(
      new Request("http://localhost/api/admin/billing/catalog/publications/preview"),
    )
    expect(response.status).toBe(403)
    expect(mocks.previewCatalogPublication).not.toHaveBeenCalled()
  })

  it("returns the preview and forwards a named candidate", async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN as never)
    mocks.previewCatalogPublication.mockResolvedValue({
      candidate: { version: "CATALOG_CANDIDATE_V1" },
      active: null,
      diff: { added: [], removed: [], changed: [] },
      errors: [],
      warnings: [],
      checkoutCompatible: true,
      ready: true,
    })

    const response = await preview(
      new Request(
        "http://localhost/api/admin/billing/catalog/publications/preview?version=CATALOG_CANDIDATE_V1",
      ),
    )
    expect(response.status).toBe(200)
    expect(mocks.previewCatalogPublication).toHaveBeenCalledWith(
      expect.objectContaining({ version: "CATALOG_CANDIDATE_V1" }),
    )
    const body = await response.json()
    expect(body.data.ready).toBe(true)
  })

  it("returns 404 for an unknown named candidate", async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN as never)
    mocks.previewCatalogPublication.mockRejectedValue(
      new AppError("NOT_FOUND", "Candidate publication not found.", 404),
    )

    const response = await preview(
      new Request(
        "http://localhost/api/admin/billing/catalog/publications/preview?version=missing",
      ),
    )
    expect(response.status).toBe(404)
  })
})
