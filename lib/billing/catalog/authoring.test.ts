import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/errors"
import { catalogPublicationChecksum, versionChecksum } from "./code-catalog"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
} from "./types"
import type {
  CatalogAuthoringStore,
  ProductPatch,
  VersionPatch,
} from "./authoring-store"
import {
  archiveCatalogProduct,
  createCatalogProduct,
  createCatalogVersion,
  publishCatalogProduct,
  updateCatalogProduct,
} from "./authoring"

const audit = vi.hoisted(() => ({ logAuditAction: vi.fn() }))
vi.mock("@/lib/infrastructure/audit", () => ({ logAuditAction: audit.logAuditAction }))

class MemoryAuthoringStore implements CatalogAuthoringStore {
  products = new Map<string, CommercialProductDoc>()
  versions = new Map<string, CommercialProductVersionDoc>()
  catalogVersions = new Map<string, CommercialCatalogVersionDoc>()

  private clone<T>(value: T): T {
    return structuredClone(value)
  }

  async listProducts() {
    return [...this.products.values()].map((value) => this.clone(value))
  }

  async listVersions() {
    return [...this.versions.values()].map((value) => this.clone(value))
  }

  async listCatalogVersions() {
    return [...this.catalogVersions.values()].map((value) => this.clone(value))
  }

  async createProductWithVersion(product: CommercialProductDoc, version: CommercialProductVersionDoc) {
    if (
      this.products.has(product.id) ||
      [...this.products.values()].some((candidate) => candidate.slug === product.slug) ||
      this.versions.has(version.id)
    ) {
      return "duplicate" as const
    }
    this.products.set(product.id, this.clone(product))
    this.versions.set(version.id, this.clone(version))
    return "inserted" as const
  }

  async replaceDraftVersion(input: {
    productId: string
    expectedUpdatedAt: number
    productPatch: ProductPatch
    oldDraft?: { id: string; checksum: string; patch: VersionPatch }
    newVersion: CommercialProductVersionDoc
  }) {
    const product = this.products.get(input.productId)
    if (!product || product.updatedAt !== input.expectedUpdatedAt || product.status === "archived") {
      return "conflict" as const
    }
    const oldDraft = input.oldDraft ? this.versions.get(input.oldDraft.id) : undefined
    if (
      input.oldDraft &&
      (!oldDraft ||
        oldDraft.status !== "draft" ||
        oldDraft.checksum !== input.oldDraft.checksum)
    ) {
      return "conflict" as const
    }
    if (this.versions.has(input.newVersion.id)) return "duplicate_version" as const

    if (oldDraft && input.oldDraft) {
      this.versions.set(oldDraft.id, { ...oldDraft, ...input.oldDraft.patch })
    }
    this.products.set(product.id, { ...product, ...input.productPatch })
    this.versions.set(input.newVersion.id, this.clone(input.newVersion))
    return "ok" as const
  }

  async publishVersion(input: {
    productId: string
    expectedUpdatedAt: number
    versionId: string
    versionPatch: VersionPatch
    productPatch: ProductPatch
    publication: CommercialCatalogVersionDoc
  }) {
    const product = this.products.get(input.productId)
    const version = this.versions.get(input.versionId)
    if (
      !product ||
      product.updatedAt !== input.expectedUpdatedAt ||
      product.status === "archived" ||
      !version ||
      version.productId !== input.productId ||
      version.status !== "draft"
    ) {
      return "conflict" as const
    }
    if (this.catalogVersions.has(input.publication.version)) {
      return "duplicate_publication" as const
    }
    this.versions.set(version.id, { ...version, ...input.versionPatch })
    this.products.set(product.id, { ...product, ...input.productPatch })
    this.catalogVersions.set(input.publication.version, this.clone(input.publication))
    return "ok" as const
  }

  async archiveProduct(input: {
    productId: string
    expectedUpdatedAt: number
    productPatch: ProductPatch
  }) {
    const product = this.products.get(input.productId)
    if (!product || product.updatedAt !== input.expectedUpdatedAt || product.status === "archived") {
      return "conflict" as const
    }
    this.products.set(product.id, { ...product, ...input.productPatch })
    return "ok" as const
  }
}

const ACTOR = { id: "admin_1", email: "admin@example.com" }
const NOW = 1_800_000_000_000

function subscriptionBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "subscription",
    slug: "studio",
    name: "Studio",
    description: "A plan for studios.",
    saleMode: "self_serve",
    currency: "USD",
    priceMinor: 12_500,
    annualPriceMinor: 120_000,
    billingIntervals: ["monthly", "annual"],
    credits: {
      creditType: "subscription",
      monthlyGrant: 2_000,
      oneTimeGrant: null,
      annualTotalCredits: 24_000,
      annualMonths: 12,
      annualIssuance: "monthly",
      expiresAfterDays: null,
      bonusCredits: null,
    },
    entitlement: {
      templateId: "ent_v1:studio",
      version: "ent_v1",
      snapshot: { businesses: 0 },
    },
    changeSummary: "Initial draft",
    ...overrides,
  }
}

function packBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "credit_pack",
    slug: "pack-500",
    name: "500 credits",
    description: "A one-time credit pack.",
    saleMode: "self_serve",
    currency: "USD",
    priceMinor: 5_000,
    annualPriceMinor: null,
    billingIntervals: [],
    credits: {
      creditType: "permanent",
      monthlyGrant: null,
      oneTimeGrant: 500,
      annualTotalCredits: null,
      annualMonths: null,
      annualIssuance: null,
      expiresAfterDays: null,
      bonusCredits: null,
    },
    entitlement: null,
    changeSummary: "Initial draft",
    ...overrides,
  }
}

async function createdProduct(store: MemoryAuthoringStore, body = subscriptionBody()) {
  const result = await createCatalogProduct({ body, actor: ACTOR, store, now: NOW })
  return {
    result,
    product: store.products.get(result.productId)!,
    version: store.versions.get(result.versionId)!,
  }
}

