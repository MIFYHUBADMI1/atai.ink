import { beforeEach, describe, expect, it, vi } from "vitest"
import { logger } from "@/lib/logging/logger"
import { catalogPublicationChecksum } from "./code-catalog"
import { resolveRuntimeCatalogProduct } from "./runtime"
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
const DB_ENV = {
  ...ENV,
  CATALOG_SOURCE: "db",
  CATALOG_DB_PUBLIC_READS: "enabled",
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

async function activeStore() {
  const store = new MemoryStore()
  await seedCommercialCatalog({ store, env: ENV, now: BASE })
  const products = await store.listProducts()
  const ids = products
    .filter((product) => product.status === "published" && product.currentVersionId)
    .map((product) => product.currentVersionId as string)
  const publication: CommercialCatalogVersionDoc = {
    id: "CATALOG_ACTIVE_V1",
    version: "CATALOG_ACTIVE_V1",
    status: "active",
    productVersionIds: [...ids].sort(),
    priceBookVersion: "PRICE_BOOK_V1",
    entitlementVersion: "ENT_V1",
    publisher: "test",
    publishedAt: BASE,
    checksum: "",
  }
  publication.checksum = catalogPublicationChecksum({
    version: publication.version,
    productVersionIds: publication.productVersionIds,
    priceBookVersion: publication.priceBookVersion,
    entitlementVersion: publication.entitlementVersion,
  })
  await store.upsertCatalogVersion(publication)
  return store
}

beforeEach(() => {
  vi.spyOn(logger, "warn").mockImplementation(() => {})
  vi.spyOn(logger, "error").mockImplementation(() => {})
  vi.spyOn(logger, "info").mockImplementation(() => {})
})

describe("A7.5 runtime catalog product resolution", () => {
  it("resolves a monthly subscription by its Dodo product id", async () => {
    const store = await activeStore()
    const product = await resolveRuntimeCatalogProduct({
      dodoProductId: "dodo_growth_m",
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(product).toMatchObject({
      planId: "growth",
      planName: "Growth",
      productType: "subscription",
      billingCycle: "monthly",
      monthlyCredits: 400_000,
      dodoProductId: "dodo_growth_m",
      commercialPlanId: "growth",
    })
    expect(product?.entitlementSnapshot?.commercialPlanId).toBe("growth")
  })

  it("resolves an annual subscription and its annual price", async () => {
    const store = await activeStore()
    const product = await resolveRuntimeCatalogProduct({
      dodoProductId: "dodo_growth_y",
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(product).toMatchObject({
      planId: "growth",
      billingCycle: "annual",
      priceMinor: 219_989,
    })
  })

  it("resolves a credit pack by its one-time Dodo product id", async () => {
    const store = await activeStore()
    const product = await resolveRuntimeCatalogProduct({
      dodoProductId: "dodo_perm_500k",
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(product).toMatchObject({
      planId: "perm_500k",
      productType: "credit_pack",
      billingCycle: "one_time",
      oneTimeCredits: 500_000,
      priceMinor: 11_900,
    })
  })

  it("falls back to the plan alias when the Dodo id is not mapped", async () => {
    const store = await activeStore()
    const product = await resolveRuntimeCatalogProduct({
      planId: "starter",
      billingCycle: "annual",
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(product).toMatchObject({ planId: "starter", billingCycle: "annual" })
  })

  it("returns null when database public reads are gated", async () => {
    const store = await activeStore()
    const product = await resolveRuntimeCatalogProduct({
      dodoProductId: "dodo_growth_m",
      env: { ...ENV, CATALOG_SOURCE: "db" } as NodeJS.ProcessEnv,
      store,
      now: BASE,
    })

    expect(product).toBeNull()
  })

  it("returns null when the active publication is invalid", async () => {
    const store = await activeStore()
    const publication = store.catalogVersions.get("CATALOG_ACTIVE_V1")
    if (!publication) throw new Error("missing active publication")
    publication.checksum = "tampered"

    const product = await resolveRuntimeCatalogProduct({
      dodoProductId: "dodo_growth_m",
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(product).toBeNull()
  })
})
