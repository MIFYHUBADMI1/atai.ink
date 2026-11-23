import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { IntakeView } from "@/lib/existing-business/view"
import type { BusinessAssessment } from "@/lib/types/business-intake"
import { businessBaseRef } from "@/lib/connected-business/surface"
import { BusinessProfile } from "./business-profile"

vi.mock("@/lib/client/api", () => ({ jsonFetcher: vi.fn(), postJson: vi.fn(), patchJson: vi.fn(), deleteJson: vi.fn() }))

const assessment = {
  generatedAt: 1,
  evidence: { websiteAnalysed: true, pagesCrawled: 3, ownerDescription: true, domainVerified: false },
  understanding: "A neighbourhood bakery selling bread and pastries.",
  currentPosition: "Clear product, no way to order.",
  strengths: [],
  challenges: [],
  growthOpportunities: [],
  technicalOpportunities: [],
  marketingOpportunities: [],
  priorities: [],
  actionPlan: [],
  openQuestions: [],
} satisfies BusinessAssessment

function view(overrides: Partial<IntakeView> = {}): IntakeView {
  return {
    startingPoint: "existing_business",
    displayName: "Corner Bakery",
    objectives: [],
    overall: "completed",
    website: { submitted: true, analyzed: true, status: "completed", url: "https://bakery.example", pagesCrawled: 3 },
    claim: { state: "unclaimed" },
    domain: { records: [], verified: false },
    connection: { status: "not_connected", label: "Not connected" },
    assessment: { status: "completed", result: assessment, generatedAt: 1 },
    ...overrides,
  }
}

function render(v: IntakeView) {
  return renderToStaticMarkup(createElement(BusinessProfile, { projectId: "p1", initialView: v }))
}

/**
 * The whole point of the page is that exactly one step's panel is on screen.
 * These assertions therefore target panel-only copy: the progress rail always
 * lists every step, so a step title proves nothing about what is open.
 */
