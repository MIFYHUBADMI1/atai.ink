import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { IntakeView } from "@/lib/existing-business/view"
import type { BusinessAssessment } from "@/lib/types/business-intake"
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

  it("tells the founder what the connection is for, and what Atai will not do", () => {
    const html = render(view({ domain: { records: [], verified: true, hostname: "bakery.example" } }))

    expect(html).toContain("What the handshake unlocks")
    expect(html).toContain("Never rebuilds or redeploys your application.")
    expect(html).toContain("Never asks for your repository to advise you.")
  })

  it("offers the finished first read instead of hiding it behind the current step", () => {
    const html = render(view())

    expect(html).toContain("Your first read is ready")
  })
})
