import { beforeEach, describe, expect, it, vi } from "vitest"
import { logger } from "@/lib/logging/logger"
import {
  CATALOG_VERSION,
  catalogPublicationChecksum,
  versionChecksum,
} from "./code-catalog"
import {
  PublishedCatalogError,
  resolveCommercialCatalog,
  resolveHistoricalCatalogEntry,
  resolvePublicCommercialCatalog,
} from "./published-resolver"
import {
  seedCommercialCatalog,
  type BillingDodoProductId,
  type CatalogSeedStore,
} from "./seed"
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

const DB_ENV = { ...ENV, CATALOG_SOURCE: "db" } as NodeJS.ProcessEnv
const PUBLIC_DB_ENV = {
  ...DB_ENV,
  CATALOG_DB_PUBLIC_READS: "enabled",
} as NodeJS.ProcessEnv

class MemoryStore implements CatalogSeedStore {
  products = new Map<string, CommercialProductDoc>()
  versions = new Map<string, CommercialProductVersionDoc>()
  mappings = new Map<string, DodoProductMappingDoc>()
  catalogVersions = new Map<string, CommercialCatalogVersionDoc>()
  billingIds: BillingDodoProductId[] = []

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
    return structuredClone(this.billingIds)
  }
}

async function seededStore() {
  const store = new MemoryStore()
  await seedCommercialCatalog({ store, env: ENV, now: BASE })
  return store
}

async function activeStore() {
  const store = await seededStore()
  await activate(store)
  return store
}

async function activate(
  store: MemoryStore,
  productVersionIds?: string[],
): Promise<CommercialCatalogVersionDoc> {
  const seeded = await store.getCatalogVersion(CATALOG_VERSION)
  const products = await store.listProducts()
  const ids =
    productVersionIds ??
    products
      .filter((product) => product.status === "published" && product.currentVersionId)
      .map((product) => product.currentVersionId as string)
  const publication: CommercialCatalogVersionDoc = {
    id: "cat_active_test",
    version: "CATALOG_ACTIVE_V1",
    status: "active",
    productVersionIds: ids,
    priceBookVersion: seeded?.priceBookVersion ?? "PRICE_BOOK_V1",
    entitlementVersion: seeded?.entitlementVersion ?? "ENT_V1",
    publisher: "test",
    publishedAt: BASE,
    checksum: "",
  }
  publication.checksum = publicationChecksum(publication)
  await store.upsertCatalogVersion(publication)
  return publication
}

function publicationChecksum(publication: CommercialCatalogVersionDoc): string {
  return catalogPublicationChecksum({
    version: publication.version,
    productVersionIds: publication.productVersionIds,
    priceBookVersion: publication.priceBookVersion,
    entitlementVersion: publication.entitlementVersion,
  })
}

function refreshPublication(store: MemoryStore, publication: CommercialCatalogVersionDoc) {
  const stored = store.catalogVersions.get(publication.version)
  if (!stored) throw new Error("missing publication")
  stored.checksum = publicationChecksum(stored)
}

function refreshVersion(store: MemoryStore, version: CommercialProductVersionDoc) {
  const stored = store.versions.get(`${version.productId}:${version.version}`)
  if (!stored) throw new Error("missing version")
  stored.checksum = versionChecksum(stored)
}

function getVersion(store: MemoryStore, versionId: string): CommercialProductVersionDoc {
  const version = [...store.versions.values()].find((candidate) => candidate.id === versionId)
  if (!version) throw new Error(`missing version ${versionId}`)
  return version
}

function getProduct(store: MemoryStore, productId: string): CommercialProductDoc {
  const product = store.products.get(productId)
  if (!product) throw new Error(`missing product ${productId}`)
  return product
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => {})
  vi.spyOn(logger, "warn").mockImplementation(() => {})
  vi.spyOn(logger, "info").mockImplementation(() => {})
})