describe("BusinessProfile", () => {
  it("opens the domain step, and only that panel, once the first read exists", () => {
    const html = render(view())

    expect(html).toContain("Step 2 of 3")
    expect(html).toContain("Start verification")
    expect(html).toContain("Add the tag, then check")
    // Neither the connection panel nor the report is mounted yet.
    expect(html).not.toContain("The one call that finishes it")
    expect(html).not.toContain("Do this first")
  })

  it("opens the connection step once the domain is proven", () => {
    const html = render(view({ domain: { records: [], verified: true, hostname: "bakery.example" } }))

    expect(html).toContain("Step 3 of 3")
    expect(html).toContain("The one call that finishes it")
    expect(html).not.toContain("Start verification")
  })

  it("keeps the next step closed until the current one is verified", () => {
    const html = render(view({ assessment: { status: "pending" } }))

    expect(html).toContain("Step 1 of 3")
    expect(html).toContain("Write my first read")
    expect(html).toContain("The next step stays closed until this one is verified.")
    expect(html).not.toContain("Start verification")
    expect(html).not.toContain("The one call that finishes it")
  })

  it("says the next step is closed while a step is unfinished", () => {
    const html = render(view({ assessment: { status: "pending" } }))

    expect(html).toMatch(/Next: <!-- -->Prove the website is yours|Next: Prove the website is yours/)
  })

  it("stops asking for steps once the connection is verified, and offers somewhere to go", () => {
    const html = render(
      view({
        domain: { records: [], verified: true, hostname: "bakery.example" },
        connection: { status: "verified", label: "Connected", firstSeenAt: 1, lastSeenAt: 1 },
      }),
    )

    expect(html).toContain("All three steps are done")
    expect(html).toContain("Ask your co-founder")
    expect(html).toContain("Where to go next")
  })

  it("links inside the operate surface when it is given the serialisable base", () => {
    const html = renderToStaticMarkup(
      createElement(BusinessProfile, {
        projectId: "p1",
        initialView: view({
          domain: { records: [], verified: true, hostname: "bakery.example" },
          connection: { status: "verified", label: "Connected", firstSeenAt: 1, lastSeenAt: 1 },
        }),
        base: businessBaseRef("biz_1"),
      }),
    )

    expect(html).toContain('href="/business/biz_1/growth"')
    expect(html).toContain('href="/business/biz_1/money"')
    expect(html).toContain('href="/business/biz_1/plan"')
    expect(html).not.toContain('href="/project/p1/market"')
  })

  it("sends the founder to its own keys, never into the build workspace", () => {
    const html = renderToStaticMarkup(
      createElement(BusinessProfile, {
        projectId: "p1",
        initialView: view({ domain: { records: [], verified: true, hostname: "bakery.example" } }),
        base: businessBaseRef("biz_1"),
      }),
    )

    expect(html).toContain('href="/business/biz_1/settings"')
    expect(html).not.toContain('href="/project/p1/')
  })

  it("tells the founder what the connection is for, and what Atai will not do", () => {
    const html = render(view({ domain: { records: [], verified: true, hostname: "bakery.example" } }))

    expect(html).toContain("What the handshake unlocks")
    expect(html).toContain("Never rebuilds or redeploys your application.")
    expect(html).toContain("Never asks for your repository to advise you.")
  })

  it("lets the founder open the read instead of trusting the page count", () => {
    const html = render(
      view({
        assessment: { status: "failed" },
        website: { submitted: true, analyzed: true, status: "completed", url: "https://bakery.example", pagesCrawled: 1 },
      }),
    )

    expect(html).toContain("1 page read")
    expect(html).toContain("See what was read")
  })

  it("shows why the read failed instead of only that it failed", () => {
    const html = render(
      view({
        assessment: {
          status: "failed",
          error: {
            code: "ASSESSMENT_FAILED",
            message: "The co-founder could not produce a dependable assessment this time.",
            detail: "test-model returned HTTP 429 — the provider is rate-limiting Atai",
          },
        },
      }),
    )

    expect(html).toContain("Why:")
    expect(html).toContain("HTTP 429")
  })

  it("blames the engine, names it, and offers the switch when the engine failed", () => {
    const html = render(
      view({
        assessment: {
          status: "failed",
          engine: { tierId: "spark", tierName: "Spark", modelId: "nvidia/nemotron-3-ultra-550b-a55b:free" },
          error: {
            code: "ASSESSMENT_FAILED",
            message: "The co-founder could not produce a dependable assessment this time.",
            detail: "No reply from nvidia/nemotron-3-ultra-550b-a55b:free after 91s (timeout).",
            reason: "timeout",
          },
        },
      }),
    )

    expect(html).toContain("engine couldn")
    expect(html).toContain("Spark")
    expect(html).toContain("did not reply in time")
    expect(html).toContain("Fix the issue")
    expect(html).toContain("Try again")
    expect(html).toContain("/settings/ai?next=%2Fproject%2Fp1%2Fbusiness")
  })

  it("does not blame the engine when Atai itself could not run", () => {
    const html = render(
      view({
        assessment: {
          status: "failed",
          error: { code: "AI_UNAVAILABLE", message: "The AI co-founder could not run this time." },
        },
      }),
    )

    expect(html).not.toContain("Fix the issue")
    expect(html).toContain("Try again")
  })

  it("offers no preview when the website was not read", () => {
    const html = render(
      view({
        assessment: { status: "pending" },
        website: { submitted: true, analyzed: false, status: "failed", url: "https://bakery.example" },
      }),
    )

    expect(html).not.toContain("See what was read")
  })

  it("offers the finished first read instead of hiding it behind the current step", () => {
    const html = render(view())

    expect(html).toContain("Your first read is ready")
  })

})

describe("BusinessProfile — a business held by another account", () => {
  it("shows the blocked card instead of verification controls", () => {
    const html = render(view({ claim: { hostname: "bakery.example", state: "held_by_other" } }))

    expect(html).toContain("connected to another Atai account")
    expect(html).not.toContain("Start verification")
    expect(html).not.toContain("Add the tag, then check")
    expect(html).not.toContain("atai-verification")
  })
})
