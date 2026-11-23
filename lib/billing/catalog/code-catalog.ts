import { createHash } from "node:crypto"
import {
  ENTITLEMENT_VERSION,
  PROVISIONAL_MONTHLY_CREDITS,
  buildEntitlementSet,
} from "@/lib/billing/entitlements/catalog"
import {
  PLAN_NAMES,
  PLAN_TAGLINES,
  getCommercialDodoProductId,
} from "@/lib/billing/entitlements/commercial-plans"
import {
  COMMERCIAL_PLAN_IDS,
  resolveCommercialPlan,
} from "@/lib/billing/entitlements/migration-map"
import type { CommercialPlanId } from "@/lib/billing/entitlements/types"
import {
  LEGACY_SUBSCRIPTION_PLANS,
  PERMANENT_CREDIT_PACKS,
} from "@/lib/billing/config"
import {
  ALL_PLAN_ORDER,
  INFRASTRUCTURE_PLANS,
  type InfrastructurePlanId,
} from "@/lib/infrastructure/plans"
import {
  PRICE_BOOK_CURRENCY,
  PRICE_BOOK_VERSION,
  commercialPriceMinor,
  legacyPriceMinor,
  legacyUsdToMinorUnits,
} from "@/lib/billing/entitlements/price-book"
import type {
  CatalogCreditTerms,
  CatalogDodoConfig,
  CatalogDodoCycle,
  CatalogDodoEnvironment,
  CatalogEntitlementTemplate,
  CatalogInfrastructureTerms,
  CatalogSaleMode,
  CommercialCatalogVersionDoc,
  CommercialProductDoc,
  CommercialProductVersionDoc,
  DodoProductMappingDoc,
} from "./types"

export const CATALOG_VERSION = "CATALOG_V1"
export const CATALOG_SEED_ACTOR = "system:catalog-seed"

const ZERO_COUNTS = {
  businesses: 0,
  productionApps: 0,
  subdomains: 0,
  customDomainsConsumed: 0,
}

export interface CodeCatalogSnapshot {
  products: CommercialProductDoc[]
  versions: CommercialProductVersionDoc[]
  mappings: DodoProductMappingDoc[]
  catalogVersion: CommercialCatalogVersionDoc
}

export interface CodeCatalogInput {
  now?: number
  env?: NodeJS.ProcessEnv
}

export function stableCatalogJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCatalogJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableCatalogJson(item)}`)
      .join(",")}}`
  }
  const json = JSON.stringify(value)
  return json === undefined ? "undefined" : json
}

export function catalogChecksum(value: unknown): string {
  return createHash("sha256").update(stableCatalogJson(value)).digest("hex")
}

export function versionChecksum(version: CommercialProductVersionDoc): string {
  const business: Record<string, unknown> = { ...version }
  delete business.checksum
  delete business._id
  delete business.createdAt
  delete business.effectiveAt
  delete business.publishedAt
  return catalogChecksum(business)
}

export function catalogPublicationChecksum(input: {
  version: string
  productVersionIds: string[]
  priceBookVersion: string
  entitlementVersion: string
}): string {
  return catalogChecksum({
    version: input.version,
    productVersionIds: [...input.productVersionIds].sort(),
    priceBookVersion: input.priceBookVersion,
    entitlementVersion: input.entitlementVersion,
  })
}

export function catalogDodoEnvironment(env: NodeJS.ProcessEnv): CatalogDodoEnvironment {
  return env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode"
}

function productIdFor(type: string, key: string): string {
  return `prod_${type}_${key}`
}

function versionIdFor(productId: string): string {
  return `${productId}_v1`
}

function commercialSaleMode(planId: CommercialPlanId): CatalogSaleMode {
  if (planId === "explorer") return "free"
  if (planId === "enterprise") return "contact"
  return "self_serve"
}

function commercialEntitlement(planId: CommercialPlanId): CatalogEntitlementTemplate {
  return {
    templateId: `${ENTITLEMENT_VERSION}:${planId}`,
    version: ENTITLEMENT_VERSION,
    snapshot: buildEntitlementSet(planId, ZERO_COUNTS),
  }
}

