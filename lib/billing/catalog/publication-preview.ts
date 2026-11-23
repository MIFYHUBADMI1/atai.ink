import { AppError } from "@/lib/errors"
import { logger } from "@/lib/logging/logger"
import { stableCatalogJson } from "./code-catalog"
import {
  assertCheckoutCompatible,
  PublishedCatalogError,
  resolvePublicationCatalog,
  type PublishedCatalogErrorReason,
} from "./published-resolver"
import type {
  CatalogPublicationStatus,
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
} from "./types"
import type { CatalogSeedStore } from "./seed"

export interface CatalogPublicationSummary {
  version: string
  status: CatalogPublicationStatus
  checksum: string
  publishedAt: number
  publisher: string
  productCount: number
  notes?: string
}

export interface CatalogPublicationChange {
  productId: string
  path: string
  before: unknown
  after: unknown
}

export interface CatalogPublicationPreviewError {
  reason: PublishedCatalogErrorReason | "CANDIDATE_NOT_CANDIDATE"
  detail?: Record<string, unknown>
}

export interface CatalogPublicationPreview {
  candidate: CatalogPublicationSummary | null
  active: CatalogPublicationSummary | null
  diff: {
    added: string[]
    removed: string[]
    changed: CatalogPublicationChange[]
  }
  errors: CatalogPublicationPreviewError[]
  warnings: string[]
  checkoutCompatible: boolean
  ready: boolean
}

const DIFF_FIELDS: Array<keyof CommercialProductVersionDoc> = [
  "name",
  "description",
  "tagline",
  "saleMode",
  "currency",
  "priceMinor",
  "annualPriceMinor",
  "billingIntervals",
  "credits",
  "entitlement",
  "infrastructure",
  "dodo",
]

function summary(publication: CommercialCatalogVersionDoc): CatalogPublicationSummary {
  return {
    version: publication.version,
    status: publication.status,
    checksum: publication.checksum,
    publishedAt: publication.publishedAt,
    publisher: publication.publisher,
    productCount: publication.productVersionIds.length,
    notes: publication.notes,
  }
}

function publicationError(error: unknown): CatalogPublicationPreviewError | null {
  if (error instanceof PublishedCatalogError) {
    return { reason: error.reason, detail: error.detail }
  }
  logger.error("billing.catalog.preview", "catalog preview failed", {
    message: error instanceof Error ? error.message : String(error),
  })
  return { reason: "DB_UNAVAILABLE" }
}

function productVersions(
  publication: CommercialCatalogVersionDoc,
  versionById: Map<string, CommercialProductVersionDoc>,
): Map<string, CommercialProductVersionDoc> {
  const result = new Map<string, CommercialProductVersionDoc>()
  for (const versionId of publication.productVersionIds) {
    const version = versionById.get(versionId)
    if (version) result.set(version.productId, version)
  }
  return result
}

function diffPublications(
  candidate: CommercialCatalogVersionDoc,
  active: CommercialCatalogVersionDoc | null,
  versions: CommercialProductVersionDoc[],
): CatalogPublicationPreview["diff"] {
  const versionById = new Map(versions.map((version) => [version.id, version]))
  const next = productVersions(candidate, versionById)
  const previous = active ? productVersions(active, versionById) : new Map<string, CommercialProductVersionDoc>()

  const added = [...next.keys()].filter((productId) => !previous.has(productId)).sort()
  const removed = [...previous.keys()].filter((productId) => !next.has(productId)).sort()
  const changed: CatalogPublicationChange[] = []

  for (const productId of [...next.keys()].filter((id) => previous.has(id)).sort()) {
    const before = previous.get(productId)!
    const after = next.get(productId)!
    for (const field of DIFF_FIELDS) {
      const beforeValue = before[field]
      const afterValue = after[field]
      if (stableCatalogJson(beforeValue) === stableCatalogJson(afterValue)) continue
      changed.push({ productId, path: field, before: beforeValue ?? null, after: afterValue ?? null })
    }
  }

  return { added, removed, changed }
}

