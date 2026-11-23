import { logger } from "@/lib/logging/logger"
import {
  commercialCatalogVersionsCol,
  commercialProductVersionsCol,
  commercialProductsCol,
  dodoProductMappingsCol,
  ensureIndexes,
  paymentRecordsCol,
  subscriptionRecordsCol,
} from "@/lib/db/collections"
import {
  CATALOG_VERSION,
  buildCodeCatalogSnapshot,
  stableCatalogJson,
} from "./code-catalog"
import type {
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "./types"

export type CatalogSeedMode = "dry-run" | "apply" | "skipped"
export type CatalogWriteOutcome = "inserted" | "existing"

export interface BillingDodoProductId {
  source: "subscription_records" | "payment_records"
  dodoProductId: string
  count: number
}

export interface CatalogSeedStore {
  hasCatalogVersion(version: string): Promise<boolean>
  upsertProduct(doc: CommercialProductDoc): Promise<CatalogWriteOutcome>
  upsertVersion(doc: CommercialProductVersionDoc): Promise<CatalogWriteOutcome>
  upsertMapping(doc: DodoProductMappingDoc): Promise<CatalogWriteOutcome>
  upsertCatalogVersion(doc: CommercialCatalogVersionDoc): Promise<CatalogWriteOutcome>
  listProducts(): Promise<CommercialProductDoc[]>
  listVersions(): Promise<CommercialProductVersionDoc[]>
  listMappings(): Promise<DodoProductMappingDoc[]>
  getCatalogVersion(version: string): Promise<CommercialCatalogVersionDoc | null>
  listCatalogVersions(): Promise<CommercialCatalogVersionDoc[]>
  listBillingDodoProductIds(): Promise<BillingDodoProductId[]>
}

export interface CatalogSeedReport {
  mode: CatalogSeedMode
  catalogVersion: string
  products: { planned: number; created: number; existing: number }
  versions: { planned: number; created: number; existing: number }
  mappings: { planned: number; created: number; existing: number }
  catalogVersionRecord: "created" | "existing" | "planned" | "skipped"
  unknownDodoProductIds: BillingDodoProductId[]
  warnings: string[]
  touchedCollections: string[]
}

export interface CatalogMismatch {
  path: string
  expected: unknown
  actual: unknown
}

export interface CatalogVerificationReport {
  ok: boolean
  catalogVersion: string
  expected: { products: number; versions: number; mappings: number }
  actual: { products: number; versions: number; mappings: number }
  mismatches: CatalogMismatch[]
  unknownDodoProductIds: BillingDodoProductId[]
  warnings: string[]
}

/**
 * Mongo-backed seed store. It only touches the four A7.0 catalog collections
 * and reads Dodo product ids from existing subscription/payment records for
 * reconciliation. It never writes subscriptions, payments or the ledger.
 */
export async function mongoCatalogSeedStore(): Promise<CatalogSeedStore> {
  const products = await commercialProductsCol()
  const versions = await commercialProductVersionsCol()
  const mappings = await dodoProductMappingsCol()
  const catalogVersions = await commercialCatalogVersionsCol()
  const subscriptions = await subscriptionRecordsCol()
  const payments = await paymentRecordsCol()
  // A catalog write must not race the unique-index bootstrap.
  await ensureIndexes()

  return {
    async hasCatalogVersion(version) {
      return (await catalogVersions.findOne({ version }, { projection: { _id: 1 } })) !== null
    },
    async upsertProduct(doc) {
      const result = await products.updateOne({ id: doc.id }, { $setOnInsert: doc }, { upsert: true })
      return result.upsertedCount > 0 ? "inserted" : "existing"
    },
    async upsertVersion(doc) {
      const result = await versions.updateOne(
        { productId: doc.productId, version: doc.version },
        { $setOnInsert: doc },
        { upsert: true },
      )
      return result.upsertedCount > 0 ? "inserted" : "existing"
    },
    async upsertMapping(doc) {
      const result = await mappings.updateOne(
        {
          productVersionId: doc.productVersionId,
          cycle: doc.cycle,
          environment: doc.environment,
        },
        { $setOnInsert: doc },
        { upsert: true },
      )
      return result.upsertedCount > 0 ? "inserted" : "existing"
    },
    async upsertCatalogVersion(doc) {
      const result = await catalogVersions.updateOne(
        { version: doc.version },
        { $setOnInsert: doc },
        { upsert: true },
      )
      return result.upsertedCount > 0 ? "inserted" : "existing"
    },
    async listProducts() {
      return products.find({}).sort({ type: 1, id: 1 }).toArray()
    },
    async listVersions() {
      return versions.find({}).sort({ productId: 1, version: 1 }).toArray()
    },
    async listMappings() {
      return mappings.find({}).sort({ productVersionId: 1, cycle: 1 }).toArray()
    },
    async getCatalogVersion(version) {
      return catalogVersions.findOne({ version })
    },
    async listCatalogVersions() {
      return catalogVersions.find({}).sort({ publishedAt: -1 }).toArray()
    },
    async listBillingDodoProductIds() {
      const subscriptionRows = await subscriptions
        .aggregate<{ _id: string; count: number }>([
          { $match: { dodoProductId: { $type: "string" } } },
          { $group: { _id: "$dodoProductId", count: { $sum: 1 } } },
        ])
        .toArray()
      const paymentRows = await payments
        .aggregate<{ _id: string; count: number }>([
          { $match: { productId: { $type: "string" } } },
          { $group: { _id: "$productId", count: { $sum: 1 } } },
        ])
        .toArray()

      return [
        ...subscriptionRows.map((row) => ({
          source: "subscription_records" as const,
          dodoProductId: row._id,
          count: row.count,
        })),
        ...paymentRows.map((row) => ({
          source: "payment_records" as const,
          dodoProductId: row._id,
          count: row.count,
        })),
      ]
    },
  }
}

export function findUnknownDodoProductIds(
  expectedMappings: DodoProductMappingDoc[],
  billingIds: BillingDodoProductId[],
): BillingDodoProductId[] {
  const known = new Set(expectedMappings.map((mapping) => mapping.dodoProductId))
  return billingIds.filter((row) => !known.has(row.dodoProductId))
}

function emptyReport(mode: CatalogSeedMode, catalogVersion: string): CatalogSeedReport {
  return {
    mode,
    catalogVersion,
    products: { planned: 0, created: 0, existing: 0 },
    versions: { planned: 0, created: 0, existing: 0 },
    mappings: { planned: 0, created: 0, existing: 0 },
    catalogVersionRecord: mode === "dry-run" ? "planned" : "skipped",
    unknownDodoProductIds: [],
    warnings: [],
    touchedCollections: [],
  }
}

/**
 * Seed the complete current commercial catalog.
 *
 * `$setOnInsert` is the only write. Re-running never rewrites an existing
 * product or version; a changed code definition is reported by verification,
 * not silently reconciled over a published version.
 */
export async function seedCommercialCatalog(input: {
  store: CatalogSeedStore
  mode?: "dry-run" | "apply"
  now?: number
  env?: NodeJS.ProcessEnv
}): Promise<CatalogSeedReport> {
  const mode = input.mode ?? "apply"
  const now = input.now ?? Date.now()
  const snapshot = buildCodeCatalogSnapshot({ now, env: input.env })
  const report = emptyReport(mode, CATALOG_VERSION)

  report.products.planned = snapshot.products.length
  report.versions.planned = snapshot.versions.length
  report.mappings.planned = snapshot.mappings.length

  if (mode === "apply") {
    report.touchedCollections = [
      "commercial_products",
      "commercial_product_versions",
      "dodo_product_mappings",
      "commercial_catalog_versions",
    ]

    for (const product of snapshot.products) {
      const outcome = await input.store.upsertProduct(product)
      if (outcome === "inserted") report.products.created++
      else report.products.existing++
    }
    for (const version of snapshot.versions) {
      const outcome = await input.store.upsertVersion(version)
      if (outcome === "inserted") report.versions.created++
      else report.versions.existing++
    }
    for (const mapping of snapshot.mappings) {
      const outcome = await input.store.upsertMapping(mapping)
      if (outcome === "inserted") report.mappings.created++
      else report.mappings.existing++
    }
    const catalogOutcome = await input.store.upsertCatalogVersion(snapshot.catalogVersion)
    report.catalogVersionRecord = catalogOutcome === "inserted" ? "created" : "existing"
  }

  report.unknownDodoProductIds = findUnknownDodoProductIds(
    snapshot.mappings,
    await input.store.listBillingDodoProductIds(),
  )
  if (report.unknownDodoProductIds.length > 0) {
    report.warnings.push(
      `${report.unknownDodoProductIds.length} Dodo product id(s) found in billing records have no catalog mapping.`,
    )
  }

  if (mode === "apply") {
    logger.info("billing.catalog.seed", "commercial catalog seed applied", {
      catalogVersion: report.catalogVersion,
      productsCreated: report.products.created,
      productsExisting: report.products.existing,
      versionsCreated: report.versions.created,
      versionsExisting: report.versions.existing,
      mappingsCreated: report.mappings.created,
      mappingsExisting: report.mappings.existing,
      catalogVersionRecord: report.catalogVersionRecord,
      unknownDodoProductIds: report.unknownDodoProductIds.length,
    })
  }

  return report
}

/**
 * Startup/read-path bootstrap: seed only when the catalog version marker is
 * absent. The seed writes the marker last, so a partial failure is retried.
 */
export async function ensureCommercialCatalogSeeded(
  store?: CatalogSeedStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CatalogSeedReport> {
  const catalogStore = store ?? (await mongoCatalogSeedStore())
  if (await catalogStore.hasCatalogVersion(CATALOG_VERSION)) {
    return emptyReport("skipped", CATALOG_VERSION)
  }
  return seedCommercialCatalog({ store: catalogStore, mode: "apply", env })
}

function withoutMongoId<T extends { _id?: unknown }>(doc: T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...doc }
  delete copy._id
  return copy
}

function productComparable(doc: CommercialProductDoc): Record<string, unknown> {
  const copy = withoutMongoId(doc)
  delete copy.createdAt
  delete copy.updatedAt
  return copy
}

function versionComparable(doc: CommercialProductVersionDoc): Record<string, unknown> {
  const copy = withoutMongoId(doc)
  delete copy.createdAt
  delete copy.effectiveAt
  delete copy.publishedAt
  return copy
}

function mappingComparable(doc: DodoProductMappingDoc): Record<string, unknown> {
  const copy = withoutMongoId(doc)
  delete copy.lastSyncedAt
  delete copy.validatedAt
  return copy
}

function catalogVersionComparable(doc: CommercialCatalogVersionDoc): Record<string, unknown> {
  const copy = withoutMongoId(doc)
  delete copy.publishedAt
  if (Array.isArray(copy.productVersionIds)) {
    copy.productVersionIds = [...(copy.productVersionIds as string[])].sort()
  }
  return copy
}

function collectMismatches(
  path: string,
  expected: unknown,
  actual: unknown,
  mismatches: CatalogMismatch[],
): void {
  if (stableCatalogJson(expected) === stableCatalogJson(actual)) return
  const expectedObject =
    expected && typeof expected === "object" && !Array.isArray(expected)
      ? (expected as Record<string, unknown>)
      : null
  const actualObject =
    actual && typeof actual === "object" && !Array.isArray(actual)
      ? (actual as Record<string, unknown>)
      : null
  if (expectedObject && actualObject) {
    const keys = new Set([...Object.keys(expectedObject), ...Object.keys(actualObject)])
    for (const key of [...keys].sort()) {
      collectMismatches(`${path}.${key}`, expectedObject[key], actualObject[key], mismatches)
    }
    return
  }
  mismatches.push({ path, expected, actual })
}

function compareCollection<T extends object>(
  label: string,
  expected: T[],
  actual: T[],
  keyOf: (doc: T) => string,
  comparable: (doc: T) => Record<string, unknown>,
  mismatches: CatalogMismatch[],
): void {
  const expectedByKey = new Map(expected.map((doc) => [keyOf(doc), doc]))
  const actualByKey = new Map(actual.map((doc) => [keyOf(doc), doc]))
  for (const [key, doc] of expectedByKey) {
    const found = actualByKey.get(key)
    if (!found) {
      mismatches.push({ path: `${label}.${key}`, expected: "present", actual: "missing" })
      continue
    }
    collectMismatches(`${label}.${key}`, comparable(doc), comparable(found), mismatches)
  }
  for (const key of actualByKey.keys()) {
    if (!expectedByKey.has(key)) {
      mismatches.push({ path: `${label}.${key}`, expected: "absent", actual: "present" })
    }
  }
}

/**
 * Deterministic comparison between the code catalog and the seeded database.
 * A mismatch is reported; nothing is rewritten.
 */
export async function verifyCommercialCatalogSeed(input: {
  store: CatalogSeedStore
  env?: NodeJS.ProcessEnv
}): Promise<CatalogVerificationReport> {
  const snapshot = buildCodeCatalogSnapshot({ env: input.env })
  const [products, versions, mappings, catalogVersion, billingIds] = await Promise.all([
    input.store.listProducts(),
    input.store.listVersions(),
    input.store.listMappings(),
    input.store.getCatalogVersion(CATALOG_VERSION),
    input.store.listBillingDodoProductIds(),
  ])
  const mismatches: CatalogMismatch[] = []

  compareCollection(
    "products",
    snapshot.products,
    products,
    (doc) => doc.id,
    productComparable,
    mismatches,
  )
  compareCollection(
    "versions",
    snapshot.versions,
    versions,
    (doc) => doc.id,
    versionComparable,
    mismatches,
  )
  compareCollection(
    "mappings",
    snapshot.mappings,
    mappings,
    (doc) => `${doc.productVersionId}:${doc.cycle}:${doc.environment}`,
    mappingComparable,
    mismatches,
  )

  if (!catalogVersion) {
    mismatches.push({
      path: `catalogVersions.${CATALOG_VERSION}`,
      expected: "present",
      actual: "missing",
    })
  } else {
    collectMismatches(
      `catalogVersions.${CATALOG_VERSION}`,
      catalogVersionComparable(snapshot.catalogVersion),
      catalogVersionComparable(catalogVersion),
      mismatches,
    )
  }

  const unknownDodoProductIds = findUnknownDodoProductIds(snapshot.mappings, billingIds)
  const warnings: string[] = []
  if (unknownDodoProductIds.length > 0) {
    warnings.push(
      `${unknownDodoProductIds.length} Dodo product id(s) found in billing records have no catalog mapping.`,
    )
  }

  return {
    ok: mismatches.length === 0,
    catalogVersion: CATALOG_VERSION,
    expected: {
      products: snapshot.products.length,
      versions: snapshot.versions.length,
      mappings: snapshot.mappings.length,
    },
    actual: {
      products: products.length,
      versions: versions.length,
      mappings: mappings.length,
    },
    mismatches,
    unknownDodoProductIds,
    warnings,
  }
}