function legacyEntitlement(legacyPlanId: string): CatalogEntitlementTemplate {
  const resolved = resolveCommercialPlan(legacyPlanId)
  return {
    templateId: `${ENTITLEMENT_VERSION}:legacy:${legacyPlanId}`,
    version: ENTITLEMENT_VERSION,
    snapshot: buildEntitlementSet(resolved.commercialPlanId, ZERO_COUNTS, {
      legacyPlanId,
      grandfathered: true,
      // Legacy free accounts had no creation cap. Other legacy plans keep the
      // capability of the commercial plan they map to. Individual purchased
      // terms remain authoritative for existing subscribers.
      preserveLegacyBehavior: legacyPlanId === "free",
    }),
  }
}

function subscriptionCredits(monthly: number | null, annualTotal: number | null): CatalogCreditTerms {
  return {
    creditType: "subscription",
    monthlyGrant: monthly,
    oneTimeGrant: null,
    annualTotalCredits: annualTotal,
    annualMonths: annualTotal === null ? null : 12,
    annualIssuance: annualTotal === null ? null : "monthly",
    expiresAfterDays: null,
    bonusCredits: null,
  }
}

function legacyDodoId(legacyPlanId: string, env: NodeJS.ProcessEnv): string | undefined {
  return env[`DODO_PRODUCT_${legacyPlanId.toUpperCase()}`] || undefined
}

function packDodoId(packId: string, env: NodeJS.ProcessEnv): string | undefined {
  return env[`DODO_PRODUCT_${packId.toUpperCase()}`] || undefined
}

function commercialBillingIntervals(
  planId: CommercialPlanId,
  annualPriceMinor: number | null,
): ("monthly" | "annual")[] {
  if (planId === "explorer") return ["monthly"]
  if (planId === "enterprise") return []
  return annualPriceMinor === null ? ["monthly"] : ["monthly", "annual"]
}

function dodoIntervalFor(cycle: CatalogDodoCycle): "month" | "year" | "one_time" {
  return cycle === "monthly" ? "month" : cycle === "annual" ? "year" : "one_time"
}

function mappingFor(input: {
  version: CommercialProductVersionDoc
  cycle: CatalogDodoCycle
  dodoProductId: string
  priceMinor: number
  now: number
}): DodoProductMappingDoc {
  return {
    productVersionId: input.version.id,
    cycle: input.cycle,
    environment: input.version.dodo?.environment ?? "test_mode",
    dodoProductId: input.dodoProductId,
    dodoProductName: input.version.name,
    dodoPriceMinor: input.priceMinor,
    dodoCurrency: input.version.currency,
    dodoInterval: dodoIntervalFor(input.cycle),
    status: "unvalidated",
    lastSyncedAt: input.now,
  }
}

function addMappingsForVersion(
  version: CommercialProductVersionDoc,
  mappings: DodoProductMappingDoc[],
  now: number,
): void {
  if (version.dodo?.monthlyProductId) {
    mappings.push(
      mappingFor({
        version,
        cycle: "monthly",
        dodoProductId: version.dodo.monthlyProductId,
        priceMinor: version.priceMinor ?? 0,
        now,
      }),
    )
  }
  if (version.dodo?.annualProductId) {
    mappings.push(
      mappingFor({
        version,
        cycle: "annual",
        dodoProductId: version.dodo.annualProductId,
        priceMinor: version.annualPriceMinor ?? 0,
        now,
      }),
    )
  }
  if (version.dodo?.oneTimeProductId) {
    mappings.push(
      mappingFor({
        version,
        cycle: "one_time",
        dodoProductId: version.dodo.oneTimeProductId,
        priceMinor: version.priceMinor ?? 0,
        now,
      }),
    )
  }
}

function finishVersion(
  version: Omit<CommercialProductVersionDoc, "checksum">,
): CommercialProductVersionDoc {
  return { ...version, checksum: versionChecksum({ ...version, checksum: "" }) }
}

