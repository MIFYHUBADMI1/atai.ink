import { beforeEach, describe, expect, it, vi } from "vitest"
import { logger } from "@/lib/logging/logger"
import { catalogPublicationChecksum, versionChecksum } from "./code-catalog"
import { previewCatalogPublication } from "./publication-preview"
import { seedCommercialCatalog, type CatalogSeedStore } from "./seed"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "./types"

const BASE = 1_700_000_000_000
const ENV = {
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  DODO_COMMERCIAL_PRODUCT_STARTER: "dodo_starter_m",
  DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL: "dodo_starter_y",
  DODO_COMMERCIAL_PRODUCT_GROWTH: "dodo_growth_m",
  DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL: "dodo_growth_y",
  DODO_COMMERCIAL_PRODUCT_SCALE: "dodo_scale_m",
  DODO_COMMERCIAL_PRODUCT_SCALE_ANNUAL: "dodo_scale_y",
  DODO_PRODUCT_EXPLORER: "dodo_legacy_explorer",
  DODO_PRODUCT_STARTER: "dodo_legacy_starter",
  DODO_PRODUCT_BUSINESS: "dodo_legacy_business",
  DODO_PRODUCT_PROFESSIONAL: "dodo_legacy_professional",
  DODO_PRODUCT_ENTERPRISE: "dodo_legacy_enterprise",
  DODO_PRODUCT_PERM_200K: "dodo_perm_200k",
  DODO_PRODUCT_PERM_500K: "dodo_perm_500k",
  DODO_PRODUCT_PERM_1M: "dodo_perm_1m",
  DODO_PRODUCT_PERM_5M: "dodo_perm_5m",
  DODO_PRODUCT_PERM_15M: "dodo_perm_15m",
} as NodeJS.ProcessEnv

class MemoryStore implements CatalogSeedStore {
  products = new Map<string, CommercialProductDoc>()
  versions = new Map<string, CommercialProductVersionDoc>()
  mappings = new Map<string, DodoProductMappingDoc>()
  catalogVersions = new Map<string, CommercialCatalogVersionDoc>()

  async hasCatalogVersion(version: string) {
    return this.catalogVersions.has(version)
  }
  async upsertProduct(doc: CommercialProductDoc) {
    if (this.products.has(doc.id)) return "existing" as const
    this.products.set(doc.id, structuredClone(doc))
    return "inserted" as const
  }
  async upsertVersion(doc: CommercialProductVersionDoc) {
    const key = `${doc.productId}:${doc.version}`
    if (this.versions.has(key)) return "existing" as const
    this.versions.set(key, structuredClone(doc))
    return "inserted" as const
  }
  async upsertMapping(doc: DodoProductMappingDoc) {
    const key = `${doc.productVersionId}:${doc.cycle}:${doc.environment}`
    if (this.mappings.has(key)) return "existing" as const
    this.mappings.set(key, structuredClone(doc))
    return "inserted" as const
  }
  async upsertCatalogVersion(doc: CommercialCatalogVersionDoc) {
    if (this.catalogVersions.has(doc.version)) return "existing" as const
    this.catalogVersions.set(doc.version, structuredClone(doc))
    return "inserted" as const
  }
  async listProducts() {
    return [...this.products.values()].map((doc) => structuredClone(doc))
  }
  async listVersions() {
    return [...this.versions.values()].map((doc) => structuredClone(doc))
  }
  async listMappings() {
    return [...this.mappings.values()].map((doc) => structuredClone(doc))
  }
  async getCatalogVersion(version: string) {
    const found = this.catalogVersions.get(version)
    return found ? structuredClone(found) : null
  }
  async listCatalogVersions() {
    return [...this.catalogVersions.values()].map((doc) => structuredClone(doc))
  }
  async listBillingDodoProductIds() {
    return []
  }
}

function checksum(publication: CommercialCatalogVersionDoc): string {
  return catalogPublicationChecksum({
    version: publication.version,
    productVersionIds: publication.productVersionIds,
    priceBookVersion: publication.priceBookVersion,
    entitlementVersion: publication.entitlementVersion,
  })
}

async function seededStore() {
  const store = new MemoryStore()
  await seedCommercialCatalog({ store, env: ENV, now: BASE })
  return store
}

function activePublication(ids: string[]): CommercialCatalogVersionDoc {
  const publication: CommercialCatalogVersionDoc = {
    id: "cat_active",
    version: "CATALOG_ACTIVE_V1",
    status: "active",
    productVersionIds: [...ids].sort(),
    priceBookVersion: "PRICE_BOOK_V1",
    entitlementVersion: "ENT_V1",
    publisher: "test",
    publishedAt: BASE - 10_000,
    checksum: "",
  }
  publication.checksum = checksum(publication)
  return publication
}

