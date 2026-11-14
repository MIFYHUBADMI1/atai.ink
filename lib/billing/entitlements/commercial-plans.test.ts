import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { filterUnlaunchedFeatures } from "./commercial-plans"

describe("commercial-plans catalog", () => {
  const ENV_KEYS = [
    "DODO_COMMERCIAL_PRODUCT_EXPLORER",
    "DODO_COMMERCIAL_PRODUCT_STARTER",
    "DODO_COMMERCIAL_PRODUCT_GROWTH",
    "DODO_COMMERCIAL_PRODUCT_SCALE",
    "DODO_COMMERCIAL_PRODUCT_ENTERPRISE",
  ]

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
  })
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
    vi.resetModules()
  })

  it("returns the five commercial plans in display order", async () => {
    const { getCommercialPlans } = await import("./commercial-plans")
    const ids = getCommercialPlans().map((p) => p.id)
    expect(ids).toEqual(["explorer", "starter", "growth", "scale", "enterprise"])
  })

  it("marks Explorer as free/available and Enterprise as custom/contact", async () => {
    const { getCommercialPlanById } = await import("./commercial-plans")
    const explorer = getCommercialPlanById("explorer")!
    expect(explorer.priceUSD).toBe(0)
    expect(explorer.purchaseState).toBe("available")
    expect(explorer.provisionalCredits).toBe(true)

    const enterprise = getCommercialPlanById("enterprise")!
    expect(enterprise.custom).toBe(true)
    expect(enterprise.purchaseState).toBe("contact")
  })

  it("defaults paid plans to 'contact' when no Dodo product env var is set", async () => {
    const { getCommercialPlanById } = await import("./commercial-plans")
    for (const id of ["starter", "growth", "scale"]) {
      expect(getCommercialPlanById(id)!.purchaseState).toBe("contact")
    }
  })

  it("flags Growth as the popular plan", async () => {
    const { getCommercialPlanById } = await import("./commercial-plans")
    expect(getCommercialPlanById("growth")!.popular).toBe(true)
  })

  it("reads the per-plan Dodo product env var", async () => {
    process.env.DODO_COMMERCIAL_PRODUCT_STARTER = "prod_starter_xyz"
    const { getCommercialDodoProductId } = await import("./commercial-plans")
    expect(getCommercialDodoProductId("starter")).toBe("prod_starter_xyz")
  })

  it("marks a plan 'available' once its Dodo product is provisioned", async () => {
    process.env.DODO_COMMERCIAL_PRODUCT_SCALE = "prod_scale_1"
    vi.resetModules()
    const { getCommercialPlanById, resolveCommercialPlanByDodoProductId } = await import("./commercial-plans")
    const scale = getCommercialPlanById("scale")!
    expect(scale.dodoProductId).toBe("prod_scale_1")
    expect(scale.purchaseState).toBe("available")
    expect(resolveCommercialPlanByDodoProductId("prod_scale_1")?.id).toBe("scale")
  })

  it("hard rule #3: filterUnlaunchedFeatures drops gated capabilities", () => {
    const features = [
      "Premium AI co-founder",
      "Autonomous agents (start, scout, optimize)",
      "SEO & content marketing",
      "Marketing automation across channels",
      "Knowledge base for customers",
      "Priority compute",
    ]
    const availability = { agents: false, marketingAutomation: false, knowledgeBase: false }
    const filtered = filterUnlaunchedFeatures(features, availability)
    expect(filtered).toEqual(["Premium AI co-founder", "SEO & content marketing", "Priority compute"])
  })

  it("does not drop features when their capability is launched", () => {
    const features = ["Autonomous agents", "Marketing automation", "Knowledge base"]
    const availability = { agents: true, marketingAutomation: true, knowledgeBase: true }
    const filtered = filterUnlaunchedFeatures(features, availability)
    expect(filtered).toHaveLength(3)
  })
})