function checkoutCompatibility(
  publication: CommercialCatalogVersionDoc,
  products: CommercialProductDoc[],
  versions: CommercialProductVersionDoc[],
  now: number,
  env: NodeJS.ProcessEnv,
): boolean {
  try {
    const resolved = resolvePublicationCatalog({
      publication,
      products,
      versions,
      now,
      requestedSource: "db",
      publicReadsEnabled: true,
      env,
    })
    assertCheckoutCompatible(resolved, env)
    return true
  } catch (error) {
    const reason = error instanceof PublishedCatalogError ? error.reason : "DB_UNAVAILABLE"
    logger.warn("billing.catalog.preview", "candidate is not checkout-compatible", {
      publication: publication.version,
      reason,
    })
    return false
  }
}

/**
 * Read-only preview of the latest (or named) candidate publication. It uses
 * the same validator and projection as activation and customer reads, but it
 * never mutates a publication, product, version or mapping.
 */
export async function previewCatalogPublication(input: {
  store: CatalogSeedStore
  version?: string
  now?: number
  env?: NodeJS.ProcessEnv
}): Promise<CatalogPublicationPreview> {
  const now = input.now ?? Date.now()
  const env = input.env ?? process.env
  const [publications, products, versions] = await Promise.all([
    input.store.listCatalogVersions(),
    input.store.listProducts(),
    input.store.listVersions(),
  ])

  const candidates = publications
    .filter((publication) => publication.status === "candidate")
    .sort((a, b) => b.publishedAt - a.publishedAt)
  const candidate = input.version
    ? candidates.find((publication) => publication.version === input.version)
    : candidates[0]

  if (input.version && !candidate) {
    throw new AppError("NOT_FOUND", "Candidate publication not found.", 404)
  }

  const activePublications = publications.filter((publication) => publication.status === "active")
  const active = activePublications.sort((a, b) => b.publishedAt - a.publishedAt)[0] ?? null

  if (!candidate) {
    return {
      candidate: null,
      active: active ? summary(active) : null,
      diff: { added: [], removed: [], changed: [] },
      errors: [],
      warnings: ["No candidate publication exists. Publish a product draft first."],
      checkoutCompatible: false,
      ready: false,
    }
  }

  const errors: CatalogPublicationPreviewError[] = []
  const warnings: string[] = []

  if (candidate.status !== "candidate") {
    errors.push({ reason: "CANDIDATE_NOT_CANDIDATE", detail: { status: candidate.status } })
  }
  if (activePublications.length > 1) {
    warnings.push(
      `There are ${activePublications.length} active publications. Activation will supersede every active snapshot.`,
    )
  }
  if (!active) {
    warnings.push("There is no active database publication yet. Activation will create the first one.")
  }

  const futureVersions = versions.filter(
    (version) =>
      candidate.productVersionIds.includes(version.id) && version.effectiveAt > now,
  )
  if (futureVersions.length > 0) {
    warnings.push(
      `${futureVersions.length} candidate version(s) are effective in the future. Activation is blocked until they are due.`,
    )
  }

  try {
    resolvePublicationCatalog({
      publication: candidate,
      products,
      versions,
      now,
      requestedSource: "db",
      publicReadsEnabled: true,
      env,
    })
  } catch (error) {
    const failure = publicationError(error)
    if (failure) errors.push(failure)
  }

  if (active) {
    try {
      resolvePublicationCatalog({
        publication: active,
        products,
        versions,
        now,
        requestedSource: "db",
        publicReadsEnabled: true,
        env,
      })
    } catch (error) {
      const failure = publicationError(error)
      warnings.push(
        `The active publication does not resolve cleanly (${failure?.reason ?? "DB_UNAVAILABLE"}). Activation will replace it.`,
      )
    }
  }

  const compatible = checkoutCompatibility(candidate, products, versions, now, env)
  if (!compatible) {
    warnings.push(
      "The candidate is not checkout-compatible with the code catalog. Activation is blocked until prices, credits and Dodo product ids are aligned.",
    )
  }

  const ready = errors.length === 0 && compatible && futureVersions.length === 0

  return {
    candidate: summary(candidate),
    active: active ? summary(active) : null,
    diff: diffPublications(candidate, active, versions),
    errors,
    warnings,
    checkoutCompatible: compatible,
    ready,
  }
}
