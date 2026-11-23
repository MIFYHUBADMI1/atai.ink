import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ResolvedCommercialCatalog } from "./published-resolver"

const { resolveCommercialCatalog } = vi.hoisted(() => ({
  resolveCommercialCatalog: vi.fn(),
}))

vi.mock("./published-resolver", () => ({
  resolveCommercialCatalog,
  PublishedCatalogError: class PublishedCatalogError extends Error {
    readonly reason: string
    constructor(reason: string) {
      super("Pricing is temporarily unavailable")
      this.reason = reason
    }
  },
}))

import { resolveAdminCatalogSnapshot } from "./admin-context"

function catalog(overrides: Partial<ResolvedCommercialCatalog> = {}): ResolvedCommercialCatalog {
  return {
    source: "code",
    requestedSource: "code",
    publicReadsEnabled: false,
    gated: false,
    publication: null,
    entries: [],
    plans: [],
    packs: [],
    infrastructure: [],
    shadow: { compared: false, differences: [] },
    ...overrides,
  }
}

const publication = {
  id: "pub_1",
  version: "2026-11-22.1",
  status: "active" as const,
  productVersionIds: ["v1", "v2"],
  priceBookVersion: "pb_1",
  entitlementVersion: "ent_1",
  publisher: "admin",
  publishedAt: 1,
  checksum: "abc",
}

describe("resolveAdminCatalogSnapshot", () => {
  beforeEach(() => {
    resolveCommercialCatalog.mockReset()
  })

  it("reports the code catalog when code is selected", async () => {
    resolveCommercialCatalog.mockResolvedValue(catalog())

    const snapshot = await resolveAdminCatalogSnapshot({ CATALOG_SOURCE: "code" })

    expect(snapshot.source).toMatchObject({
      requestedSource: "code",
      adminSource: "code",
      checkoutSource: "code",
      gated: false,
      error: null,
      publication: null,
    })
  })

  it("reports the database catalog for both admin and checkout when public reads are enabled", async () => {
    resolveCommercialCatalog.mockResolvedValue(
      catalog({ source: "db", requestedSource: "db", publicReadsEnabled: true, publication }),
    )

    const snapshot = await resolveAdminCatalogSnapshot({
      CATALOG_SOURCE: "db",
      CATALOG_DB_PUBLIC_READS: "enabled",
    })

    expect(snapshot.source).toMatchObject({
      requestedSource: "db",
      adminSource: "db",
      checkoutSource: "db",
      publicReadsEnabled: true,
      gated: false,
      error: null,
      publication: {
        version: "2026-11-22.1",
        productCount: 2,
        checksum: "abc",
      },
    })
  })

  it("shows database values to admins while checkout remains on code when public reads are gated", async () => {
    resolveCommercialCatalog.mockResolvedValue(
      catalog({ source: "db", requestedSource: "db", publication }),
    )

    const snapshot = await resolveAdminCatalogSnapshot({ CATALOG_SOURCE: "db" })

    expect(snapshot.source).toMatchObject({
      adminSource: "db",
      checkoutSource: "code",
      gated: true,
      error: null,
    })
    expect(snapshot.source.publication?.version).toBe("2026-11-22.1")
  })

  it("falls back to code values but reports an unavailable public source when a selected database catalog fails", async () => {
    const { PublishedCatalogError } = await import("./published-resolver")
    resolveCommercialCatalog
      .mockRejectedValueOnce(new PublishedCatalogError("NO_ACTIVE_PUBLICATION"))
      .mockResolvedValueOnce(catalog())

    const snapshot = await resolveAdminCatalogSnapshot({
      CATALOG_SOURCE: "db",
      CATALOG_DB_PUBLIC_READS: "enabled",
    })

    expect(resolveCommercialCatalog).toHaveBeenLastCalledWith({
      env: expect.objectContaining({ CATALOG_SOURCE: "code" }),
    })
    expect(snapshot.source).toMatchObject({
      adminSource: "code",
      checkoutSource: "unavailable",
      error: "NO_ACTIVE_PUBLICATION",
    })
  })

  it("keeps checkout on code when public reads are gated even if the database read fails", async () => {
    const { PublishedCatalogError } = await import("./published-resolver")
    resolveCommercialCatalog
      .mockRejectedValueOnce(new PublishedCatalogError("DB_UNAVAILABLE"))
      .mockResolvedValueOnce(catalog())

    const snapshot = await resolveAdminCatalogSnapshot({ CATALOG_SOURCE: "db" })

    expect(snapshot.source).toMatchObject({
      adminSource: "code",
      checkoutSource: "code",
      gated: true,
      error: "DB_UNAVAILABLE",
    })
  })
})
