import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { GrowthOverview, NumberMetric } from "@/lib/marketing/growth-overview"
import { GrowthOverviewView } from "./growth-overview-view"

const measured = (value: number, source = "metric"): NumberMetric => ({
  state: "available",
  value,
  definition: "definition",
  caveat: "caveat",
  source,
})

const runtimeOverview: GrowthOverview = {
  measurement: "runtime",
  projectId: "p1",
  projectName: "Acme App",
  projectState: "live",
  projectStateLabel: "Live",
  generatedAt: 0,
  window: { from: 0, to: 30 * 24 * 60 * 60 * 1000 },
  site: { state: "live", url: "https://acme.app", caveat: "Deployment state only." },
  whatAtaiKnows: { plan: { hasSpecification: false, health: null, targetUsers: [] }, ownerGoals: null, aiPlanDocuments: [] },
  metrics: {
    runtimeRequests: measured(5, "runtime_usage"),
    checkoutCalls: measured(0),
    creditsConsumedByProject: measured(1),
    siteVisitors: measured(0),
    completedPayments: measured(0),
    appRevenue: measured(0),
    conversionRate: measured(0),
    ownerAccountReferrals: measured(0),
    projectLevelReferrals: measured(0),
  },
  nextSteps: [],
  trustNotes: ["A deployment is not traffic."],
}

const unmeasuredOverview: GrowthOverview = {
  measurement: "none",
  projectId: "p1",
  projectName: "Acme Business",
  projectState: "intake",
  projectStateLabel: "Connected",
  generatedAt: 0,
  window: { from: 0, to: 30 * 24 * 60 * 60 * 1000 },
  site: { state: "external", url: "https://acme.com", caveat: "The site runs outside Atai." },
  measurementNote: "Atai does not host this site, so it cannot see its visitors.",
  trustNotes: ["Runtime requests are not visitors."],
}

describe("GrowthOverviewView", () => {
  it("renders the measurement grid for a project Atai hosts", () => {
    const html = renderToStaticMarkup(<GrowthOverviewView overview={runtimeOverview} />)

    expect(html).toContain("Measurements")
    expect(html).toContain("runtime_usage")
    expect(html).not.toContain("Atai does not host this site")
  })

  it("states the absence for a business Atai does not host, and shows no metric", () => {
    const html = renderToStaticMarkup(<GrowthOverviewView overview={unmeasuredOverview} />)

    expect(html).toContain("Atai does not host this site")
    expect(html).toContain("What Atai can see")
    expect(html).not.toContain("Measurements")
    // A zero would read as "nobody visited"; the unmeasured view never shows one.
    expect(html).not.toContain("runtime_usage")
  })
})
