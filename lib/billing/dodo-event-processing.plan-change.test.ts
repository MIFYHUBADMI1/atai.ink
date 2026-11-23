import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { catalogPublicationChecksum } from "@/lib/billing/catalog/code-catalog"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "@/lib/billing/catalog/types"

const { subFindOne, subUpdateOne, seedStore } = vi.hoisted(() => ({
  subFindOne: vi.fn(),
  subUpdateOne: vi.fn(),
  seedStore: { current: null as unknown },
}))

vi.mock("@/lib/db/collections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/collections")>()
  return {
    ...actual,
    subscriptionRecordsCol: vi.fn(async () => ({
      findOne: subFindOne,
      updateOne: subUpdateOne,
    })),
  }
})
vi.mock("@/lib/billing/catalog/seed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/catalog/seed")>()
  return {
    ...actual,
    mongoCatalogSeedStore: vi.fn(async () => seedStore.current),
  }
})
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { processDodoEvent } from "./dodo-event-processing"
import { buildCodeCatalogSnapshot } from "./catalog/code-catalog"
import type { CatalogSeedStore } from "./catalog/seed"

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
const ENV_KEYS = [...Object.keys(ENV), "CATALOG_SOURCE", "CATALOG_DB_PUBLIC_READS"]

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

function starterSubscription() {
  return {
    id: "sub_record_1",
    dodoSubscriptionId: "sub_1",
    userId: "u1",
    planId: "starter",
    planName: "Starter",
    commercialPlanId: "starter",
    billingCycle: "monthly",
    priceUSD: 89.99,
    mirrorCredits: 150_000,
    status: "active",
    currentPeriodStart: BASE,
    currentPeriodEnd: BASE + 30 * 86_400_000,
    purchasedTerms: {
      planId: "starter",
      commercialPlanId: "starter",
      billingInterval: "monthly",
      monthlyCredits: 150_000,
      entitlementSnapshot: { commercialPlanId: "starter" },
      entitlementVersion: "ENT_V1",
      pricingVersion: "PRICE_BOOK_V1",
    },
  }
}

describe("subscription.plan_changed — active database catalog", () => {
  beforeEach(async () => {
    for (const key of ENV_KEYS) delete process.env[key]
    Object.assign(process.env, ENV, {
      CATALOG_SOURCE: "db",
      CATALOG_DB_PUBLIC_READS: "enabled",
    })
    seedStore.current = await activeStore()
    subFindOne.mockReset().mockResolvedValue(starterSubscription())
    subUpdateOne.mockReset().mockResolvedValue({ modifiedCount: 1 })
  })
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it("re-pins the new database plan and entitlement snapshot", async () => {
    const outcome = await processDodoEvent(
      "subscription.plan_changed",
      { subscription_id: "sub_1", product_id: "dodo_growth_m" },
      "evt_plan_1",
    )

    expect(outcome).toEqual({ status: "processed" })
    const update = subUpdateOne.mock.calls[0][1].$set
    expect(update).toMatchObject({
      planId: "growth",
      planName: "Growth",
      commercialPlanId: "growth",
      priceUSD: 199.99,
      mirrorCredits: 400_000,
      billingCycle: "monthly",
      termsStatus: "pinned",
    })
    expect(update.purchasedTerms.entitlementSnapshot.commercialPlanId).toBe("growth")
  })

  it("keeps pinned terms for a duplicate plan_changed event", async () => {
    await processDodoEvent(
      "subscription.plan_changed",
      { subscription_id: "sub_1", product_id: "dodo_starter_m" },
      "evt_plan_2",
    )

    expect(subUpdateOne).not.toHaveBeenCalled()
  })
})
