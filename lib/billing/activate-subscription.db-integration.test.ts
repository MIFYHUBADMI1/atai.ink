import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { catalogPublicationChecksum } from "@/lib/billing/catalog/code-catalog"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "@/lib/billing/catalog/types"

vi.mock("server-only", () => ({}))

const { subFindOne, subUpdateOne, subInsertOne, grantSubscriptionCredits, seedStore } = vi.hoisted(
  () => ({
    subFindOne: vi.fn(),
    subUpdateOne: vi.fn(),
    subInsertOne: vi.fn(),
    grantSubscriptionCredits: vi.fn(),
    seedStore: { current: null as unknown },
  }),
)

vi.mock("@/lib/db/collections", () => ({
  subscriptionRecordsCol: vi.fn(async () => ({
    findOne: subFindOne,
    updateOne: subUpdateOne,
    insertOne: subInsertOne,
  })),
}))
vi.mock("@/lib/billing/credit-service", () => ({ grantSubscriptionCredits, grantCredits: vi.fn() }))
vi.mock("@/lib/billing/subscription-payment-grants", () => ({
  findSubscriptionGrantEntry: vi.fn(async () => null),
  linkSubscriptionGrantToPayment: vi.fn(async () => ({ linked: false })),
}))
vi.mock("@/lib/billing/dodo-service", () => ({ getDodoClient: vi.fn() }))
vi.mock("@/lib/billing/catalog/seed", () => ({
  mongoCatalogSeedStore: vi.fn(async () => seedStore.current),
}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { activatePaidSubscription } from "./activate-subscription"
import { buildCodeCatalogSnapshot } from "./catalog/code-catalog"
import type { CatalogSeedStore } from "./catalog/seed"

const BASE = 1_700_000_000_000
const DAY_MS = 86_400_000
const ENV_KEYS = [
  "CATALOG_SOURCE",
  "CATALOG_DB_PUBLIC_READS",
  "DODO_COMMERCIAL_PRODUCT_STARTER",
  "DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL",
  "DODO_COMMERCIAL_PRODUCT_GROWTH",
  "DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL",
  "DODO_COMMERCIAL_PRODUCT_SCALE",
  "DODO_PRODUCT_STARTER",
]
const ENV = {
  DODO_COMMERCIAL_PRODUCT_STARTER: "dodo_starter_m",
  DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL: "dodo_starter_y",
  DODO_COMMERCIAL_PRODUCT_GROWTH: "dodo_growth_m",
  DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL: "dodo_growth_y",
  DODO_COMMERCIAL_PRODUCT_SCALE: "dodo_scale_m",
  DODO_PRODUCT_STARTER: "dodo_legacy_starter",
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
  const snapshot = buildCodeCatalogSnapshot({ env: ENV, now: BASE })
  for (const product of snapshot.products) await store.upsertProduct(product)
  for (const version of snapshot.versions) await store.upsertVersion(version)
  for (const mapping of snapshot.mappings) await store.upsertMapping(mapping)
  const ids = snapshot.products
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

describe("activatePaidSubscription — real active database catalog", () => {
  beforeEach(async () => {
    for (const key of ENV_KEYS) delete process.env[key]
    Object.assign(process.env, ENV, {
      CATALOG_SOURCE: "db",
      CATALOG_DB_PUBLIC_READS: "enabled",
    })
    seedStore.current = await activeStore()
    subFindOne.mockReset().mockResolvedValue(null)
    subUpdateOne.mockReset().mockResolvedValue({ modifiedCount: 1 })
    subInsertOne.mockReset().mockResolvedValue({ insertedId: "x" })
    grantSubscriptionCredits.mockReset().mockResolvedValue(true)
  })
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it("pins a real database Growth purchase from its Dodo product id", async () => {
    const result = await activatePaidSubscription({
      subscriptionId: "dodo_sub_db_growth",
      productId: "dodo_growth_m",
      metadata: { userId: "u1", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })

    expect(result).toEqual({ ok: true, planId: "growth" })
    const record = subInsertOne.mock.calls[0][0]
    expect(record).toMatchObject({
      planId: "growth",
      planName: "Growth",
      commercialPlanId: "growth",
      priceUSD: 199.99,
      mirrorCredits: 400_000,
      billingCycle: "monthly",
    })
    expect(record.purchasedTerms.entitlementSnapshot.commercialPlanId).toBe("growth")
  })

  it("does not mis-attribute a legacy Dodo product to the database commercial plan", async () => {
    const result = await activatePaidSubscription({
      subscriptionId: "dodo_sub_legacy",
      productId: "dodo_legacy_starter",
      metadata: { userId: "u1", planId: "starter", billingCycle: "monthly" },
      nextBillingDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    })

    expect(result).toEqual({ ok: true, planId: "starter" })
    const record = subInsertOne.mock.calls[0][0]
    expect(record).toMatchObject({
      planId: "starter",
      priceUSD: 79,
      mirrorCredits: 300_000,
    })
    expect(record.commercialPlanId).toBeUndefined()
  })
})
