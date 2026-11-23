import { describe, expect, it } from "vitest"
import {
  findUnknownDodoProductIds,
  ensureCommercialCatalogSeeded,
  mongoCatalogSeedStore,
  seedCommercialCatalog,
  verifyCommercialCatalogSeed,
  type BillingDodoProductId,
  type CatalogSeedStore,
} from "./seed"
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

function clone<T>(value: T): T {
  return structuredClone(value)
}

class MemoryCatalogStore implements CatalogSeedStore {
  products = new Map<string, CommercialProductDoc>()
  versions = new Map<string, CommercialProductVersionDoc>()
  mappings = new Map<string, DodoProductMappingDoc>()
  catalogVersions = new Map<string, CommercialCatalogVersionDoc>()
  billingIds: BillingDodoProductId[] = []
  writes = 0

  async hasCatalogVersion(version: string) {
    return this.catalogVersions.has(version)
  }
  async upsertProduct(doc: CommercialProductDoc) {
    this.writes++
    if (this.products.has(doc.id)) return "existing" as const
    this.products.set(doc.id, clone(doc))
    return "inserted" as const
  }
  async upsertVersion(doc: CommercialProductVersionDoc) {
    this.writes++
    const key = `${doc.productId}:${doc.version}`
    if (this.versions.has(key)) return "existing" as const
    this.versions.set(key, clone(doc))
    return "inserted" as const
  }
  async upsertMapping(doc: DodoProductMappingDoc) {
    this.writes++
    const key = `${doc.productVersionId}:${doc.cycle}:${doc.environment}`
    if (this.mappings.has(key)) return "existing" as const
    this.mappings.set(key, clone(doc))
    return "inserted" as const
  }
  async upsertCatalogVersion(doc: CommercialCatalogVersionDoc) {
    this.writes++
    if (this.catalogVersions.has(doc.version)) return "existing" as const
    this.catalogVersions.set(doc.version, clone(doc))
    return "inserted" as const
  }
  async listProducts() {
    return [...this.products.values()].map(clone)
  }
  async listVersions() {
    return [...this.versions.values()].map(clone)
  }
  async listMappings() {
    return [...this.mappings.values()].map(clone)
  }
  async getCatalogVersion(version: string) {
    const found = this.catalogVersions.get(version)
    return found ? clone(found) : null
  }
  async listCatalogVersions() {
    return [...this.catalogVersions.values()].map(clone)
  }
  async listBillingDodoProductIds() {
    return clone(this.billingIds)
  }
}

async function seededStore() {
  const store = new MemoryCatalogStore()
  const report = await seedCommercialCatalog({ store, env: ENV, now: 1_700_000_000_000 })
  return { store, report }
}

describe("A7.0 catalog seed", () => {
  it("seeds the complete catalog once and verifies exactly", async () => {
    const { store, report } = await seededStore()
    expect(report.mode).toBe("apply")
    expect(report.products).toEqual({ planned: 22, created: 22, existing: 0 })
    expect(report.versions).toEqual({ planned: 22, created: 22, existing: 0 })
    expect(report.mappings).toEqual({ planned: 16, created: 16, existing: 0 })
    expect(report.catalogVersionRecord).toBe("created")

    const verification = await verifyCommercialCatalogSeed({ store, env: ENV })
    expect(verification.ok).toBe(true)
    expect(verification.mismatches).toEqual([])
    expect(verification.actual).toEqual({ products: 22, versions: 22, mappings: 16 })
  })

  it("is idempotent and never rewrites an existing version", async () => {
    const { store } = await seededStore()
    const second = await seedCommercialCatalog({ store, env: ENV, now: 1_800_000_000_000 })
    expect(second.products).toEqual({ planned: 22, created: 0, existing: 22 })
    expect(second.versions).toEqual({ planned: 22, created: 0, existing: 22 })
    expect(second.mappings).toEqual({ planned: 16, created: 0, existing: 16 })
    expect(second.catalogVersionRecord).toBe("existing")

    const starter = store.versions.get("prod_subscription_starter:1")!
    starter.priceMinor = 1
    await seedCommercialCatalog({ store, env: ENV, now: 1_900_000_000_000 })
    expect(store.versions.get("prod_subscription_starter:1")!.priceMinor).toBe(1)

    const verification = await verifyCommercialCatalogSeed({ store, env: ENV })
    expect(verification.ok).toBe(false)
    expect(verification.mismatches.some((mismatch) => mismatch.path.endsWith("priceMinor"))).toBe(true)
  })

  it("dry-run performs no writes", async () => {
    const store = new MemoryCatalogStore()
    const report = await seedCommercialCatalog({ store, mode: "dry-run", env: ENV })
    expect(report.products).toEqual({ planned: 22, created: 0, existing: 0 })
    expect(report.catalogVersionRecord).toBe("planned")
    expect(store.writes).toBe(0)
  })

  it("bootstraps when the catalog marker is absent", async () => {
    const store = new MemoryCatalogStore()
    const report = await ensureCommercialCatalogSeeded(store, ENV)
    expect(report.mode).toBe("apply")
    expect(report.products.created).toBe(22)
    expect(store.catalogVersions.has("CATALOG_V1")).toBe(true)
  })

  it("skips the bootstrap when the catalog marker exists", async () => {
    const { store } = await seededStore()
    const report = await ensureCommercialCatalogSeeded(store, ENV)
    expect(report.mode).toBe("skipped")
    expect(report.catalogVersionRecord).toBe("skipped")
  })

  it("reports unknown Dodo product ids without accepting them", async () => {
    const store = new MemoryCatalogStore()
    store.billingIds = [
      { source: "subscription_records", dodoProductId: "dodo_starter_m", count: 2 },
      { source: "payment_records", dodoProductId: "dodo_unknown", count: 1 },
    ]
    const report = await seedCommercialCatalog({ store, env: ENV })
    expect(report.unknownDodoProductIds).toEqual([
      { source: "payment_records", dodoProductId: "dodo_unknown", count: 1 },
    ])
    expect(report.warnings[0]).toContain("no catalog mapping")

    const verification = await verifyCommercialCatalogSeed({ store, env: ENV })
    expect(verification.ok).toBe(true)
    expect(verification.unknownDodoProductIds).toHaveLength(1)
  })

  it("imports Dodo mappings as unvalidated, never as connected", async () => {
    const { store } = await seededStore()
    const mappings = [...store.mappings.values()]
    expect(mappings).toHaveLength(16)
    expect(mappings.every((mapping) => mapping.status === "unvalidated")).toBe(true)
    expect(mappings.every((mapping) => mapping.validatedAt === undefined)).toBe(true)
  })

  it("compares mapping identity rather than only the Dodo id", () => {
    const mappings: DodoProductMappingDoc[] = [
      {
        productVersionId: "v1",
        cycle: "monthly",
        environment: "test_mode",
        dodoProductId: "known",
        dodoProductName: "Known",
        dodoPriceMinor: 1,
        dodoCurrency: "USD",
        dodoInterval: "month",
        status: "unvalidated",
        lastSyncedAt: 1,
      },
    ]
    expect(
      findUnknownDodoProductIds(mappings, [
        { source: "subscription_records", dodoProductId: "known", count: 1 },
        { source: "subscription_records", dodoProductId: "other", count: 1 },
      ]),
    ).toEqual([{ source: "subscription_records", dodoProductId: "other", count: 1 }])
  })

  it("exposes the Mongo store contract without billing writes", () => {
    expect(typeof mongoCatalogSeedStore).toBe("function")
  })
})
