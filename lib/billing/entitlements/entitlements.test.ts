import { describe, it, expect } from "vitest"
import { buildEntitlementSet, checkEntitlement, PLAN_PRICING, POPULAR_PLAN } from "./catalog"
import { resolveCommercialPlan, LEGACY_TO_COMMERCIAL } from "./migration-map"
import type { CommercialPlanId } from "./types"

const zero = { businesses: 0, productionApps: 0, subdomains: 0, customDomainsConsumed: 0 }

describe("plan catalog", () => {
  it("exposes approved prices and flags Growth as popular", () => {
    expect(PLAN_PRICING.growth.monthly).toBe(199.99)
    expect(PLAN_PRICING.growth.annual).toBe(2199.89)
    expect(PLAN_PRICING.starter.monthly).toBe(89.99)
    expect(PLAN_PRICING.scale.monthly).toBe(499.99)
    expect(PLAN_PRICING.explorer.monthly).toBe(0)
    expect(POPULAR_PLAN).toBe("growth")
  })
})

describe("legacy → commercial migration", () => {
  it("maps every legacy id to a commercial plan", () => {
    const expected: Record<string, CommercialPlanId> = {
      free: "explorer",
      explorer: "starter",
      starter: "starter",
      business: "growth",
      professional: "scale",
      enterprise: "enterprise",
    }
    for (const [legacy, commercial] of Object.entries(expected)) {
      expect(LEGACY_TO_COMMERCIAL[legacy]).toBe(commercial)
    }
  })

  it("grandfathers legacy free users with projects (no silent downgrade)", () => {
    const r = resolveCommercialPlan("free", { hasProjects: true })
    expect(r.commercialPlanId).toBe("explorer")
    expect(r.preserveLegacyBehavior).toBe(true)
    expect(r.grandfathered).toBe(true)
  })

  it("does not preserve legacy free users with no assets", () => {
    const r = resolveCommercialPlan("free", {})
    expect(r.preserveLegacyBehavior).toBe(false)
  })
})

describe("entitlement computation", () => {
  it("Explorer holds one planning business but cannot build production", () => {
    const set = buildEntitlementSet("explorer", zero)
    expect(set.planningOnly).toBe(true)
    expect(set.businesses.max).toBe(1)
    expect(set.productionApps.max).toBe(0)
    // The free funnel must survive: a new Explorer may start a planning business.
    expect(checkEntitlement(set, "createProject").allowed).toBe(true)
    // Production is the wall.
    const build = checkEntitlement(set, "buildProduction")
    expect(build.allowed).toBe(false)
    expect(build.code).toBe("EXPLORER_PLANNING_ONLY")
    expect(checkEntitlement(set, "deploy").allowed).toBe(false)
  })

  it("Explorer blocks a second business with an upgrade prompt", () => {
    const at1 = buildEntitlementSet("explorer", { ...zero, businesses: 1 })
    const blocked = checkEntitlement(at1, "createProject")
    expect(blocked.allowed).toBe(false)
    expect(blocked.code).toBe("BUSINESS_LIMIT_REACHED")
    expect(blocked.reason).toContain("Upgrade to Starter")
  })

  it("grandfathered legacy free keeps production capability", () => {
    const set = buildEntitlementSet("explorer", { ...zero, businesses: 2 }, { preserveLegacyBehavior: true, grandfathered: true })
    expect(set.planningOnly).toBe(false)
    expect(set.businesses.max).toBe("unlimited")
    expect(checkEntitlement(set, "createProject").allowed).toBe(true)
    expect(checkEntitlement(set, "buildProduction").allowed).toBe(true)
  })

  it("Starter allows one business then blocks the second", () => {
    const ok = buildEntitlementSet("starter", { ...zero, businesses: 0 })
    expect(checkEntitlement(ok, "createProject").allowed).toBe(true)
    const full = buildEntitlementSet("starter", { ...zero, businesses: 1 })
    const blocked = checkEntitlement(full, "createProject")
    expect(blocked.allowed).toBe(false)
    expect(blocked.code).toBe("BUSINESS_LIMIT_REACHED")
  })

  it("Growth allows up to four businesses", () => {
    const at4 = buildEntitlementSet("growth", { ...zero, businesses: 4 })
    expect(checkEntitlement(at4, "createProject").allowed).toBe(false)
    const at3 = buildEntitlementSet("growth", { ...zero, businesses: 3 })
    expect(checkEntitlement(at3, "createProject").allowed).toBe(true)
  })

  it("Scale allows unlimited business creation", () => {
    const many = buildEntitlementSet("scale", { ...zero, businesses: 100 })
    expect(many.businesses.max).toBe("unlimited")
    expect(checkEntitlement(many, "createProject").allowed).toBe(true)
  })
})

