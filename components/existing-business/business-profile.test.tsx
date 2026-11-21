import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { IntakeView } from "@/lib/existing-business/view"
import { BusinessProfile } from "./business-profile"

vi.mock("@/lib/client/api", () => ({ jsonFetcher: vi.fn(), postJson: vi.fn(), patchJson: vi.fn() }))

const assessmentResult = {
  evidence: { websiteAnalysed: true, pagesCrawled: 3, ownerDescription: true, domainVerified: false },
  summary: "A neighbourhood bakery selling bread and pastries.",
  findings: [],
  priorities: [],
} as unknown as NonNullable<IntakeView["assessment"]["result"]>

function view(overrides: Partial<IntakeView> = {}): IntakeView {
  return {
    startingPoint: "existing_business",
    displayName: "Corner Bakery",
    objectives: [],
    overall: "completed",
    website: { submitted: true, analyzed: true, status: "completed", url: "https://bakery.example", pagesCrawled: 3 },
    domain: { records: [], verified: false },
    connection: { status: "not_connected", label: "Not connected" },
    assessment: { status: "completed", result: assessmentResult, generatedAt: 1 },
    ...overrides,
  }
}

function render(v: IntakeView) {
  return renderToStaticMarkup(createElement(BusinessProfile, { projectId: "p1", initialView: v }))
}

/**
 * The whole point of the stepper: exactly one step's panel is on screen. Before
 * this, the domain form, the connection handshake and the full assessment were
 * all rendered at once, which is what made "what do I do next?" unanswerable.
 */
describe("BusinessProfile stepper", () => {
  it("shows only the domain step when the assessment is done", () => {
    const html = render(view())

    expect(html).toContain("Step 2 of 3")
    expect(html).toContain("Start verification")
    // The connection panel and its handshake snippet stay hidden until step 3.
    expect(html).not.toContain("Handshake check")
    expect(html).not.toContain("Issue key &amp; download guide")
  })

  it("shows only the connection step once the domain is verified", () => {
    const html = render(view({ domain: { records: [], verified: true, hostname: "bakery.example" } }))

    expect(html).toContain("Step 3 of 3")
    expect(html).toContain("Handshake check")
    expect(html).not.toContain("Start verification")
  })

  it("keeps the next step closed until the current one is verified", () => {
    const html = render(view({ assessment: { status: "processing" } }))

    expect(html).toContain("Step 1 of 3")
    expect(html).toContain("Reading your business")
    expect(html).not.toContain("Start verification")
    expect(html).not.toContain("Handshake check")
  })

  it("stops asking for steps once the connection is verified", () => {
    const html = render(
      view({
        domain: { records: [], verified: true, hostname: "bakery.example" },
        connection: { status: "verified", label: "Connected", firstSeenAt: 1, lastSeenAt: 1 },
      }),
    )

    expect(html).toContain("All three steps are done")
    expect(html).toContain("Ask your co-founder")
  })
})
