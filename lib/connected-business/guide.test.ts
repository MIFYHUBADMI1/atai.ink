import { describe, expect, it } from "vitest"
import type { BusinessObjectiveId } from "@/lib/types/business-intake"
import { INTEGRATION_GUIDE_VERSION, buildIntegrationGuide, trackingPlanFor } from "./guide"

function guide(overrides: Partial<Parameters<typeof buildIntegrationGuide>[0]> = {}) {
  return buildIntegrationGuide({
    projectId: "proj_1",
    businessName: "Corner Bakery",
    appUrl: "https://bakery.example",
    apiBaseUrl: "https://atai.ink/",
    generatedAt: Date.UTC(2026, 0, 2),
    ...overrides,
  })
}

describe("the SDK brief", () => {
  it("tells the agent how to install the package, not just that one exists", () => {
    const text = guide()

    expect(text).toContain("npm install @atai-group/sdk")
    expect(text).toContain("Node 18 or newer")
    expect(text).toContain('import { Atai } from "@atai-group/sdk"')
    expect(text).toContain("atai.health.check()")
  })

  it("separates the server secret from the key that ships in the page", () => {
    const text = guide()

    expect(text).toContain("atai_production_pk_")
    expect(text).toContain("https://atai.ink/atai-analytics.js")
    expect(text).toContain("data-atai-key=")
    // The old brief said no browser-safe key existed. One does now.
    expect(text).not.toContain("Atai has no browser-safe key type")
  })

  it("quotes the summary fields the SDK actually returns", () => {
    const text = guide()

    expect(text).toContain("summary.totalEvents")
    expect(text).toContain("summary.uniqueVisitors")
    expect(text).not.toContain("summary.totals")
  })

  it("carries the real key only in the downloadable copy", () => {
    expect(guide()).toContain("atai_production_<your-key>")
    const downloadable = guide({ keySecret: "atai_production_abc123", keyPrefix: "atai_production_abc" })
    expect(downloadable).toContain("ATAI_API_KEY=atai_production_abc123")
    expect(downloadable).not.toContain("<your-key>")
  })

  it("asks for the events behind the goals the founder picked", () => {
    const text = guide({ objectives: ["acquire_customers", "increase_revenue"] })

    expect(text).toContain("`signup`")
    expect(text).toContain("`lead_captured`")
    expect(text).toContain("`checkout_started`")
    expect(text).not.toContain("`job_completed`")
  })

  it("states the version and the address it was written for", () => {
    const text = guide()

    expect(text).toContain(`v${INTEGRATION_GUIDE_VERSION}`)
    expect(text).toContain("https://bakery.example")
    expect(text).toContain("https://atai.ink/sdk")
  })

  it("warns that an unverified domain is not a connection yet", () => {
    expect(guide()).toContain("Domain ownership is not verified yet")
    expect(guide({ verifiedHostname: "bakery.example" })).toContain("Domain ownership verified: **bakery.example**")
  })
})

describe("trackingPlanFor", () => {
  it("always covers signup and payment", () => {
    expect(trackingPlanFor().map((event) => event.name)).toEqual(["signup", "purchase"])
  })

  it("adds the events a goal needs without duplicating the base", () => {
    const names = trackingPlanFor(["increase_revenue", "improve_finances"]).map((event) => event.name)

    expect(names).toEqual(["signup", "purchase", "checkout_started", "refund_issued"])
  })

  it("stays short enough to implement", () => {
    const every: BusinessObjectiveId[] = [
      "acquire_customers",
      "increase_revenue",
      "improve_marketing",
      "improve_website",
      "understand_competitors",
      "improve_retention",
      "automate_operations",
      "improve_finances",
      "expand_markets",
      "improve_performance",
    ]

    expect(trackingPlanFor(every).length).toBeLessThanOrEqual(8)
  })
})