describe("unlaunched Scale features are gated by availability (hard rule #3)", () => {
  it("Agent Start capability slot exists but is not advertised as launched", () => {
    const set = buildEntitlementSet("scale", zero)
    expect(set.ai.agents.start).toBe(true)
    const check = checkEntitlement(set, "useAgent", { agent: "start" })
    expect(check.allowed).toBe(false)
    expect(check.code).toBe("AGENT_NOT_LAUNCHED")
  })

  it("marketing automation slot exists but not launched", () => {
    const set = buildEntitlementSet("scale", zero)
    expect(set.marketing.automation).toBe(true)
    const check = checkEntitlement(set, "useMarketingAutomation")
    expect(check.allowed).toBe(false)
    expect(check.code).toBe("MARKETING_AUTOMATION_NOT_LAUNCHED")
  })

  it("when availability flips on, the capability is permitted", () => {
    const set = buildEntitlementSet("scale", zero)
    set.availability.agents = true
    expect(checkEntitlement(set, "useAgent", { agent: "start" }).allowed).toBe(true)
  })
})

describe("domain entitlements", () => {
  it("Growth includes one custom domain; Starter includes none", () => {
    expect(buildEntitlementSet("growth", zero).customDomainsIncluded.max).toBe(1)
    expect(buildEntitlementSet("starter", zero).customDomainsIncluded.max).toBe(0)
    expect(checkEntitlement(buildEntitlementSet("starter", zero), "registerCustomDomain").allowed).toBe(false)
  })
})

// ─── M-22: every operation resolves from purchased state ─────────────────────

describe("M-22 operation matrix", () => {
  it("custom-domain cap uses consumed registrations, not the plan label", () => {
    const starter = buildEntitlementSet("starter", zero)
    expect(checkEntitlement(starter, "registerCustomDomain").allowed).toBe(false)

    const growthAtLimit = buildEntitlementSet("growth", { ...zero, customDomainsConsumed: 1 })
    const blocked = checkEntitlement(growthAtLimit, "registerCustomDomain")
    expect(blocked.allowed).toBe(false)
    expect(blocked.code).toBe("CUSTOM_DOMAIN_LIMIT")

    const growthWithRoom = buildEntitlementSet("growth", { ...zero, customDomainsConsumed: 0 })
    expect(checkEntitlement(growthWithRoom, "registerCustomDomain").allowed).toBe(true)
  })

  it("subdomain cap uses live deployed projects", () => {
    const starter = buildEntitlementSet("starter", { ...zero, subdomains: 0 })
    expect(checkEntitlement(starter, "connectSubdomain").allowed).toBe(true)

    const starterFull = buildEntitlementSet("starter", { ...zero, subdomains: 1 })
    const blocked = checkEntitlement(starterFull, "connectSubdomain")
    expect(blocked.allowed).toBe(false)
    expect(blocked.code).toBe("SUBDOMAIN_LIMIT")

    const scaleFull = buildEntitlementSet("scale", { ...zero, subdomains: 99 })
    expect(checkEntitlement(scaleFull, "connectSubdomain").allowed).toBe(false)
  })

  it("storage and database provisioning follow the purchased production capability", () => {
    const explorer = buildEntitlementSet("explorer", zero)
    expect(checkEntitlement(explorer, "useStorage").allowed).toBe(false)
    expect(checkEntitlement(explorer, "provisionDatabase").allowed).toBe(false)

    const starter = buildEntitlementSet("starter", zero)
    expect(checkEntitlement(starter, "useStorage").allowed).toBe(true)
    expect(checkEntitlement(starter, "provisionDatabase").allowed).toBe(true)
  })

  it("competition intelligence requires the purchased business capability", () => {
    expect(checkEntitlement(buildEntitlementSet("starter", zero), "useCompetitionIntel").allowed).toBe(false)
    expect(checkEntitlement(buildEntitlementSet("growth", zero), "useCompetitionIntel").allowed).toBe(true)
    // Explorer's research-only path is explicitly allowed.
    expect(checkEntitlement(buildEntitlementSet("explorer", zero), "useCompetitionIntel").allowed).toBe(true)
  })

  it("a review-pending historical record keeps competition and team access", () => {
    const review = buildEntitlementSet("explorer", zero, {
      grandfathered: true,
      preserveLegacyBehavior: true,
      legacyPlanId: "free",
    })
    expect(checkEntitlement(review, "useCompetitionIntel").allowed).toBe(true)
    expect(checkEntitlement(review, "useSpecialistTeam").allowed).toBe(true)
  })

  it("specialist teams follow the purchased team tier", () => {
    expect(checkEntitlement(buildEntitlementSet("explorer", zero), "useSpecialistTeam").allowed).toBe(false)
    expect(checkEntitlement(buildEntitlementSet("starter", zero), "useSpecialistTeam").allowed).toBe(true)
    expect(checkEntitlement(buildEntitlementSet("growth", zero), "useSpecialistTeam").allowed).toBe(true)
  })

  it("Agent access is denied where the plan has no slot and unlaunched where it does", () => {
    for (const plan of ["explorer", "starter", "growth"] as const) {
      const check = checkEntitlement(buildEntitlementSet(plan, zero), "useAgent", { agent: "start" })
      expect(check.allowed).toBe(false)
      expect(check.code).toBe("AGENT_UNAVAILABLE")
    }
    for (const plan of ["scale", "enterprise"] as const) {
      const check = checkEntitlement(buildEntitlementSet(plan, zero), "useAgent", { agent: "start" })
      expect(check.allowed).toBe(false)
      expect(check.code).toBe("AGENT_NOT_LAUNCHED")
    }
  })
})
