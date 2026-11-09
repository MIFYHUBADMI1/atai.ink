import { describe, expect, it } from "vitest"
import { AD_STRATEGY_BOUNDS, ADS_STRATEGY_SLOT, buildStrategyBrief, type StrategyBriefInput } from "./strategy-content"

/** The studio service caps briefs at 2000 chars — the strategy brief must fit. */
const SERVICE_BRIEF_CAP = 2000

const FULL_INPUT: StrategyBriefInput = {
  projectName: "Sweet Crust Bakery",
  description: "A neighbourhood bakery storefront with same-day delivery.",
  positioningFromPlan:
    "Position around the warm, local bakery that delivers before breakfast; oven-fresh without the queue.",
  targetUsers: ["Weekend families", "Office managers"],
  siteUrl: "https://sweet-crust.example.com",
  ownerGoals: { businessGoal: "Sell 100 weekend bundles", destination: "A shop that runs itself" },
  strategy: {
    positioning: "The bakery that beats the queue.",
    icp: "Families in Kampala",
    geographies: "Kampala",
    objectives: ["Fill the weekend calendar", "Grow repeat orders"],
    channels: ["Facebook", "Instagram"],
    budgetNote: "Start small, scale what works",
    priorities: ["First 20 orders"],
    brandVoice: "Warm, plain-spoken",
    usps: "Oven-fresh on arrival; first delivery free",
  },
}

describe("vocabulary", () => {
  it("exposes bounds the API schema and UI share", () => {
    expect(AD_STRATEGY_BOUNDS.positioning).toBeGreaterThan(0)
    expect(AD_STRATEGY_BOUNDS.listItems).toBe(6)
    expect(AD_STRATEGY_BOUNDS.listItem).toBeGreaterThan(0)
    expect(ADS_STRATEGY_SLOT).toBe("strategy-recommendations")
  })
})

describe("buildStrategyBrief", () => {
  it("always keeps the business name and the live URL line", () => {
    const brief = buildStrategyBrief(FULL_INPUT)
    expect(brief).toContain("Business: Sweet Crust Bakery")
    expect(brief).toContain("Live URL: https://sweet-crust.example.com")
  })

  it("states honestly that there is no URL yet", () => {
    const brief = buildStrategyBrief({ projectName: "Tiny App" })
    expect(brief).toContain("Live URL: none yet")
    expect(brief).toContain("recommendations must work without a link")
  })

  it("carries the founder's goal and every saved strategy field", () => {
    const brief = buildStrategyBrief(FULL_INPUT)
    expect(brief).toContain("Founder's goal: Sell 100 weekend bundles — aiming for: A shop that runs itself")
    expect(brief).toContain("Founder's advertising objectives: Fill the weekend calendar; Grow repeat orders")
    expect(brief).toContain("Preferred channels: Facebook; Instagram")
    expect(brief).toContain("Ideal customer: Families in Kampala")
    expect(brief).toContain("Positioning (founder): The bakery that beats the queue.")
    expect(brief).toContain("Priorities: First 20 orders")
    expect(brief).toContain("Selling points to emphasize: Oven-fresh on arrival; first delivery free")
    expect(brief).toContain("Target geographies: Kampala")
    expect(brief).toContain("Brand voice: Warm, plain-spoken")
    expect(brief).toContain("Budget note (intent, not a spend record): Start small, scale what works")
  })

  it("includes plan prose and target users when there is room", () => {
    const brief = buildStrategyBrief({
      projectName: "Tea Kiosk",
      description: "A tea subscription kiosk",
      positioningFromPlan: "The freshest cup on the platform",
      targetUsers: ["Commuters"],
    })
    expect(brief).toContain("Positioning from the plan: The freshest cup on the platform")
    expect(brief).toContain("What it is: A tea subscription kiosk")
    expect(brief).toContain("Target users: Commuters")
  })

  it("keeps founder strategy over plan prose and never exceeds the service cap", () => {
    const verbose: StrategyBriefInput = {
      ...FULL_INPUT,
      strategy: {
        positioning: "P".repeat(500),
        icp: "I".repeat(400),
        geographies: "G".repeat(300),
        objectives: Array.from({ length: 6 }, (_, i) => `Objective ${i + 1}: ${"o".repeat(100)}`),
        channels: Array.from({ length: 6 }, (_, i) => `Channel ${i + 1}: ${"c".repeat(100)}`),
        budgetNote: "B".repeat(300),
        priorities: Array.from({ length: 6 }, (_, i) => `Priority ${i + 1}: ${"p".repeat(100)}`),
        brandVoice: "V".repeat(200),
        usps: "U".repeat(500),
      },
      positioningFromPlan: "Plan positioning prose that would normally appear. ".repeat(20),
      description: "A description of the app. ".repeat(10),
      targetUsers: ["Users"],
    }
    const brief = buildStrategyBrief(verbose)
    expect(brief.length).toBeLessThanOrEqual(SERVICE_BRIEF_CAP)
    // Essential and founder lines survive whole:
    expect(brief).toContain("Business: Sweet Crust Bakery")
    expect(brief).toContain("Live URL: https://sweet-crust.example.com")
    expect(brief).toContain("Founder's goal: Sell 100 weekend bundles")
    expect(brief).toContain("Founder's advertising objectives")
    // The anti-fabrication footer is never sliced away by the cap:
    expect(brief).toContain("do not invent facts that are not here")
    // Plan backing prose gives way first:
    expect(brief).not.toContain("Positioning from the plan:")
    expect(brief).not.toContain("What it is:")
  })

  it("asks for grounded recommendations and forbids fabricated results", () => {
    const brief = buildStrategyBrief({ projectName: "Tiny App" })
    expect(brief).toContain("4–6 concrete recommendations")
    expect(brief).toContain("do not invent facts that are not here")
    expect(brief).toContain("Do not invent budget numbers")
    expect(brief).toContain("start here first")
  })

  it("fits the service brief cap even with the most verbose input", () => {
    const brief = buildStrategyBrief({
      ...FULL_INPUT,
      positioningFromPlan: "Positioning prose. ".repeat(30),
      description: "Description. ".repeat(30),
    })
    expect(brief.length).toBeLessThanOrEqual(SERVICE_BRIEF_CAP)
  })
})
