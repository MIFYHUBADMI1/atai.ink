/**
 * A7.0 catalog source flag.
 *
 * A7.0 must not change customer-facing behavior. `code` is the default and the
 * only source used by checkout, pricing and webhooks. `db` is reserved for
 * A7.1, where the published resolver will be switched behind this flag.
 */

export type CatalogSource = "code" | "db"

export const CATALOG_SOURCE_ENV = "CATALOG_SOURCE"

export function getCatalogSource(env: NodeJS.ProcessEnv = process.env): CatalogSource {
  return env[CATALOG_SOURCE_ENV] === "db" ? "db" : "code"
}

export function isCatalogDbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getCatalogSource(env) === "db"
}
