import { describe, expect, it } from "vitest"
import { buildCodeCatalogSnapshot } from "./code-catalog"
import { getCatalogSource, isCatalogDbEnabled } from "./source"

const ENV = {
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  DODO_COMMERCIAL_PRODUCT_STARTER: "dodo_starter_m",
  DODO_COMMERCIAL_PRODUCT_STARTER_ANNUAL: "dodo_starter_y",
  DODO_COMMERCIAL_PRODUCT_GROWTH: "dodo_growth_m",
  DODO_COMMERCIAL_PRODUCT_GROWTH_ANNUAL: "dodo_growth_y",
  DODO_COMMERCIAL_PRODUCT_SCALE: "dodo_scale_m",
  DODO_COMMERCIAL_PRODUCT_SCALE_ANNUAL: "dodo_scale_y",
  DODO_PRODUCT_EXPLORER: "dodo_legacy_explorer",
  DODO_PRODUCT_STARTER: "dodo_legacy_starter",
  DODO_PRODUCT_BUSINESS: "dodo_legacy_business",
  DODO_PRODUCT_PROFESSIONAL: "dodo_legacy_professional",
  DODO_PRODUCT_ENTERPRISE: "dodo_legacy_enterprise",
  DODO_PRODUCT_PERM_200K: "dodo_perm_200k",
  DODO_PRODUCT_PERM_500K: "dodo_perm_500k",
  DODO_PRODUCT_PERM_1M: "dodo_perm_1m",
  DODO_PRODUCT_PERM_5M: "dodo_perm_5m",
  DODO_PRODUCT_PERM_15M: "dodo_perm_15m",
} as NodeJS.ProcessEnv

function snapshot() {
  return buildCodeCatalogSnapshot({ env: ENV, now: 1_700_000_000_000 })
}

