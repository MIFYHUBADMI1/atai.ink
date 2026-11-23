import { randomUUID } from "node:crypto"
import { AppError } from "@/lib/errors"
import { logAuditAction } from "@/lib/infrastructure/audit"
import { ENTITLEMENT_VERSION } from "@/lib/billing/entitlements/catalog"
import { PRICE_BOOK_VERSION } from "@/lib/billing/entitlements/price-book"
import { catalogPublicationChecksum, versionChecksum } from "./code-catalog"
import {
  mergeVersionFields,
  normalizeVersionFields,
  parseArchiveInput,
  parseCreateProductInput,
  parseCreateVersionInput,
  parsePublishInput,
  parseVersionMutationInput,
  validateVersionFields,
  type CatalogVersionFields,
} from "./authoring-schemas"
import {
  mongoCatalogAuthoringStore,
  type CatalogAuthoringStore,
  type ProductPatch,
  type VersionPatch,
} from "./authoring-store"
import type {
  CatalogProductType,
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
} from "./types"

export interface CatalogActor {
  id: string
  email?: string
}

export interface CatalogMutationResult {
  productId: string
  versionId: string
  version: number
  status: CommercialProductVersionDoc["status"]
}

export interface CatalogPublishResult extends CatalogMutationResult {
  publicationVersion: string
}

function conflict(message: string): never {
  throw new AppError("CATALOG_CONFLICT", message)
}

function validation(message: string): never {
  throw new AppError("VALIDATION", message)
}

function productIdFor(type: CatalogProductType, slug: string): string {
  const prefix =
    type === "subscription"
      ? "prod_subscription"
      : type === "credit_pack"
        ? "prod_pack"
        : "prod_infra"
  return `${prefix}_${slug.replace(/-/g, "_")}`
}

function nextUpdatedAt(product: CommercialProductDoc, now: number): number {
  return Math.max(now, product.updatedAt + 1)
}

function assertCurrent(product: CommercialProductDoc, expectedUpdatedAt: number): void {
  if (product.updatedAt !== expectedUpdatedAt) {
    conflict("This product changed since you loaded it. Reload and try again.")
  }
}

function assertNotArchived(product: CommercialProductDoc): void {
  if (product.status === "archived") {
    conflict("Archived products cannot be edited or published.")
  }
}

function fieldsFromVersion(version: CommercialProductVersionDoc): CatalogVersionFields {
  return {
    name: version.name,
    description: version.description,
    tagline: version.tagline,
    saleMode: version.saleMode,
    currency: version.currency,
    priceMinor: version.priceMinor,
    annualPriceMinor: version.annualPriceMinor,
    billingIntervals: version.billingIntervals,
    credits: version.credits,
    entitlement: version.entitlement,
    infrastructure: version.infrastructure,
    changeSummary: version.changeSummary,
    notes: version.notes,
  }
}

function buildVersion(input: {
  productId: string
  version: number
  status: CommercialProductVersionDoc["status"]
  fields: CatalogVersionFields
  actorId: string
  now: number
}): CommercialProductVersionDoc {
  const version: CommercialProductVersionDoc = {
    id: `${input.productId}_v${input.version}`,
    productId: input.productId,
    version: input.version,
    status: input.status,
    effectiveAt: input.now,
    name: input.fields.name,
    description: input.fields.description,
    tagline: input.fields.tagline,
    saleMode: input.fields.saleMode,
    currency: input.fields.currency,
    priceMinor: input.fields.priceMinor,
    annualPriceMinor: input.fields.annualPriceMinor,
    billingIntervals: input.fields.billingIntervals,
    credits: input.fields.credits,
    entitlement: input.fields.entitlement,
    infrastructure: input.fields.infrastructure,
    createdBy: input.actorId,
    createdAt: input.now,
    changeSummary: input.fields.changeSummary,
    notes: input.fields.notes,
    checksum: "",
  }
  version.checksum = versionChecksum(version)
  return version
}

function archivedDraftPatch(
  draft: CommercialProductVersionDoc,
  replacementVersion: number,
): VersionPatch {
  const note = `Superseded by v${replacementVersion} before publication.`
  const archived = {
    ...draft,
    status: "archived" as const,
    notes: draft.notes ? `${draft.notes}\n${note}` : note,
  }
  return {
    status: "archived",
    notes: archived.notes,
    checksum: versionChecksum(archived),
  }
}