describe("A7.2 commercial catalog authoring", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    audit.logAuditAction.mockResolvedValue(undefined)
  })

  it("creates a stable product identity with an initial immutable draft version", async () => {
    const store = new MemoryAuthoringStore()
    const { result, product, version } = await createdProduct(store)

    expect(result).toMatchObject({
      productId: "prod_subscription_studio",
      versionId: "prod_subscription_studio_v1",
      version: 1,
      status: "draft",
    })
    expect(product).toMatchObject({
      id: "prod_subscription_studio",
      type: "subscription",
      slug: "studio",
      status: "draft",
      currentVersionId: null,
      createdBy: ACTOR.id,
      updatedAt: NOW,
    })
    expect(version.status).toBe("draft")
    expect(version.changeSummary).toBe("Initial draft")
    expect(version.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "catalog.product.create", result: "success" }),
    )
  })


  it("creates valid credit-pack and infrastructure products", async () => {
    const store = new MemoryAuthoringStore()
    const pack = await createCatalogProduct({ body: packBody(), actor: ACTOR, store, now: NOW })
    expect(pack.productId).toBe("prod_pack_pack_500")

    const infrastructure = await createCatalogProduct({
      body: {
        type: "infrastructure",
        slug: "compute-1",
        name: "Compute 1",
        description: "Credit-funded compute.",
        saleMode: "self_serve",
        currency: "USD",
        priceMinor: 0,
        annualPriceMinor: null,
        billingIntervals: [],
        credits: null,
        entitlement: null,
        infrastructure: {
          purchaseModel: "credit_funded",
          durationDays: 30,
          renewal: "manual",
          storageLabel: "10 GB",
          storageBytes: 10_000_000_000,
          totalumInfrastructureCredits: 1_000,
          creditCharge: 250,
          includedResources: {},
        },
        changeSummary: "Initial draft",
      },
      actor: ACTOR,
      store,
      now: NOW + 1,
    })
    expect(infrastructure.productId).toBe("prod_infra_compute_1")
  })

  it("rejects infrastructure without a credit charge", async () => {
    const store = new MemoryAuthoringStore()
    await expect(
      createCatalogProduct({
        body: {
          type: "infrastructure",
          slug: "compute-2",
          name: "Compute 2",
          description: "Credit-funded compute.",
          saleMode: "self_serve",
          currency: "USD",
          priceMinor: 0,
          annualPriceMinor: null,
          billingIntervals: [],
          credits: null,
          entitlement: null,
          infrastructure: {
            purchaseModel: "credit_funded",
            durationDays: 30,
            renewal: "manual",
            storageLabel: "10 GB",
            creditCharge: null,
          },
          changeSummary: "Initial draft",
        },
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("rejects duplicate product identities and slugs", async () => {
    const store = new MemoryAuthoringStore()
    await createdProduct(store)

    await expect(
      createCatalogProduct({ body: subscriptionBody(), actor: ACTOR, store, now: NOW + 1 }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT", status: 409 })

    await expect(
      createCatalogProduct({
        body: subscriptionBody({ slug: "studio" }),
        actor: ACTOR,
        store,
        now: NOW + 2,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT" })
  })

  it("rejects invalid product configurations", async () => {
    const store = new MemoryAuthoringStore()

    await expect(
      createCatalogProduct({
        body: subscriptionBody({ credits: null }),
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createCatalogProduct({
        body: packBody({
          credits: {
            creditType: "permanent",
            monthlyGrant: null,
            oneTimeGrant: 0,
            annualTotalCredits: null,
            annualMonths: null,
            annualIssuance: null,
            expiresAfterDays: null,
            bonusCredits: null,
          },
        }),
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createCatalogProduct({
        body: subscriptionBody({ priceMinor: null }),
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createCatalogProduct({
        body: subscriptionBody({ currency: "usd" }),
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createCatalogProduct({
        body: subscriptionBody({ slug: "Not A Slug" }),
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      createCatalogProduct({
        body: subscriptionBody({ saleMode: "legacy_renewal_only" }),
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("creates a new draft from a published version without rewriting the published version", async () => {
    const store = new MemoryAuthoringStore()
    const { product, version: published } = await createdProduct(store)

    await publishCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: product.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })
    const publishedAfter = store.versions.get(published.id)!
    expect(publishedAfter.status).toBe("published")

    const draft = await createCatalogVersion({
      productId: product.id,
      body: {
        expectedUpdatedAt: store.products.get(product.id)!.updatedAt,
        priceMinor: 15_000,
        changeSummary: "Raise the monthly price",
      },
      actor: ACTOR,
      store,
      now: NOW + 20,
    })

    expect(draft).toMatchObject({
      versionId: "prod_subscription_studio_v2",
      version: 2,
      status: "draft",
    })
    expect(store.versions.get(published.id)).toEqual(publishedAfter)
    expect(store.versions.get(draft.versionId)).toMatchObject({
      status: "draft",
      priceMinor: 15_000,
      changeSummary: "Raise the monthly price",
    })
    expect(audit.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "catalog.version.create" }),
    )
  })

  it("edits a draft by replacing it with a new draft and archiving the old draft", async () => {
    const store = new MemoryAuthoringStore()
    const { product } = await createdProduct(store)

    const firstDraft = await updateCatalogProduct({
      productId: product.id,
      body: {
        expectedUpdatedAt: product.updatedAt,
        name: "Studio Plus",
        changeSummary: "Rename the draft",
      },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })
    const secondDraft = await updateCatalogProduct({
      productId: product.id,
      body: {
        expectedUpdatedAt: store.products.get(product.id)!.updatedAt,
        name: "Studio Pro",
        changeSummary: "Rename again",
      },
      actor: ACTOR,
      store,
      now: NOW + 20,
    })

    expect(store.versions.get(firstDraft.versionId)).toMatchObject({
      status: "archived",
      name: "Studio Plus",
    })
    expect(store.versions.get(secondDraft.versionId)).toMatchObject({
      status: "draft",
      name: "Studio Pro",
    })
    expect(store.products.get(product.id)!.currentVersionId).toBeNull()
    expect(audit.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "catalog.version.update" }),
    )
  })


  it("preserves infrastructure resources that the edit form does not expose", async () => {
    const store = new MemoryAuthoringStore()
    const created = await createCatalogProduct({
      body: {
        type: "infrastructure",
        slug: "compute-3",
        name: "Compute 3",
        description: "Credit-funded compute.",
        saleMode: "self_serve",
        currency: "USD",
        priceMinor: 0,
        annualPriceMinor: null,
        billingIntervals: [],
        credits: null,
        entitlement: null,
        infrastructure: {
          purchaseModel: "credit_funded",
          durationDays: 30,
          renewal: "manual",
          storageLabel: "10 GB",
          storageBytes: 10_000_000_000,
          totalumInfrastructureCredits: 1_000,
          creditCharge: 250,
          includedResources: { cpu: 4, memoryGb: 8 },
        },
        changeSummary: "Initial draft",
      },
      actor: ACTOR,
      store,
      now: NOW,
    })

    const draft = await updateCatalogProduct({
      productId: created.productId,
      body: {
        expectedUpdatedAt: store.products.get(created.productId)!.updatedAt,
        name: "Compute 3 Plus",
        infrastructure: {
          purchaseModel: "credit_funded",
          durationDays: 60,
          renewal: "manual",
          storageLabel: "20 GB",
          storageBytes: 20_000_000_000,
          totalumInfrastructureCredits: 2_000,
          creditCharge: 500,
        },
        changeSummary: "Bigger compute",
      },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })

    expect(store.versions.get(draft.versionId)!.infrastructure).toMatchObject({
      durationDays: 60,
      creditCharge: 500,
      includedResources: { cpu: 4, memoryGb: 8 },
    })
  })

  it("numbers versions per product, not across the whole catalog", async () => {
    const store = new MemoryAuthoringStore()
    const first = await createdProduct(store)
    await createdProduct(
      store,
      subscriptionBody({ slug: "studio-two", name: "Studio Two" }),
    )
    const second = await updateCatalogProduct({
      productId: first.product.id,
      body: {
        expectedUpdatedAt: store.products.get(first.product.id)!.updatedAt,
        name: "Studio One Plus",
        changeSummary: "Second version of the first product",
      },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })

    expect(second.version).toBe(2)
    expect(store.versions.get(second.versionId)!.id).toBe("prod_subscription_studio_v2")
    expect(store.products.get("prod_subscription_studio_two")!.currentVersionId).toBeNull()
    expect(store.versions.get("prod_subscription_studio_two_v1")!.version).toBe(1)
  })

  it("rejects stale optimistic-concurrency tokens", async () => {
    const store = new MemoryAuthoringStore()
    const { product } = await createdProduct(store)

    await updateCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: product.updatedAt, name: "Changed", changeSummary: "Change" },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })

    await expect(
      updateCatalogProduct({
        productId: product.id,
        body: { expectedUpdatedAt: product.updatedAt, name: "Stale", changeSummary: "Stale" },
        actor: ACTOR,
        store,
        now: NOW + 20,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT", status: 409 })
  })


  it("refuses a second draft while a draft already exists", async () => {
    const store = new MemoryAuthoringStore()
    const { product } = await createdProduct(store)

    await expect(
      createCatalogVersion({
        productId: product.id,
        body: {
          expectedUpdatedAt: product.updatedAt,
          name: "Another draft",
          changeSummary: "Should be refused",
        },
        actor: ACTOR,
        store,
        now: NOW + 10,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT" })
  })

  it("refuses to publish a draft whose checksum no longer matches", async () => {
    const store = new MemoryAuthoringStore()
    const { product, version } = await createdProduct(store)
    store.versions.get(version.id)!.priceMinor = 1

    await expect(
      publishCatalogProduct({
        productId: product.id,
        body: { expectedUpdatedAt: product.updatedAt },
        actor: ACTOR,
        store,
        now: NOW + 10,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT" })
  })

  it("publishes a valid draft and writes an immutable candidate publication snapshot", async () => {
    const store = new MemoryAuthoringStore()
    const { product, version } = await createdProduct(store)

    const result = await publishCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: product.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })

    expect(result.status).toBe("published")
    expect(result.publicationVersion).toMatch(/^CATALOG_A72_/)
    expect(store.products.get(product.id)).toMatchObject({
      status: "published",
      currentVersionId: version.id,
    })
    expect(store.versions.get(version.id)).toMatchObject({
      status: "published",
      publishedBy: ACTOR.id,
      publishedAt: NOW + 10,
    })
    const publication = store.catalogVersions.get(result.publicationVersion)!
    expect(publication).toMatchObject({
      status: "candidate",
      publisher: ACTOR.id,
      productVersionIds: [version.id],
    })
    expect(publication.checksum).toBe(
      catalogPublicationChecksum({
        version: publication.version,
        productVersionIds: publication.productVersionIds,
        priceBookVersion: publication.priceBookVersion,
        entitlementVersion: publication.entitlementVersion,
      }),
    )
    expect(store.versions.get(version.id)!.checksum).toBe(
      versionChecksum(store.versions.get(version.id)!),
    )
    expect(store.catalogVersions.size).toBe(1)
    expect(audit.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "catalog.product.publish" }),
    )
  })

  it("refuses publication without a draft and after archive", async () => {
    const store = new MemoryAuthoringStore()
    const { product } = await createdProduct(store)

    await publishCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: product.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })

    await expect(
      publishCatalogProduct({
        productId: product.id,
        body: { expectedUpdatedAt: store.products.get(product.id)!.updatedAt },
        actor: ACTOR,
        store,
        now: NOW + 20,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await archiveCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: store.products.get(product.id)!.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 30,
    })

    await expect(
      createCatalogVersion({
        productId: product.id,
        body: {
          expectedUpdatedAt: store.products.get(product.id)!.updatedAt,
          name: "Archived",
          changeSummary: "Should not work",
        },
        actor: ACTOR,
        store,
        now: NOW + 40,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_CONFLICT" })
  })

  it("archives without deleting versions or mappings", async () => {
    const store = new MemoryAuthoringStore()
    const { product, version } = await createdProduct(store)
    await publishCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: product.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })
    const before = store.versions.get(version.id)!

    const result = await archiveCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: store.products.get(product.id)!.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 20,
    })

    expect(result).toEqual({ productId: product.id, status: "archived" })
    expect(store.products.get(product.id)).toMatchObject({
      status: "archived",
      archivedBy: ACTOR.id,
      archivedAt: NOW + 20,
    })
    expect(store.versions.get(version.id)).toEqual(before)
    expect(audit.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "catalog.product.archive" }),
    )
  })

  it("preserves every historical version across draft replacement and publication", async () => {
    const store = new MemoryAuthoringStore()
    const { product, version: v1 } = await createdProduct(store)
    await publishCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: product.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })
    const v2 = await createCatalogVersion({
      productId: product.id,
      body: {
        expectedUpdatedAt: store.products.get(product.id)!.updatedAt,
        priceMinor: 15_000,
        changeSummary: "v2 draft",
      },
      actor: ACTOR,
      store,
      now: NOW + 20,
    })
    const v3 = await updateCatalogProduct({
      productId: product.id,
      body: {
        expectedUpdatedAt: store.products.get(product.id)!.updatedAt,
        name: "Studio v3",
        changeSummary: "v3 draft",
      },
      actor: ACTOR,
      store,
      now: NOW + 30,
    })
    await publishCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: store.products.get(product.id)!.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 40,
    })

    expect([...store.versions.keys()].sort()).toEqual([v1.id, v2.versionId, v3.versionId].sort())
    expect(store.versions.get(v1.id)).toMatchObject({ status: "published", priceMinor: 12_500 })
    expect(store.versions.get(v2.versionId)).toMatchObject({ status: "archived", priceMinor: 15_000 })
    expect(store.versions.get(v3.versionId)).toMatchObject({ status: "published", name: "Studio v3" })
  })

  it("refuses to edit a published version directly", async () => {
    const store = new MemoryAuthoringStore()
    const { product, version } = await createdProduct(store)
    await publishCatalogProduct({
      productId: product.id,
      body: { expectedUpdatedAt: product.updatedAt },
      actor: ACTOR,
      store,
      now: NOW + 10,
    })
    const published = structuredClone(store.versions.get(version.id)!)

    await updateCatalogProduct({
      productId: product.id,
      body: {
        expectedUpdatedAt: store.products.get(product.id)!.updatedAt,
        priceMinor: 1,
        changeSummary: "New draft only",
      },
      actor: ACTOR,
      store,
      now: NOW + 20,
    })

    expect(store.versions.get(version.id)).toEqual(published)
  })

  it("returns NOT_FOUND for an unknown product", async () => {
    const store = new MemoryAuthoringStore()
    await expect(
      updateCatalogProduct({
        productId: "prod_missing",
        body: { expectedUpdatedAt: 1, name: "x", changeSummary: "x" },
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 })
    await expect(
      publishCatalogProduct({
        productId: "prod_missing",
        body: { expectedUpdatedAt: 1 },
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      archiveCatalogProduct({
        productId: "prod_missing",
        body: { expectedUpdatedAt: 1 },
        actor: ACTOR,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("surfaces schema errors as VALIDATION AppErrors", async () => {
    const store = new MemoryAuthoringStore()
    const promise = createCatalogProduct({
      body: { type: "subscription", slug: "x" },
      actor: ACTOR,
      store,
      now: NOW,
    })
    await expect(promise).rejects.toBeInstanceOf(AppError)
    await expect(promise).rejects.toMatchObject({ code: "VALIDATION" })
  })
})
