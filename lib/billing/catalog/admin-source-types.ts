import type { CatalogSource } from "./source"

/** What checkout/customer reads actually use. `unavailable` means the
 * database catalog was selected for customers but cannot be resolved. */
export type AdminCheckoutSource = CatalogSource | "unavailable"

export interface AdminCatalogPublicationView {
  version: string
  publishedAt: number
  activatedAt?: number
  productCount: number
  checksum: string
}

export interface AdminCatalogSourceView {
  requestedSource: CatalogSource
  /** What this admin view is showing (database when it resolved). */
  adminSource: CatalogSource
  checkoutSource: AdminCheckoutSource
  publicReadsEnabled: boolean
  gated: boolean
  publication: AdminCatalogPublicationView | null
  shadowDifferences: number
  error: string | null
}
