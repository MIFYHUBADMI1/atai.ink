export interface CatalogIndexCollection {
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
}

export interface CatalogIndexCollections {
  products: CatalogIndexCollection
  versions: CatalogIndexCollection
  mappings: CatalogIndexCollection
  catalogVersions: CatalogIndexCollection
}

/**
 * A7.0 catalog constraints.
 *
 * Product identity and slug are unique; a product can have only one row per
 * version; a Dodo product can belong to only one version/cycle/environment.
 * These are the database guarantees, not check-then-insert conventions.
 */
export async function ensureCommercialCatalogIndexes(
  collections: CatalogIndexCollections,
): Promise<void> {
  await Promise.all([
    collections.products.createIndex(
      { id: 1 },
      { unique: true, name: "commercial_products_id_unique" },
    ),
    collections.products.createIndex(
      { slug: 1 },
      { unique: true, name: "commercial_products_slug_unique" },
    ),
    collections.products.createIndex(
      { type: 1, status: 1 },
      { name: "commercial_products_type_status" },
    ),
    collections.products.createIndex(
      { updatedAt: -1 },
      { name: "commercial_products_updated" },
    ),

    collections.versions.createIndex(
      { id: 1 },
      { unique: true, name: "commercial_product_versions_id_unique" },
    ),
    collections.versions.createIndex(
      { productId: 1, version: 1 },
      { unique: true, name: "commercial_product_versions_product_version_unique" },
    ),
    collections.versions.createIndex(
      { productId: 1, status: 1, version: -1 },
      { name: "commercial_product_versions_product_status" },
    ),
    collections.versions.createIndex(
      { status: 1, effectiveAt: 1 },
      { name: "commercial_product_versions_status_effective" },
    ),

    collections.mappings.createIndex(
      { productVersionId: 1, cycle: 1, environment: 1 },
      { unique: true, name: "dodo_product_mappings_version_cycle_env_unique" },
    ),
    collections.mappings.createIndex(
      { environment: 1, dodoProductId: 1 },
      { unique: true, name: "dodo_product_mappings_env_dodo_unique" },
    ),
    collections.mappings.createIndex(
      { status: 1, lastSyncedAt: -1 },
      { name: "dodo_product_mappings_status_synced" },
    ),

    collections.catalogVersions.createIndex(
      { version: 1 },
      { unique: true, name: "commercial_catalog_versions_version_unique" },
    ),
    collections.catalogVersions.createIndex(
      { status: 1, publishedAt: -1 },
      { name: "commercial_catalog_versions_status_published" },
    ),
  ])
}