function productDoc(input: {
  id: string
  type: CommercialProductDoc["type"]
  slug: string
  status: CommercialProductDoc["status"]
  versionId: string
  now: number
}): CommercialProductDoc {
  return {
    id: input.id,
    type: input.type,
    slug: input.slug,
    status: input.status,
    currentVersionId: input.versionId,
    createdBy: CATALOG_SEED_ACTOR,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function baseVersion(input: {
  productId: string
  name: string
  description: string
  tagline?: string
  status: CommercialProductVersionDoc["status"]
  saleMode: CatalogSaleMode
  priceMinor: number | null
  annualPriceMinor: number | null
  billingIntervals: ("monthly" | "annual")[]
  credits: CatalogCreditTerms | null
  entitlement: CatalogEntitlementTemplate | null
  infrastructure?: CatalogInfrastructureTerms
  dodo?: CatalogDodoConfig
  now: number
}): CommercialProductVersionDoc {
  const id = versionIdFor(input.productId)
  return finishVersion({
    id,
    productId: input.productId,
    version: 1,
    status: input.status,
    effectiveAt: input.now,
    name: input.name,
    description: input.description,
    tagline: input.tagline,
    saleMode: input.saleMode,
    currency: PRICE_BOOK_CURRENCY,
    priceMinor: input.priceMinor,
    annualPriceMinor: input.annualPriceMinor,
    billingIntervals: input.billingIntervals,
    credits: input.credits,
    entitlement: input.entitlement,
    infrastructure: input.infrastructure,
    dodo: input.dodo,
    createdBy: CATALOG_SEED_ACTOR,
    createdAt: input.now,
    publishedBy: CATALOG_SEED_ACTOR,
    publishedAt: input.now,
    changeSummary: "Seeded from the code catalog as CATALOG_V1",
    notes: "A7.0 snapshot. Checkout and entitlement resolution still read the code catalog.",
  })
}

/**
 * Deterministic representation of today's commercial catalog. This is the
 * expected side of the code-to-database comparison; it must never invent a
 * price, credit amount or benefit.
 */
export function buildCodeCatalogSnapshot(input: CodeCatalogInput = {}): CodeCatalogSnapshot {
  const now = input.now ?? Date.now()
  const env = input.env ?? process.env
  const products: CommercialProductDoc[] = []
  const versions: CommercialProductVersionDoc[] = []
  const mappings: DodoProductMappingDoc[] = []

  for (const planId of COMMERCIAL_PLAN_IDS) {
    const monthlyCredits = PROVISIONAL_MONTHLY_CREDITS[planId]
    const priceMinor = commercialPriceMinor(planId, "monthly") ?? null
    const annualPriceMinor = commercialPriceMinor(planId, "annual") ?? null
    const productId = productIdFor("subscription", planId)
    const versionId = versionIdFor(productId)
    const dodo: CatalogDodoConfig = {
      environment: catalogDodoEnvironment(env),
      monthlyProductId: getCommercialDodoProductId(planId, "monthly", env),
      annualProductId: getCommercialDodoProductId(planId, "annual", env),
    }
    const version = baseVersion({
      productId,
      name: PLAN_NAMES[planId],
      description: PLAN_TAGLINES[planId],
      tagline: PLAN_TAGLINES[planId],
      status: "published",
      saleMode: commercialSaleMode(planId),
      priceMinor,
      annualPriceMinor,
      billingIntervals: commercialBillingIntervals(planId, annualPriceMinor),
      credits: subscriptionCredits(
        monthlyCredits,
        commercialSaleMode(planId) === "self_serve" &&
          annualPriceMinor !== null &&
          monthlyCredits !== null
          ? monthlyCredits * 12
          : null,
      ),
      entitlement: commercialEntitlement(planId),
      dodo,
      now,
    })
    versions.push(version)
    products.push(
      productDoc({
        id: productId,
        type: "subscription",
        slug: `subscription-${planId}`,
        status: "published",
        versionId,
        now,
      }),
    )
    addMappingsForVersion(version, mappings, now)
  }

  for (const legacy of LEGACY_SUBSCRIPTION_PLANS) {
    const productId = productIdFor("legacy", legacy.id)
    const versionId = versionIdFor(productId)
    const version = baseVersion({
      productId,
      name: legacy.name,
      description: legacy.tagline,
      tagline: legacy.tagline,
      status: "archived",
      saleMode: "legacy_renewal_only",
      priceMinor: legacyPriceMinor(legacy.id) ?? null,
      annualPriceMinor: null,
      billingIntervals: ["monthly"],
      credits: subscriptionCredits(legacy.mirrorCredits, null),
      entitlement: legacyEntitlement(legacy.id),
      dodo: {
        environment: catalogDodoEnvironment(env),
        monthlyProductId: legacyDodoId(legacy.id, env),
      },
      now,
    })
    versions.push(version)
    products.push(
      productDoc({
        id: productId,
        type: "subscription",
        slug: `legacy-${legacy.id}`,
        status: "archived",
        versionId,
        now,
      }),
    )
    addMappingsForVersion(version, mappings, now)
  }

  for (const pack of PERMANENT_CREDIT_PACKS) {
    const productId = productIdFor("pack", pack.id)
    const versionId = versionIdFor(productId)
    const version = baseVersion({
      productId,
      name: pack.label,
      description: `${pack.credits.toLocaleString()} permanent Atai Credits.`,
      tagline: "Permanent credits",
      status: "published",
      saleMode: "self_serve",
      priceMinor: legacyUsdToMinorUnits(pack.priceUSD),
      annualPriceMinor: null,
      billingIntervals: [],
      credits: {
        creditType: "permanent",
        monthlyGrant: null,
        oneTimeGrant: pack.credits,
        annualTotalCredits: null,
        annualMonths: null,
        annualIssuance: null,
        expiresAfterDays: null,
        bonusCredits: null,
      },
      entitlement: null,
      dodo: {
        environment: catalogDodoEnvironment(env),
        oneTimeProductId: packDodoId(pack.id, env),
      },
      now,
    })
    versions.push(version)
    products.push(
      productDoc({
        id: productId,
        type: "credit_pack",
        slug: `credit-pack-${pack.id}`,
        status: "published",
        versionId,
        now,
      }),
    )
    addMappingsForVersion(version, mappings, now)
  }

  for (const planId of ALL_PLAN_ORDER) {
    const plan = INFRASTRUCTURE_PLANS[planId as InfrastructurePlanId]
    const productId = productIdFor("infra", plan.id)
    const versionId = versionIdFor(productId)
    const custom = plan.id === "enterprise"
    const infrastructure: CatalogInfrastructureTerms = {
      purchaseModel: "credit_funded",
      durationDays: 30,
      renewal: "manual",
      storageLabel: plan.storageLabel,
      storageBytes: Number.isFinite(plan.storageBytes) ? plan.storageBytes : null,
      totalumInfrastructureCredits: custom ? null : plan.totalumInfrastructureCredits,
      creditCharge: plan.AtaiPrice,
      includedResources: {
        storageBytes: Number.isFinite(plan.storageBytes) ? plan.storageBytes : null,
        totalumInfrastructureCredits: custom ? null : plan.totalumInfrastructureCredits,
      },
    }
    const version = baseVersion({
      productId,
      name: plan.name,
      description: plan.description,
      tagline: plan.storageLabel,
      status: "published",
      saleMode: plan.id === "testing" ? "free" : custom ? "contact" : "self_serve",
      priceMinor: 0,
      annualPriceMinor: null,
      billingIntervals: [],
      credits: null,
      entitlement: null,
      infrastructure,
      dodo: { environment: catalogDodoEnvironment(env) },
      now,
    })
    versions.push(version)
    products.push(
      productDoc({
        id: productId,
        type: "infrastructure",
        slug: `infrastructure-${plan.id}`,
        status: "published",
        versionId,
        now,
      }),
    )
    addMappingsForVersion(version, mappings, now)
  }

  const catalogVersion: CommercialCatalogVersionDoc = {
    id: CATALOG_VERSION,
    version: CATALOG_VERSION,
    status: "seeded",
    productVersionIds: versions.map((version) => version.id).sort(),
    priceBookVersion: PRICE_BOOK_VERSION,
    entitlementVersion: ENTITLEMENT_VERSION,
    publisher: CATALOG_SEED_ACTOR,
    publishedAt: now,
    notes: "A7.0 seed snapshot of the existing code catalog; not used by checkout.",
    checksum: catalogPublicationChecksum({
      version: CATALOG_VERSION,
      productVersionIds: versions.map((version) => version.id),
      priceBookVersion: PRICE_BOOK_VERSION,
      entitlementVersion: ENTITLEMENT_VERSION,
    }),
  }

  return { products, versions, mappings, catalogVersion }
}