function candidatePublication(ids: string[]): CommercialCatalogVersionDoc {
  const publication: CommercialCatalogVersionDoc = {
    id: "cat_candidate",
    version: "CATALOG_CANDIDATE_V1",
    status: "candidate",
    productVersionIds: [...ids].sort(),
    priceBookVersion: "PRICE_BOOK_V1",
    entitlementVersion: "ENT_V1",
    publisher: "test",
    publishedAt: BASE,
    checksum: "",
  }
  publication.checksum = checksum(publication)
  return publication
}

function currentIds(products: CommercialProductDoc[]): string[] {
  return products
    .filter((product) => product.status === "published" && product.currentVersionId)
    .map((product) => product.currentVersionId as string)
}

async function storeWithCandidate(name: string, priceMinor?: number) {
  const store = await seededStore()
  const products = await store.listProducts()
  const active = activePublication(currentIds(products))
  await store.upsertCatalogVersion(active)

  const original = [...store.versions.values()].find(
    (version) => version.id === "prod_subscription_starter_v1",
  )
  if (!original) throw new Error("missing starter version")
  const next: CommercialProductVersionDoc = {
    ...structuredClone(original),
    id: "prod_subscription_starter_v2",
    version: 2,
    name,
    priceMinor: priceMinor ?? original.priceMinor,
    checksum: "",
  }
  next.checksum = versionChecksum(next)
  await store.upsertVersion(next)
  const product = store.products.get("prod_subscription_starter")
  if (!product) throw new Error("missing starter product")
  product.currentVersionId = next.id

  const ids = currentIds(await store.listProducts())
  const candidate = candidatePublication(ids)
  await store.upsertCatalogVersion(candidate)
  return { store, candidate, next }
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => {})
  vi.spyOn(logger, "warn").mockImplementation(() => {})
  vi.spyOn(logger, "info").mockImplementation(() => {})
})

describe("A7.3 catalog publication preview", () => {
  it("reports a checkout-compatible candidate and its product changes", async () => {
    const { store } = await storeWithCandidate("Starter Preview")
    const preview = await previewCatalogPublication({ store, now: BASE, env: ENV })

    expect(preview.candidate?.version).toBe("CATALOG_CANDIDATE_V1")
    expect(preview.active?.version).toBe("CATALOG_ACTIVE_V1")
    expect(preview.ready).toBe(true)
    expect(preview.checkoutCompatible).toBe(true)
    expect(preview.diff.changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: "prod_subscription_starter",
          path: "name",
          before: "Starter",
          after: "Starter Preview",
        }),
      ]),
    )
    expect(preview.warnings.join(" ")).toContain("active publication does not resolve cleanly")
  })

  it("blocks a candidate whose price no longer matches checkout", async () => {
    const { store } = await storeWithCandidate("Starter Preview", 100)
    const preview = await previewCatalogPublication({ store, now: BASE, env: ENV })

    expect(preview.ready).toBe(false)
    expect(preview.checkoutCompatible).toBe(false)
    expect(preview.warnings.join(" ")).toContain("not checkout-compatible")
  })

  it("reports an invalid publication checksum as an error", async () => {
    const { store, candidate } = await storeWithCandidate("Starter Preview")
    const stored = store.catalogVersions.get(candidate.version)
    if (!stored) throw new Error("missing candidate")
    stored.checksum = "tampered"

    const preview = await previewCatalogPublication({ store, now: BASE, env: ENV })

    expect(preview.ready).toBe(false)
    expect(preview.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "PUBLICATION_CHECKSUM_INVALID" })]),
    )
  })

  it("blocks a candidate that contains versions effective in the future", async () => {
    const { store, next } = await storeWithCandidate("Starter Preview")
    const stored = store.versions.get(`${next.productId}:${next.version}`)
    if (!stored) throw new Error("missing candidate version")
    stored.effectiveAt = BASE + 60_000

    const preview = await previewCatalogPublication({ store, now: BASE, env: ENV })

    expect(preview.ready).toBe(false)
    expect(preview.warnings.join(" ")).toContain("Activation is blocked until they are due")
  })

  it("returns a non-ready preview when no candidate exists", async () => {
    const store = await seededStore()
    const preview = await previewCatalogPublication({ store, now: BASE, env: ENV })

    expect(preview.candidate).toBeNull()
    expect(preview.ready).toBe(false)
    expect(preview.warnings.join(" ")).toContain("No candidate publication exists")
  })
})
