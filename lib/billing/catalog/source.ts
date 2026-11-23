/**
 * Catalog source flag. `code` is the default. `db` selects the published
 * database catalog for A7.1 reads; checkout and webhooks still read code
 * constants until a later phase.
 */

export type CatalogSource = "code" | "db"

export const CATALOG_SOURCE_ENV = "CATALOG_SOURCE"
export const CATALOG_DB_PUBLIC_READS_ENV = "CATALOG_DB_PUBLIC_READS"

export function getCatalogSource(env: NodeJS.ProcessEnv = process.env): CatalogSource {
  return env[CATALOG_SOURCE_ENV] === "db" ? "db" : "code"
}

export function isCatalogDbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getCatalogSource(env) === "db"
}

/**
 * A7.1 rollout gate. Selecting `CATALOG_SOURCE=db` makes the resolver capable
 * of reading the database, but customer traffic only sees it after this
 * explicit opt-in. Until then the public surfaces deliberately use the code
 * catalog while checkout still reads code constants.
 */
export function isCatalogDbPublicReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CATALOG_DB_PUBLIC_READS_ENV] === "enabled"
}
