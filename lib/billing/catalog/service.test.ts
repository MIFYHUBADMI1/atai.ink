import { describe, expect, it } from "vitest"
import { seedCommercialCatalog, type CatalogSeedStore } from "./seed"
import { getCatalogProduct, listCatalogProducts } from "./service"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "./types"

const ENV = {
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  DODO_COMMERCIAL_PRODUCT_STARTER: "dodo_starter_m",
  DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL: "dodo_starter_y",
  DODO_PRODUCT_STARTER: "dodo_legacy_starter",
  DODO_PRODUCT_PERM_500K: "dodo_perm_500k",
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
  async listBillingDodoProductIds() {
    return []
  }
}

async function seeded() {
  const store = new MemoryStore()
  await seedCommercialCatalog({ store, env: ENV, now: 1_700_000_000_000 })
  return store
}

describe("A7.0 read-only catalog service", () => {
  it("lists every product grouped by type and marks legacy plans", async () => {
    const products = await listCatalogProducts(await seeded())
    expect(products).toHaveLength(22)
    expect(products.filter((product) => product.type === "credit_pack")).toHaveLength(5)
    expect(products.filter((product) => product.type === "infrastructure")).toHaveLength(6)

    const legacy = products.find((product) => product.id === "prod_legacy_starter")
    expect(legacy?.status).toBe("archived")
    expect(legacy?.legacyRenewalOnly).toBe(true)
    expect(legacy?.saleMode).toBe("legacy_renewal_only")
    expect(legacy?.dodoStatus).toBe("unvalidated")

    const free = products.find((product) => product.id === "prod_legacy_free")
    expect(free?.dodoStatus).toBe("missing")
  })

  it("returns immutable version history for a product detail", async () => {
    const store = await seeded()
    const detail = await getCatalogProduct("prod_subscription_starter", store)
    expect(detail?.name).toBe("Starter")
    expect(detail?.versions).toHaveLength(1)
    expect(detail?.versions[0].priceMinor).toBe(8_999)
    expect(detail?.mappings.map((mapping) => mapping.cycle).sort()).toEqual(["annual", "monthly"])
    expect(detail?.currentVersion?.billingIntervals).toEqual(["monthly", "annual"])
  })

  it("returns null for an unknown product", async () => {
    expect(await getCatalogProduct("prod_missing", await seeded())).toBeNull()
  })
})
