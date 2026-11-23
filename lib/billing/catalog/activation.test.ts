import { beforeEach, describe, expect, it, vi } from "vitest"
import { catalogPublicationChecksum, versionChecksum } from "./code-catalog"
import { activateCatalogPublication } from "./activation"
import type { CatalogActivationStore } from "./authoring-store"
import { seedCommercialCatalog } from "./seed"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
} from "./types"

const audit = vi.hoisted(() => ({ logAuditAction: vi.fn() }))
vi.mock("@/lib/infrastructure/audit", () => ({ logAuditAction: audit.logAuditAction }))

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

const ACTOR = { id: "admin_1", email: "admin@example.com" }

class MemoryStore implements CatalogActivationStore {
  products = new Map<string, CommercialProductDoc>()
  versions = new Map<string, CommercialProductVersionDoc>()
  mappings = new Map<string, import("./types").DodoProductMappingDoc>()
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
  async upsertMapping(doc: import("./types").DodoProductMappingDoc) {
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
  async listProducts() {
    return [...this.products.values()].map((doc) => structuredClone(doc))
  }
  async listVersions() {
    return [...this.versions.values()].map((doc) => structuredClone(doc))
  }
  async listCatalogVersions() {
    return [...this.catalogVersions.values()].map((doc) => structuredClone(doc))
  }
  async activatePublication(input: {
    version: string
    expectedChecksum: string
    actorId: string
    now: number
  }) {
    const candidate = this.catalogVersions.get(input.version)
    if (
      !candidate ||
      candidate.status !== "candidate" ||
      candidate.checksum !== input.expectedChecksum
    ) {
      return "conflict" as const
    }
    for (const publication of this.catalogVersions.values()) {
      if (publication.status !== "active") continue
      publication.status = "superseded"
      publication.supersededBy = input.actorId
      publication.supersededAt = input.now
    }
    candidate.status = "active"
    candidate.activatedBy = input.actorId
    candidate.activatedAt = input.now
    return "ok" as const
  }
}

function publicationChecksum(publication: CommercialCatalogVersionDoc): string {
  return catalogPublicationChecksum({
    version: publication.version,
    productVersionIds: publication.productVersionIds,
    priceBookVersion: publication.priceBookVersion,
    entitlementVersion: publication.entitlementVersion,
  })
}

function makePublication(
  version: string,
  status: CommercialCatalogVersionDoc["status"],
  ids: string[],
  publishedAt: number,
): CommercialCatalogVersionDoc {
  const publication: CommercialCatalogVersionDoc = {
    id: version,
    version,
    status,
    productVersionIds: [...ids].sort(),
    priceBookVersion: "PRICE_BOOK_V1",
    entitlementVersion: "ENT_V1",
    publisher: "test",
    publishedAt,
    checksum: "",
  }
  publication.checksum = publicationChecksum(publication)
  return publication
}

async function candidateStore(options: { name?: string; priceMinor?: number; effectiveAt?: number } = {}) {
  const store = new MemoryStore()
  await seedCommercialCatalog({ store, env: ENV, now: BASE })
  const products = await store.listProducts()
  const activeIds = products
    .filter((product) => product.status === "published" && product.currentVersionId)
    .map((product) => product.currentVersionId as string)
  await store.catalogVersions.set(
    "CATALOG_ACTIVE_V1",
    makePublication("CATALOG_ACTIVE_V1", "active", activeIds, BASE - 10_000),
  )

  const original = [...store.versions.values()].find(
    (version) => version.id === "prod_subscription_starter_v1",
  )
  if (!original) throw new Error("missing starter version")
  const next: CommercialProductVersionDoc = {
    ...structuredClone(original),
    id: "prod_subscription_starter_v2",
    version: 2,
    name: options.name ?? "Starter Preview",
    priceMinor: options.priceMinor ?? original.priceMinor,
    effectiveAt: options.effectiveAt ?? BASE,
    checksum: "",
  }
  next.checksum = versionChecksum(next)
  await store.versions.set(`${next.productId}:${next.version}`, next)
  const product = store.products.get("prod_subscription_starter")
  if (!product) throw new Error("missing starter product")
  product.currentVersionId = next.id

  const candidateIds = [...store.products.values()]
    .filter((item) => item.status === "published" && item.currentVersionId)
    .map((item) => item.currentVersionId as string)
  const candidate = makePublication("CATALOG_CANDIDATE_V1", "candidate", candidateIds, BASE)
  await store.catalogVersions.set(candidate.version, candidate)
  return { store, candidate, next }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("A7.4 catalog publication activation", () => {
  it("activates a valid candidate and supersedes the previous active publication", async () => {
    const { store, candidate } = await candidateStore()

    const result = await activateCatalogPublication({
      version: candidate.version,
      body: { expectedChecksum: candidate.checksum },
      actor: ACTOR,
      store,
      now: BASE,
      env: ENV,
    })

    expect(result).toMatchObject({
      publicationVersion: "CATALOG_CANDIDATE_V1",
      status: "active",
      superseded: ["CATALOG_ACTIVE_V1"],
    })
    expect(store.catalogVersions.get("CATALOG_CANDIDATE_V1")?.status).toBe("active")
    expect(store.catalogVersions.get("CATALOG_CANDIDATE_V1")?.activatedBy).toBe(ACTOR.id)
    expect(store.catalogVersions.get("CATALOG_ACTIVE_V1")?.status).toBe("superseded")
    expect(store.catalogVersions.get("CATALOG_ACTIVE_V1")?.supersededBy).toBe(ACTOR.id)
    expect(audit.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "catalog.publication.activate",
        previousValue: "CATALOG_ACTIVE_V1",
        newValue: "CATALOG_CANDIDATE_V1",
      }),
    )
  })

  it("refuses a stale checksum without mutating the publication", async () => {
    const { store, candidate } = await candidateStore()

    await expect(
      activateCatalogPublication({
        version: candidate.version,
        body: { expectedChecksum: "stale" },
        actor: ACTOR,
        store,
        now: BASE,
        env: ENV,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT" })

    expect(store.catalogVersions.get("CATALOG_CANDIDATE_V1")?.status).toBe("candidate")
    expect(store.catalogVersions.get("CATALOG_ACTIVE_V1")?.status).toBe("active")
    expect(audit.logAuditAction).not.toHaveBeenCalled()
  })

  it("refuses a publication that is not a candidate", async () => {
    const { store } = await candidateStore()

    await expect(
      activateCatalogPublication({
        version: "CATALOG_ACTIVE_V1",
        body: { expectedChecksum: store.catalogVersions.get("CATALOG_ACTIVE_V1")?.checksum },
        actor: ACTOR,
        store,
        now: BASE,
        env: ENV,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT" })
  })

  it("refuses a candidate whose price no longer matches checkout", async () => {
    const { store, candidate } = await candidateStore({ priceMinor: 100 })

    await expect(
      activateCatalogPublication({
        version: candidate.version,
        body: { expectedChecksum: candidate.checksum },
        actor: ACTOR,
        store,
        now: BASE,
        env: ENV,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", status: 422 })
    expect(store.catalogVersions.get("CATALOG_CANDIDATE_V1")?.status).toBe("candidate")
  })

  it("refuses future-effective versions", async () => {
    const { store, candidate } = await candidateStore({ effectiveAt: BASE + 60_000 })

    await expect(
      activateCatalogPublication({
        version: candidate.version,
        body: { expectedChecksum: candidate.checksum },
        actor: ACTOR,
        store,
        now: BASE,
        env: ENV,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", status: 422 })
  })

  it("returns 404 for an unknown publication", async () => {
    const { store } = await candidateStore()

    await expect(
      activateCatalogPublication({
        version: "missing",
        body: { expectedChecksum: "anything" },
        actor: ACTOR,
        store,
        now: BASE,
        env: ENV,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 })
  })
})