describe("A7.0 code catalog snapshot", () => {
  it("contains every current sellable product plus archived legacy plans", () => {
    const { products, versions, mappings, catalogVersion } = snapshot()
    expect(products).toHaveLength(22)
    expect(versions).toHaveLength(22)
    expect(mappings).toHaveLength(16)
    expect(catalogVersion.version).toBe("CATALOG_V1")
    expect(catalogVersion.status).toBe("seeded")

    const commercial = products.filter((product) => product.type === "subscription" && product.status === "published")
    const legacy = products.filter((product) => product.type === "subscription" && product.status === "archived")
    expect(commercial.map((product) => product.id).sort()).toEqual([
      "prod_subscription_enterprise",
      "prod_subscription_explorer",
      "prod_subscription_growth",
      "prod_subscription_scale",
      "prod_subscription_starter",
    ])
    expect(legacy.map((product) => product.id).sort()).toEqual([
      "prod_legacy_business",
      "prod_legacy_enterprise",
      "prod_legacy_explorer",
      "prod_legacy_free",
      "prod_legacy_professional",
      "prod_legacy_starter",
    ])
    expect(products.filter((product) => product.type === "credit_pack")).toHaveLength(5)
    expect(products.filter((product) => product.type === "infrastructure")).toHaveLength(6)
  })

  it("preserves exact subscription prices, credits, intervals and entitlements", () => {
    const { versions } = snapshot()
    const starter = versions.find((version) => version.productId === "prod_subscription_starter")
    expect(starter).toBeDefined()
    expect(starter!.priceMinor).toBe(8_999)
    expect(starter!.annualPriceMinor).toBe(98_989)
    expect(starter!.currency).toBe("USD")
    expect(starter!.billingIntervals).toEqual(["monthly", "annual"])
    expect(starter!.saleMode).toBe("self_serve")
    expect(starter!.credits).toEqual({
      creditType: "subscription",
      monthlyGrant: 150_000,
      oneTimeGrant: null,
      annualTotalCredits: 1_800_000,
      annualMonths: 12,
      annualIssuance: "monthly",
      expiresAfterDays: null,
      bonusCredits: null,
    })
    expect(starter!.entitlement?.snapshot.commercialPlanId).toBe("starter")
    expect(starter!.entitlement?.snapshot.credits.monthlyGrant).toBe(150_000)
    expect(starter!.dodo?.monthlyProductId).toBe("dodo_starter_m")
    expect(starter!.dodo?.annualProductId).toBe("dodo_starter_y")

    const explorer = versions.find((version) => version.productId === "prod_subscription_explorer")
    expect(explorer!.priceMinor).toBe(0)
    expect(explorer!.annualPriceMinor).toBe(0)
    expect(explorer!.billingIntervals).toEqual(["monthly"])
    expect(explorer!.saleMode).toBe("free")
    expect(explorer!.credits?.annualTotalCredits).toBeNull()

    const enterprise = versions.find((version) => version.productId === "prod_subscription_enterprise")
    expect(enterprise!.priceMinor).toBeNull()
    expect(enterprise!.annualPriceMinor).toBeNull()
    expect(enterprise!.billingIntervals).toEqual([])
    expect(enterprise!.saleMode).toBe("contact")
  })

  it("marks legacy plans archived and renewal-only without reusing their prices", () => {
    const { versions } = snapshot()
    const legacyStarter = versions.find((version) => version.productId === "prod_legacy_starter")
    expect(legacyStarter).toBeDefined()
    expect(legacyStarter!.saleMode).toBe("legacy_renewal_only")
    expect(legacyStarter!.priceMinor).toBe(7_900)
    expect(legacyStarter!.credits?.monthlyGrant).toBe(300_000)
    expect(legacyStarter!.entitlement?.snapshot.legacyPlanId).toBe("starter")
    expect(legacyStarter!.entitlement?.snapshot.grandfathered).toBe(true)

    const legacyFree = versions.find((version) => version.productId === "prod_legacy_free")
    expect(legacyFree!.entitlement?.snapshot.preserveLegacyBehavior).toBe(true)
    expect(legacyFree!.entitlement?.snapshot.businesses.max).toBe("unlimited")
  })

  it("preserves permanent pack and infrastructure definitions", () => {
    const { versions } = snapshot()
    const pack = versions.find((version) => version.productId === "prod_pack_perm_500k")
    expect(pack!.priceMinor).toBe(11_900)
    expect(pack!.credits?.creditType).toBe("permanent")
    expect(pack!.credits?.oneTimeGrant).toBe(500_000)
    expect(pack!.dodo?.oneTimeProductId).toBe("dodo_perm_500k")

    const infra = versions.find((version) => version.productId === "prod_infra_business")
    expect(infra!.priceMinor).toBe(0)
    expect(infra!.infrastructure).toEqual({
      purchaseModel: "credit_funded",
      durationDays: 30,
      renewal: "manual",
      storageLabel: "Up to 25 GB",
      storageBytes: 25 * 1024 * 1024 * 1024,
      totalumInfrastructureCredits: 300,
      creditCharge: 95_000,
      includedResources: {
        storageBytes: 25 * 1024 * 1024 * 1024,
        totalumInfrastructureCredits: 300,
      },
    })

    const enterprise = versions.find((version) => version.productId === "prod_infra_enterprise")
    expect(enterprise!.saleMode).toBe("contact")
    expect(enterprise!.infrastructure?.storageBytes).toBeNull()
    expect(enterprise!.infrastructure?.totalumInfrastructureCredits).toBeNull()
  })

  it("defaults CATALOG_SOURCE to code and only enables db on an explicit value", () => {
    expect(getCatalogSource({})).toBe("code")
    expect(getCatalogSource({ CATALOG_SOURCE: "db" })).toBe("db")
    expect(getCatalogSource({ CATALOG_SOURCE: "anything-else" })).toBe("code")
    expect(isCatalogDbEnabled({})).toBe(false)
  })
})
