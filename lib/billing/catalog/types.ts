import type { ObjectId } from "mongodb"
import type { BillingInterval } from "@/lib/billing/billing-types"
import type { EntitlementSet } from "@/lib/billing/entitlements/types"

/**
 * A7.0 commercial catalog foundation types.
 *
 * These documents are the database representation of what ATAI sells. Product
 * identity is stable; every commercial change is an immutable product version.
 * Nothing in A7.0 reads these documents for checkout or entitlement decisions.
 */

export type CatalogProductType = "subscription" | "credit_pack" | "infrastructure"
export type CatalogProductStatus = "draft" | "published" | "archived"
export type CatalogSaleMode = "self_serve" | "free" | "contact" | "legacy_renewal_only"
export type CatalogCreditType = "subscription" | "permanent" | "promotional"
export type CatalogAnnualIssuance = "monthly" | "upfront"
export type CatalogDodoCycle = "monthly" | "annual" | "one_time"
export type CatalogDodoEnvironment = "test_mode" | "live_mode"
export type CatalogDodoMappingStatus = "unvalidated" | "valid" | "invalid" | "superseded"
export type CatalogInfrastructurePurchaseModel = "credit_funded" | "direct_purchase"
export type CatalogInfrastructureRenewal = "manual" | "auto" | "none"
export type CatalogPublicationStatus = "seeded" | "candidate" | "active" | "superseded"

export interface CatalogCreditTerms {
  creditType: CatalogCreditType
  /** Monthly subscription grant, when the product is a subscription. */
  monthlyGrant: number | null
  /** One-time grant for a credit package. */
  oneTimeGrant: number | null
  /** Independent annual total; may differ from monthlyGrant × annualMonths. */
  annualTotalCredits: number | null
  annualMonths: number | null
  annualIssuance: CatalogAnnualIssuance | null
  /** null means the credit lifetime is governed by the subscription period. */
  expiresAfterDays: number | null
  /** Extra promotional credits granted with the purchase. */
  bonusCredits: number | null
}

export interface CatalogEntitlementTemplate {
  templateId: string
  version: string
  /** Counts are zero; live counts are attached at resolution time. */
  snapshot: EntitlementSet
}

export interface CatalogInfrastructureTerms {
  purchaseModel: CatalogInfrastructurePurchaseModel
  durationDays: number
  renewal: CatalogInfrastructureRenewal
  storageLabel: string
  /** null means custom/unlimited. */
  storageBytes: number | null
  /** null means custom/unlimited. */
  totalumInfrastructureCredits: number | null
  /** Credits charged per purchase; null when priced directly in fiat. */
  creditCharge: number | null
  includedResources: Record<string, unknown>
}

export interface CatalogDodoConfig {
  monthlyProductId?: string
  annualProductId?: string
  oneTimeProductId?: string
  environment: CatalogDodoEnvironment
}

export interface CommercialProductDoc {
  _id?: ObjectId
  id: string
  type: CatalogProductType
  slug: string
  status: CatalogProductStatus
  currentVersionId: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
  archivedBy?: string
  archivedAt?: number
}

export interface CommercialProductVersionDoc {
  _id?: ObjectId
  id: string
  productId: string
  version: number
  status: CatalogProductStatus
  effectiveAt: number
  name: string
  description: string
  tagline?: string
  saleMode: CatalogSaleMode
  currency: string
  priceMinor: number | null
  annualPriceMinor: number | null
  billingIntervals: BillingInterval[]
  credits: CatalogCreditTerms | null
  entitlement: CatalogEntitlementTemplate | null
  infrastructure?: CatalogInfrastructureTerms
  dodo?: CatalogDodoConfig
  createdBy: string
  createdAt: number
  publishedBy?: string
  publishedAt?: number
  changeSummary: string
  notes?: string
  /** SHA-256 of the version's business fields; detects drift. */
  checksum: string
}

export interface DodoProductMappingDoc {
  _id?: ObjectId
  productVersionId: string
  cycle: CatalogDodoCycle
  environment: CatalogDodoEnvironment
  dodoProductId: string
  dodoProductName: string
  dodoPriceMinor: number
  dodoCurrency: string
  dodoInterval: "month" | "year" | "one_time"
  status: CatalogDodoMappingStatus
  validatedAt?: number
  lastSyncedAt: number
}

export interface CommercialCatalogVersionDoc {
  _id?: ObjectId
  id: string
  version: string
  status: CatalogPublicationStatus
  productVersionIds: string[]
  priceBookVersion: string
  entitlementVersion: string
  publisher: string
  publishedAt: number
  activatedBy?: string
  activatedAt?: number
  supersededBy?: string
  supersededAt?: number
  notes?: string
  checksum: string
}

export interface CatalogVersionSummary {
  id: string
  version: number
  status: CatalogProductStatus
  name: string
  description: string
  tagline?: string
  saleMode: CatalogSaleMode
  currency: string
  priceMinor: number | null
  annualPriceMinor: number | null
  billingIntervals: BillingInterval[]
  credits: CatalogCreditTerms | null
  infrastructure?: CatalogInfrastructureTerms
  changeSummary: string
  createdBy: string
  createdAt: number
  publishedBy?: string
  publishedAt?: number
  checksum: string
}

export interface CatalogProductView {
  id: string
  type: CatalogProductType
  slug: string
  status: CatalogProductStatus
  saleMode: CatalogSaleMode | null
  name: string
  description: string
  tagline?: string
  legacyRenewalOnly: boolean
  currentVersionId: string | null
  currentVersion: CatalogVersionSummary | null
  draftVersion: CatalogVersionSummary | null
  versionCount: number
  createdAt: number
  updatedAt: number
  archivedAt?: number
  archivedBy?: string
  dodoMappings: Array<{
    cycle: CatalogDodoCycle
    environment: CatalogDodoEnvironment
    dodoProductId: string
    dodoProductName: string
    status: CatalogDodoMappingStatus
    validatedAt?: number
  }>
  dodoStatus: "missing" | "unvalidated" | "valid" | "invalid"
}

export interface CatalogProductDetail extends CatalogProductView {
  versions: CommercialProductVersionDoc[]
  mappings: DodoProductMappingDoc[]
}
