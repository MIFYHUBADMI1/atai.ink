import { getCommercialPlanById } from "@/lib/billing/entitlements/commercial-plans"
import type { CommercialPlanId, EntitlementSet } from "@/lib/billing/entitlements/types"
import { logger } from "@/lib/logging/logger"
import { isCatalogDbEnabled, isCatalogDbPublicReadEnabled } from "./source"
import {
  resolvePublicCommercialCatalog,
  type PublishedCatalogEntry,
} from "./published-resolver"
import type { CatalogProductType, CommercialCatalogVersionDoc } from "./types"
import type { CatalogSeedStore } from "./seed"

export type RuntimeCatalogCycle = "monthly" | "annual" | "one_time"

export interface RuntimeCatalogProduct {
  productId: string
  versionId: string
  planId: string
  planName: string
  productType: CatalogProductType
  billingCycle: RuntimeCatalogCycle
  priceMinor: number
  monthlyCredits: number
  oneTimeCredits: number
  dodoProductId: string
  entitlementSnapshot: EntitlementSet | null
  entitlementVersion: string
  pricingVersion: string
  commercialPlanId?: CommercialPlanId
}

function productAlias(productId: string): string {
  for (const prefix of ["prod_subscription_", "prod_pack_", "prod_infra_", "prod_legacy_"]) {
    if (productId.startsWith(prefix)) return productId.slice(prefix.length)
  }
  return productId
}

function matchDodoProduct(
  entries: PublishedCatalogEntry[],
  dodoProductId: string,
): { entry: PublishedCatalogEntry; cycle: RuntimeCatalogCycle } | null {
  for (const entry of entries) {
    if (entry.version.dodo?.monthlyProductId === dodoProductId) {
      return { entry, cycle: "monthly" }
    }
    if (entry.version.dodo?.annualProductId === dodoProductId) {
      return { entry, cycle: "annual" }
    }
    if (entry.version.dodo?.oneTimeProductId === dodoProductId) {
      return { entry, cycle: "one_time" }
    }
  }
  return null
}

function toRuntimeProduct(
  entry: PublishedCatalogEntry,
  cycle: RuntimeCatalogCycle,
  publication: CommercialCatalogVersionDoc,
): RuntimeCatalogProduct {
  const { product, version } = entry
  const planId = productAlias(product.id)
  const codePlan = getCommercialPlanById(planId)
  const annual = cycle === "annual"
  const priceMinor = annual ? (version.annualPriceMinor ?? version.priceMinor ?? 0) : (version.priceMinor ?? 0)
  return {
    productId: product.id,
    versionId: version.id,
    planId,
    planName: version.name,
    productType: product.type,
    billingCycle: cycle,
    priceMinor,
    monthlyCredits: version.credits?.monthlyGrant ?? 0,
    oneTimeCredits: version.credits?.oneTimeGrant ?? 0,
    dodoProductId:
      cycle === "annual"
        ? (version.dodo?.annualProductId ?? "")
        : cycle === "monthly"
          ? (version.dodo?.monthlyProductId ?? "")
          : (version.dodo?.oneTimeProductId ?? ""),
    entitlementSnapshot: version.entitlement?.snapshot ?? null,
    entitlementVersion: version.entitlement?.version ?? publication.entitlementVersion,
    pricingVersion: publication.priceBookVersion,
    commercialPlanId:
      version.entitlement?.snapshot.commercialPlanId ??
      (codePlan?.commercialPlanId as CommercialPlanId | undefined),
  }
}

/**
 * Resolve the commercial product behind a Dodo product id or plan alias from
 * the active database publication. Returns null when database reads are gated
 * or the active publication is unusable; callers then keep the code catalog
 * path. This is intentionally best-effort for webhooks, where a transient
 * catalog read failure must not lose a payment.
 */
export async function resolveRuntimeCatalogProduct(input: {
  dodoProductId?: string
  planId?: string
  billingCycle?: RuntimeCatalogCycle
  env?: NodeJS.ProcessEnv
  now?: number
  store?: CatalogSeedStore
}): Promise<RuntimeCatalogProduct | null> {
  const env = input.env ?? process.env
  if (!isCatalogDbEnabled(env) || !isCatalogDbPublicReadEnabled(env)) return null

  try {
    const catalog = await resolvePublicCommercialCatalog({
      env,
      now: input.now,
      store: input.store,
    })
    if (catalog.source !== "db") return null

    if (input.dodoProductId) {
      const match = matchDodoProduct(catalog.entries, input.dodoProductId)
      if (match && catalog.publication) {
        return toRuntimeProduct(match.entry, match.cycle, catalog.publication)
      }
    }

    if (input.planId) {
      const entry = catalog.entries.find(
        (candidate) =>
          candidate.product.type === "subscription" &&
          productAlias(candidate.product.id) === input.planId,
      )
      if (entry && catalog.publication) {
        return toRuntimeProduct(
          entry,
          input.billingCycle === "annual" ? "annual" : "monthly",
          catalog.publication,
        )
      }
      const pack = catalog.entries.find(
        (candidate) =>
          candidate.product.type === "credit_pack" &&
          productAlias(candidate.product.id) === input.planId,
      )
      if (pack && catalog.publication) return toRuntimeProduct(pack, "one_time", catalog.publication)
    }
  } catch (error) {
    logger.warn("billing.catalog.runtime", "active catalog unavailable; using code fallback", {
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return null
}
