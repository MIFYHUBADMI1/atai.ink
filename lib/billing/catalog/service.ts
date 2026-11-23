import {
  ensureCommercialCatalogSeeded,
  mongoCatalogSeedStore,
  type CatalogSeedStore,
} from "./seed"
import type {
  CatalogProductDetail,
  CatalogProductView,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "./types"

function mappingStatus(
  mappings: DodoProductMappingDoc[],
): CatalogProductView["dodoStatus"] {
  if (mappings.length === 0) return "missing"
  if (mappings.some((mapping) => mapping.status === "invalid")) return "invalid"
  if (mappings.every((mapping) => mapping.status === "valid")) return "valid"
  return "unvalidated"
}

function currentVersion(
  product: CommercialProductDoc,
  versions: CommercialProductVersionDoc[],
): CommercialProductVersionDoc | null {
  if (product.currentVersionId) {
    const exact = versions.find((version) => version.id === product.currentVersionId)
    if (exact) return exact
  }
  return versions.sort((a, b) => b.version - a.version)[0] ?? null
}

function toView(
  product: CommercialProductDoc,
  versions: CommercialProductVersionDoc[],
  mappings: DodoProductMappingDoc[],
): CatalogProductView {
  const version = currentVersion(product, [...versions])
  const productMappings = mappings.filter((mapping) =>
    versions.some((candidate) => candidate.id === mapping.productVersionId),
  )
  return {
    id: product.id,
    type: product.type,
    slug: product.slug,
    status: product.status,
    saleMode: version?.saleMode ?? null,
    name: version?.name ?? product.id,
    description: version?.description ?? "",
    tagline: version?.tagline,
    legacyRenewalOnly: version?.saleMode === "legacy_renewal_only",
    currentVersionId: product.currentVersionId,
    currentVersion: version
      ? {
          id: version.id,
          version: version.version,
          status: version.status,
          currency: version.currency,
          priceMinor: version.priceMinor,
          annualPriceMinor: version.annualPriceMinor,
          billingIntervals: version.billingIntervals,
          credits: version.credits,
          infrastructure: version.infrastructure,
        }
      : null,
    versionCount: versions.length,
    dodoMappings: productMappings.map((mapping) => ({
      cycle: mapping.cycle,
      environment: mapping.environment,
      dodoProductId: mapping.dodoProductId,
      dodoProductName: mapping.dodoProductName,
      status: mapping.status,
      validatedAt: mapping.validatedAt,
    })),
    dodoStatus: mappingStatus(productMappings),
  }
}

/**
 * Read-only catalog list for the A7.0 admin surface.
 *
 * The first read bootstraps the seed if the catalog version marker is absent;
 * this is system initialization, not an authoring action. No checkout,
 * entitlement or credit path calls this function.
 */
export async function listCatalogProducts(
  store?: CatalogSeedStore,
): Promise<CatalogProductView[]> {
  const catalogStore = store ?? (await mongoCatalogSeedStore())
  await ensureCommercialCatalogSeeded(catalogStore)
  const [products, versions, mappings] = await Promise.all([
    catalogStore.listProducts(),
    catalogStore.listVersions(),
    catalogStore.listMappings(),
  ])
  return products.map((product) =>
    toView(
      product,
      versions.filter((version) => version.productId === product.id),
      mappings,
    ),
  )
}

export async function getCatalogProduct(
  productId: string,
  store?: CatalogSeedStore,
): Promise<CatalogProductDetail | null> {
  const catalogStore = store ?? (await mongoCatalogSeedStore())
  await ensureCommercialCatalogSeeded(catalogStore)
  const [products, versions, mappings] = await Promise.all([
    catalogStore.listProducts(),
    catalogStore.listVersions(),
    catalogStore.listMappings(),
  ])
  const product = products.find((candidate) => candidate.id === productId)
  if (!product) return null
  const productVersions = versions
    .filter((version) => version.productId === product.id)
    .sort((a, b) => b.version - a.version)
  const productMappings = mappings.filter((mapping) =>
    productVersions.some((version) => version.id === mapping.productVersionId),
  )
  return {
    ...toView(product, productVersions, productMappings),
    versions: productVersions,
    mappings: productMappings,
  }
}