async function loadCatalog(store: CatalogAuthoringStore) {
  const [products, versions] = await Promise.all([
    store.listProducts(),
    store.listVersions(),
  ])
  return { products, versions }
}

async function audit(input: {
  actor: CatalogActor
  action: string
  product: CommercialProductDoc
  version?: CommercialProductVersionDoc
  previousValue?: string
  newValue?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await logAuditAction({
    adminUserId: input.actor.id,
    adminUserEmail: input.actor.email,
    action: input.action,
    previousValue: input.previousValue,
    newValue: input.newValue,
    result: "success",
    metadata: {
      productId: input.product.id,
      productType: input.product.type,
      slug: input.product.slug,
      ...(input.version
        ? { versionId: input.version.id, version: input.version.version }
        : {}),
      ...(input.metadata ?? {}),
    },
  })
}

export async function createCatalogProduct(input: {
  body: unknown
  actor: CatalogActor
  store?: CatalogAuthoringStore
  now?: number
}): Promise<CatalogMutationResult> {
  const parsed = parseCreateProductInput(input.body)
  const fields = normalizeVersionFields(parsed.type, parsed)
  const invalid = validateVersionFields(parsed.type, fields)
  if (invalid) validation(invalid)

  const store = input.store ?? (await mongoCatalogAuthoringStore())
  const now = input.now ?? Date.now()
  const { products } = await loadCatalog(store)
  const productId = productIdFor(parsed.type, parsed.slug)
  if (products.some((product) => product.id === productId || product.slug === parsed.slug)) {
    conflict("A product with that identity or slug already exists.")
  }

  const product: CommercialProductDoc = {
    id: productId,
    type: parsed.type,
    slug: parsed.slug,
    status: "draft",
    currentVersionId: null,
    createdBy: input.actor.id,
    createdAt: now,
    updatedAt: now,
  }
  const version = buildVersion({
    productId,
    version: 1,
    status: "draft",
    fields,
    actorId: input.actor.id,
    now,
  })
  const outcome = await store.createProductWithVersion(product, version)
  if (outcome === "duplicate") {
    conflict("A product with that identity or slug already exists.")
  }

  await audit({
    actor: input.actor,
    action: "catalog.product.create",
    product,
    version,
  })
  return {
    productId,
    versionId: version.id,
    version: version.version,
    status: version.status,
  }
}

export async function createCatalogVersion(input: {
  productId: string
  body: unknown
  actor: CatalogActor
  store?: CatalogAuthoringStore
  now?: number
}): Promise<CatalogMutationResult> {
  const parsed = parseCreateVersionInput(input.body)
  const store = input.store ?? (await mongoCatalogAuthoringStore())
  const now = input.now ?? Date.now()
  const { products, versions } = await loadCatalog(store)
  const product = products.find((candidate) => candidate.id === input.productId)
  if (!product) throw new AppError("NOT_FOUND", "Catalog product not found.", 404)
  assertNotArchived(product)
  assertCurrent(product, parsed.expectedUpdatedAt)

  if (versions.some((version) => version.productId === product.id && version.status === "draft")) {
    conflict("A draft already exists. Edit it instead of creating a second draft.")
  }

  const base = versions
    .filter((version) => version.productId === product.id && version.status === "published")
    .sort((a, b) => b.version - a.version)[0]
  if (!base) conflict("Product has no published version to branch from.")

  const { expectedUpdatedAt: _expected, ...patch } = parsed
  const fields = mergeVersionFields(fieldsFromVersion(base), patch, product.type)
  const invalid = validateVersionFields(product.type, fields)
  if (invalid) validation(invalid)

  const versionNumber =
    Math.max(
      ...versions
        .filter((version) => version.productId === product.id)
        .map((version) => version.version),
      0,
    ) + 1
  const version = buildVersion({
    productId: product.id,
    version: versionNumber,
    status: "draft",
    fields,
    actorId: input.actor.id,
    now,
  })
  const productPatch: ProductPatch = { updatedAt: nextUpdatedAt(product, now) }
  const outcome = await store.replaceDraftVersion({
    productId: product.id,
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    productPatch,
    newVersion: version,
  })
  if (outcome === "conflict") conflict("This product changed since you loaded it. Reload and try again.")
  if (outcome === "duplicate_version") conflict("That version number already exists. Reload and try again.")

  await audit({
    actor: input.actor,
    action: "catalog.version.create",
    product,
    version,
  })
  return {
    productId: product.id,
    versionId: version.id,
    version: version.version,
    status: version.status,
  }
}

export async function updateCatalogProduct(input: {
  productId: string
  body: unknown
  actor: CatalogActor
  store?: CatalogAuthoringStore
  now?: number
}): Promise<CatalogMutationResult> {
  const parsed = parseVersionMutationInput(input.body)
  const store = input.store ?? (await mongoCatalogAuthoringStore())
  const now = input.now ?? Date.now()
  const { products, versions } = await loadCatalog(store)
  const product = products.find((candidate) => candidate.id === input.productId)
  if (!product) throw new AppError("NOT_FOUND", "Catalog product not found.", 404)
  assertNotArchived(product)
  assertCurrent(product, parsed.expectedUpdatedAt)

  const draft = versions
    .filter((version) => version.productId === product.id && version.status === "draft")
    .sort((a, b) => b.version - a.version)[0]
  const base = draft ??
    versions
      .filter((version) => version.productId === product.id && version.status === "published")
      .sort((a, b) => b.version - a.version)[0]
  if (!base) conflict("Product has no draft or published version to edit.")

  const { expectedUpdatedAt: _expected, ...patch } = parsed
  const fields = mergeVersionFields(fieldsFromVersion(base), patch, product.type)
  const invalid = validateVersionFields(product.type, fields)
  if (invalid) validation(invalid)

  const versionNumber =
    Math.max(
      ...versions
        .filter((version) => version.productId === product.id)
        .map((version) => version.version),
      0,
    ) + 1
  const version = buildVersion({
    productId: product.id,
    version: versionNumber,
    status: "draft",
    fields,
    actorId: input.actor.id,
    now,
  })
  const productPatch: ProductPatch = { updatedAt: nextUpdatedAt(product, now) }
  const outcome = await store.replaceDraftVersion({
    productId: product.id,
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    productPatch,
    oldDraft: draft
      ? {
          id: draft.id,
          checksum: draft.checksum,
          patch: archivedDraftPatch(draft, versionNumber),
        }
      : undefined,
    newVersion: version,
  })
  if (outcome === "conflict") conflict("This product changed since you loaded it. Reload and try again.")
  if (outcome === "duplicate_version") conflict("That version number already exists. Reload and try again.")

  await audit({
    actor: input.actor,
    action: "catalog.version.update",
    product,
    version,
    previousValue: draft?.id,
    newValue: version.id,
  })
  return {
    productId: product.id,
    versionId: version.id,
    version: version.version,
    status: version.status,
  }
}

export async function publishCatalogProduct(input: {
  productId: string
  body: unknown
  actor: CatalogActor
  store?: CatalogAuthoringStore
  now?: number
}): Promise<CatalogPublishResult> {
  const parsed = parsePublishInput(input.body)
  const store = input.store ?? (await mongoCatalogAuthoringStore())
  const now = input.now ?? Date.now()
  const { products, versions } = await loadCatalog(store)
  const product = products.find((candidate) => candidate.id === input.productId)
  if (!product) throw new AppError("NOT_FOUND", "Catalog product not found.", 404)
  assertNotArchived(product)
  assertCurrent(product, parsed.expectedUpdatedAt)

  const drafts = versions
    .filter((version) => version.productId === product.id && version.status === "draft")
    .sort((a, b) => b.version - a.version)
  if (drafts.length === 0) validation("There is no draft version to publish.")
  if (drafts.length > 1) conflict("Product has multiple drafts. Resolve the draft state before publishing.")
  const draft = drafts[0]
  if (draft.checksum !== versionChecksum(draft)) {
    conflict("Draft checksum does not match its contents. Reload before publishing.")
  }

  const fields = fieldsFromVersion(draft)
  const invalid = validateVersionFields(product.type, fields)
  if (invalid) validation(invalid)
  if (!fields.changeSummary.trim()) validation("A change summary is required to publish.")

  if (product.currentVersionId) {
    const current = versions.find((version) => version.id === product.currentVersionId)
    if (!current || current.status !== "published") {
      validation("The product's current version is not published. Repair the product before publishing.")
    }
  }

  const productVersionIds: string[] = []
  for (const candidate of products) {
    if (candidate.status === "archived") continue
    if (candidate.id === product.id) {
      productVersionIds.push(draft.id)
      continue
    }
    if (!candidate.currentVersionId) continue
    const current = versions.find((version) => version.id === candidate.currentVersionId)
    if (!current || current.status !== "published") {
      validation(`Product ${candidate.id} has an invalid current version.`)
    }
    productVersionIds.push(current.id)
  }
  productVersionIds.sort()

  const publicationVersion = `CATALOG_A72_${now}_${randomUUID().replace(/-/g, "").slice(0, 8)}`
  const publication: CommercialCatalogVersionDoc = {
    id: publicationVersion,
    version: publicationVersion,
    status: "candidate",
    productVersionIds,
    priceBookVersion: PRICE_BOOK_VERSION,
    entitlementVersion: ENTITLEMENT_VERSION,
    publisher: input.actor.id,
    publishedAt: now,
    notes: "A7.2 authoring snapshot. Not active; customer checkout remains code-based.",
    checksum: catalogPublicationChecksum({
      version: publicationVersion,
      productVersionIds,
      priceBookVersion: PRICE_BOOK_VERSION,
      entitlementVersion: ENTITLEMENT_VERSION,
    }),
  }

  const publishedVersion = {
    ...draft,
    status: "published" as const,
    publishedBy: input.actor.id,
    publishedAt: now,
    effectiveAt: now,
  }
  const versionPatch: VersionPatch = {
    status: "published",
    publishedBy: input.actor.id,
    publishedAt: now,
    effectiveAt: now,
    checksum: versionChecksum(publishedVersion),
  }
  const productPatch: ProductPatch = {
    status: "published",
    currentVersionId: draft.id,
    updatedAt: nextUpdatedAt(product, now),
  }

  const outcome = await store.publishVersion({
    productId: product.id,
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    versionId: draft.id,
    versionPatch,
    productPatch,
    publication,
  })
  if (outcome === "conflict") conflict("This product changed since you loaded it. Reload and try again.")
  if (outcome === "duplicate_publication") {
    conflict("The publication snapshot could not be saved uniquely. Try again.")
  }

  await audit({
    actor: input.actor,
    action: "catalog.product.publish",
    product,
    version: publishedVersion,
    previousValue: product.currentVersionId ?? "none",
    newValue: draft.id,
    metadata: { publicationVersion, publicationStatus: publication.status },
  })
  return {
    productId: product.id,
    versionId: draft.id,
    version: draft.version,
    status: "published",
    publicationVersion,
  }
}

export async function archiveCatalogProduct(input: {
  productId: string
  body: unknown
  actor: CatalogActor
  store?: CatalogAuthoringStore
  now?: number
}): Promise<{ productId: string; status: "archived" }> {
  const parsed = parseArchiveInput(input.body)
  const store = input.store ?? (await mongoCatalogAuthoringStore())
  const now = input.now ?? Date.now()
  const { products } = await loadCatalog(store)
  const product = products.find((candidate) => candidate.id === input.productId)
  if (!product) throw new AppError("NOT_FOUND", "Catalog product not found.", 404)
  if (product.status === "archived") conflict("Product is already archived.")
  assertCurrent(product, parsed.expectedUpdatedAt)

  const productPatch: ProductPatch = {
    status: "archived",
    archivedBy: input.actor.id,
    archivedAt: now,
    updatedAt: nextUpdatedAt(product, now),
  }
  const outcome = await store.archiveProduct({
    productId: product.id,
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    productPatch,
  })
  if (outcome === "conflict") conflict("This product changed since you loaded it. Reload and try again.")

  await audit({
    actor: input.actor,
    action: "catalog.product.archive",
    product,
    previousValue: product.status,
    newValue: "archived",
  })
  return { productId: product.id, status: "archived" }
}
