import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { catalogPublicationChecksum } from "@/lib/billing/catalog/code-catalog"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "@/lib/billing/catalog/types"

const { createSession, getCurrentUser, seedStore } = vi.hoisted(() => ({
  createSession: vi.fn(),
  getCurrentUser: vi.fn(),
  seedStore: { current: null as unknown },
}))

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }))
vi.mock("@/lib/env", () => ({
  getDodoConfig: () => ({ apiKey: "test_key", environment: "test_mode" }),
}))
vi.mock("@/lib/cache/locks", () => ({
  checkoutRateLimiter: { allowed: () => true },
  checkoutSessionLocks: { acquire: () => () => {} },
  productCreationLocks: { acquire: () => () => {} },
}))
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => {}) }))
vi.mock("@/lib/billing/currency", () => ({
  detectCountryFromRequest: vi.fn(async () => undefined),
  resolveBillingCurrency: vi.fn(() => undefined),
}))
vi.mock("@/lib/billing/checkout-return", () => ({
  checkoutReturnUrl: () => "https://atai.ink/settings/billing",
}))

vi.mock("@/lib/billing/runtime-config", () => ({ getPromotionalOffers: vi.fn(async () => []) }))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/billing/catalog/seed", () => ({
  mongoCatalogSeedStore: vi.fn(async () => seedStore.current),
}))
vi.mock("dodopayments", () => {
  class FakeDodoPayments {
    checkoutSessions = { create: createSession }
    products = { list: vi.fn(), create: vi.fn() }
  }
  return { default: FakeDodoPayments, DodoPayments: FakeDodoPayments }
})

import { POST } from "./route"
import { buildCodeCatalogSnapshot } from "@/lib/billing/catalog/code-catalog"
import type { CatalogSeedStore } from "@/lib/billing/catalog/seed"

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

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/billing/checkout — real active database resolver", () => {
  beforeEach(async () => {
    for (const key of ENV_KEYS) delete process.env[key]
    Object.assign(process.env, ENV, {
      CATALOG_SOURCE: "db",
      CATALOG_DB_PUBLIC_READS: "enabled",
    })
    seedStore.current = await activeStore()
    getCurrentUser.mockReset().mockResolvedValue({ id: "u1" })
    createSession.mockReset().mockResolvedValue({
      checkout_url: "https://test.dodopayments.com/checkout/x",
      session_id: "cks_1",
    })
  })
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it("uses the active publication for a subscription checkout", async () => {
    const response = await POST(post({ type: "subscription", productId: "growth" }))
    expect(response.status).toBe(200)
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "dodo_growth_m", quantity: 1 }])
    expect(session.metadata).toMatchObject({ planId: "growth", billingCycle: "monthly" })
  })

  it("uses the active publication for a credit-pack checkout", async () => {
    const response = await POST(post({ type: "permanent", productId: "perm_500k" }))
    expect(response.status).toBe(200)
    const session = createSession.mock.calls[0][0]
    expect(session.product_cart).toEqual([{ product_id: "dodo_perm_500k", quantity: 1 }])
  })

  it("fails closed when the active publication drifts from checkout", async () => {
    process.env.DODO_COMMERCIAL_PRODUCT_GROWTH = "dodo_growth_changed"
    const response = await POST(post({ type: "subscription", productId: "growth" }))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe("CATALOG_UNAVAILABLE")
    expect(createSession).not.toHaveBeenCalled()
  })
})