describe("A7.1 published catalog resolver", () => {
  it("uses the existing code catalog and never touches the database when source=code", async () => {
    const store = new MemoryStore()
    store.listProducts = async () => {
      throw new Error("database must not be read")
    }

    const resolved = await resolveCommercialCatalog({
      env: { CATALOG_SOURCE: "code" } as NodeJS.ProcessEnv,
      store,
      now: BASE,
    })

    expect(resolved.source).toBe("code")
    expect(resolved.requestedSource).toBe("code")
    expect(resolved.gated).toBe(false)
    expect(resolved.publication).toBeNull()
    expect(resolved.plans.map((plan) => plan.id)).toEqual([
      "explorer",
      "starter",
      "growth",
      "scale",
      "enterprise",
    ])
    expect(resolved.packs).toHaveLength(5)
  })

  it("gates db source away from public traffic until explicitly enabled", async () => {
    const store = await activeStore()

    const resolved = await resolvePublicCommercialCatalog({
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(resolved.source).toBe("code")
    expect(resolved.requestedSource).toBe("db")
    expect(resolved.publicReadsEnabled).toBe(false)
    expect(resolved.gated).toBe(true)
    expect(resolved.publication).toBeNull()
  })

  it("returns only products in the active published publication", async () => {
    const store = await activeStore()

    const resolved = await resolveCommercialCatalog({
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(resolved.source).toBe("db")
    expect(resolved.publication?.version).toBe("CATALOG_ACTIVE_V1")
    expect(resolved.plans.map((plan) => plan.id)).toEqual([
      "explorer",
      "starter",
      "growth",
      "scale",
      "enterprise",
    ])
    expect(resolved.packs).toHaveLength(5)
    expect(resolved.infrastructure).toHaveLength(6)
    expect(resolved.entries.some((entry) => entry.product.id.startsWith("prod_legacy_"))).toBe(false)
    expect(resolved.entries.some((entry) => entry.product.id.startsWith("prod_subscription_"))).toBe(true)
  })

  it("rejects a database catalog with no active publication", async () => {
    const store = await seededStore()

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "NO_ACTIVE_PUBLICATION" })
  })

  it("rejects multiple active publications", async () => {
    const store = await activeStore()
    const second: CommercialCatalogVersionDoc = {
      id: "cat_active_two",
      version: "CATALOG_ACTIVE_V2",
      status: "active",
      productVersionIds: (await store.getCatalogVersion("CATALOG_ACTIVE_V1"))?.productVersionIds ?? [],
      priceBookVersion: "PRICE_BOOK_V1",
      entitlementVersion: "ENT_V1",
      publisher: "test",
      publishedAt: BASE,
      checksum: "",
    }
    second.checksum = publicationChecksum(second)
    await store.upsertCatalogVersion(second)

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "MULTIPLE_ACTIVE_PUBLICATIONS" })
  })

  it("rejects a publication checksum mismatch", async () => {
    const store = await activeStore()
    const publication = await store.getCatalogVersion("CATALOG_ACTIVE_V1")
    if (!publication) throw new Error("missing publication")
    publication.checksum = "tampered"
    store.catalogVersions.set(publication.version, publication)

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "PUBLICATION_CHECKSUM_INVALID" })
  })


  it("does not touch the database for a gated public read", async () => {
    const store = new MemoryStore()
    store.listProducts = async () => {
      throw new Error("gated public reads must not touch the database")
    }

    const resolved = await resolvePublicCommercialCatalog({
      env: DB_ENV,
      store,
      now: BASE,
    })

    expect(resolved.source).toBe("code")
    expect(resolved.gated).toBe(true)
    expect(resolved.plans.map((plan) => plan.id)).toEqual([
      "explorer",
      "starter",
      "growth",
      "scale",
      "enterprise",
    ])
  })

  it("rejects a missing version in the publication", async () => {
    const store = await activeStore()
    const publication = await store.getCatalogVersion("CATALOG_ACTIVE_V1")
    if (!publication) throw new Error("missing publication")
    publication.productVersionIds = [...publication.productVersionIds, "missing_version"]
    store.catalogVersions.set(publication.version, publication)
    refreshPublication(store, publication)

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "VERSION_MISSING" })
  })

  it("rejects an archived product included in the publication", async () => {
    const store = await activeStore()
    getProduct(store, "prod_subscription_starter").status = "archived"

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "PRODUCT_NOT_PUBLISHED" })
  })

  it("rejects a product-version checksum mismatch", async () => {
    const store = await activeStore()
    const version = getVersion(store, "prod_subscription_starter_v1")
    version.checksum = "tampered"

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "VERSION_CHECKSUM_INVALID" })
  })

  it("rejects a draft product included in the publication", async () => {
    const store = await activeStore()
    getProduct(store, "prod_subscription_starter").status = "draft"

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "PRODUCT_NOT_PUBLISHED" })
  })

  it("rejects a product whose current version is not the published version", async () => {
    const store = await activeStore()
    getProduct(store, "prod_subscription_starter").currentVersionId = "prod_subscription_growth_v1"

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "PRODUCT_VERSION_MISMATCH" })
  })

  it("rejects duplicate product membership in the publication", async () => {
    const store = await activeStore()
    const publication = await store.getCatalogVersion("CATALOG_ACTIVE_V1")
    if (!publication) throw new Error("missing publication")
    publication.productVersionIds = [
      ...publication.productVersionIds,
      publication.productVersionIds[0],
    ]
    store.catalogVersions.set(publication.version, publication)
    refreshPublication(store, publication)

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "PUBLICATION_MEMBERSHIP_INVALID" })
  })

  it("excludes a future-effective version and reports the shadow difference", async () => {
    const store = await activeStore()
    const version = getVersion(store, "prod_subscription_starter_v1")
    version.effectiveAt = BASE + 60_000
    refreshVersion(store, version)

    const resolved = await resolveCommercialCatalog({ env: DB_ENV, store, now: BASE })

    expect(resolved.plans.some((plan) => plan.id === "starter")).toBe(false)
    expect(resolved.shadow.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "plans.starter", expected: "present", actual: "missing" }),
      ]),
    )
  })

  it("returns a typed error and no fallback when the database is unavailable", async () => {
    const store = await activeStore()
    store.listProducts = async () => {
      throw new Error("mongo unavailable")
    }

    const error = await resolveCommercialCatalog({
      env: DB_ENV,
      store,
      now: BASE,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PublishedCatalogError)
    expect(error).toMatchObject({
      reason: "DB_UNAVAILABLE",
      code: "CATALOG_UNAVAILABLE",
      status: 503,
    })
  })

  it("does not fall back when public db reads are enabled and the database is unavailable", async () => {
    const store = await activeStore()
    store.listVersions = async () => {
      throw new Error("mongo unavailable")
    }

    await expect(
      resolvePublicCommercialCatalog({ env: PUBLIC_DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "DB_UNAVAILABLE" })
  })

  it("uses the active database publication for public reads when the gate is enabled", async () => {
    const store = await activeStore()
    const version = getVersion(store, "prod_subscription_starter_v1")
    version.name = "Starter Database"
    refreshVersion(store, version)

    const resolved = await resolvePublicCommercialCatalog({
      env: PUBLIC_DB_ENV,
      store,
      now: BASE,
    })

    expect(resolved.source).toBe("db")
    expect(resolved.publication?.version).toBe("CATALOG_ACTIVE_V1")
    expect(resolved.plans.find((plan) => plan.id === "starter")?.name).toBe("Starter Database")
    expect(resolved.shadow.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "plans.starter.name" }),
      ]),
    )
  })

  it("refuses to advertise a database price that checkout would not charge", async () => {
    const store = await activeStore()
    const version = getVersion(store, "prod_subscription_starter_v1")
    version.priceMinor = 100
    refreshVersion(store, version)

    await expect(
      resolvePublicCommercialCatalog({ env: PUBLIC_DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "CHECKOUT_INCOMPATIBLE" })

    const internal = await resolveCommercialCatalog({ env: DB_ENV, store, now: BASE })
    expect(internal.plans.find((plan) => plan.id === "starter")?.priceUSD).toBe(1)
    expect(internal.shadow.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "plans.starter.priceMinor" }),
      ]),
    )
  })

  it("refuses to advertise a database-only product", async () => {
    const store = await activeStore()
    const product: CommercialProductDoc = {
      id: "prod_subscription_extra",
      type: "subscription",
      slug: "subscription-extra",
      status: "published",
      currentVersionId: "prod_subscription_extra_v1",
      createdBy: "test",
      createdAt: BASE,
      updatedAt: BASE,
    }
    const version: CommercialProductVersionDoc = {
      id: "prod_subscription_extra_v1",
      productId: product.id,
      version: 1,
      status: "published",
      effectiveAt: BASE,
      name: "Extra",
      description: "Database-only plan",
      saleMode: "self_serve",
      currency: "USD",
      priceMinor: 1_000,
      annualPriceMinor: null,
      billingIntervals: ["monthly"],
      credits: {
        creditType: "subscription",
        monthlyGrant: 1_000,
        oneTimeGrant: null,
        annualTotalCredits: null,
        annualMonths: null,
        annualIssuance: null,
        expiresAfterDays: null,
        bonusCredits: null,
      },
      entitlement: null,
      createdBy: "test",
      createdAt: BASE,
      changeSummary: "test",
      checksum: "",
    }
    version.checksum = versionChecksum(version)
    store.products.set(product.id, product)
    store.versions.set(`${version.productId}:${version.version}`, version)

    const publication = await store.getCatalogVersion("CATALOG_ACTIVE_V1")
    if (!publication) throw new Error("missing publication")
    publication.productVersionIds = [...publication.productVersionIds, version.id]
    store.catalogVersions.set(publication.version, publication)
    refreshPublication(store, publication)

    await expect(
      resolvePublicCommercialCatalog({ env: PUBLIC_DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "CHECKOUT_INCOMPATIBLE" })
  })


  it("refuses a public publication that hides a code-checkout plan", async () => {
    const store = await activeStore()
    const publication = await store.getCatalogVersion("CATALOG_ACTIVE_V1")
    if (!publication) throw new Error("missing publication")
    publication.productVersionIds = publication.productVersionIds.filter(
      (id) => id !== "prod_subscription_starter_v1",
    )
    store.catalogVersions.set(publication.version, publication)
    refreshPublication(store, publication)

    await expect(
      resolvePublicCommercialCatalog({ env: PUBLIC_DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "CHECKOUT_INCOMPATIBLE" })
  })

  it("rejects a legacy renewal-only product in the active publication", async () => {
    const store = await activeStore()
    const version = getVersion(store, "prod_subscription_starter_v1")
    version.saleMode = "legacy_renewal_only"
    refreshVersion(store, version)

    await expect(
      resolveCommercialCatalog({ env: DB_ENV, store, now: BASE }),
    ).rejects.toMatchObject({ reason: "PUBLICATION_MEMBERSHIP_INVALID" })
  })

  it("keeps legacy renewal-only products out of offerings but available historically", async () => {
    const store = await activeStore()

    const resolved = await resolveCommercialCatalog({ env: DB_ENV, store, now: BASE })
    expect(resolved.plans.some((plan) => plan.id === "free")).toBe(false)
    expect(resolved.entries.some((entry) => entry.product.id === "prod_legacy_starter")).toBe(false)

    const historical = await resolveHistoricalCatalogEntry({
      productId: "prod_legacy_starter",
      env: DB_ENV,
      store,
      now: BASE,
    })
    expect(historical?.product.id).toBe("prod_legacy_starter")
    expect(historical?.product.status).toBe("archived")
    expect(historical?.version.status).toBe("archived")
  })

  it("resolves code-catalog historical entries without an active publication", async () => {
    const historical = await resolveHistoricalCatalogEntry({
      productId: "prod_legacy_starter",
      env: { CATALOG_SOURCE: "code" } as NodeJS.ProcessEnv,
      now: BASE,
    })

    expect(historical?.product.id).toBe("prod_legacy_starter")
    expect(historical?.product.status).toBe("archived")
  })
})
