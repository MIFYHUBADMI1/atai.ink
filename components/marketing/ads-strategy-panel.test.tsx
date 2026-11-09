import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/lib/client/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  putJson: vi.fn(),
  postJson: vi.fn(),
}))

const { AdsStrategyPanel } = await import("./ads-strategy-panel")

const SAVED = {
  positioning: "The bakery that beats the queue.",
  icp: "Families in Kampala",
  geographies: "Kampala",
  objectives: ["Fill the weekend calendar"],
  channels: ["Facebook", "Instagram"],
  budgetNote: "Start small",
  priorities: ["First 20 orders"],
  brandVoice: "Warm, plain-spoken",
  usps: "Oven-fresh on arrival",
  updatedAt: Date.parse("2026-11-09T09:00:00.000Z"),
}

const DRAFT = {
  id: "content_1",
  title: "Advertising strategy recommendations",
  body: "1. Lead with the breakfast bundle…",
  kind: "brief",
  creditsCharged: 4,
  createdAt: Date.parse("2026-11-09T08:30:00.000Z"),
}

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(AdsStrategyPanel, { projectId: "proj_1", prefill: {}, creditsAvailable: null, aiTextReady: true, initialRecommendations: [], ...props } as never))

describe("AdsStrategyPanel — the Strategy tab surface", () => {
  it("renders every founder field with its bound and the free-to-save framing", () => {
    const html = render({ strategy: SAVED })
    expect(html).toContain("Advertising strategy")
    expect(html).toContain("Your strategy, in your own words")
    expect(html).toContain("Saving is free")
    expect(html).toContain("Positioning")
    expect(html).toContain("Ideal customer")
    expect(html).toContain("Geographies")
    expect(html).toContain("Advertising objectives")
    expect(html).toContain("Preferred channels")
    expect(html).toContain("Priorities")
    expect(html).toContain("Budget note")
    expect(html).toContain("Brand voice")
    expect(html).toContain("Selling points to emphasize")
    expect(html).toContain("The bakery that beats the queue.")
    expect(html).toContain('value="Families in Kampala"')
    expect(html).toContain("32/500") // positioning counter shows value against the cap
    expect(html).toContain("Save changes")
  })

  it("shows the saved stamp and prefills from the plan when nothing is saved", () => {
    const html = render({ prefill: { positioning: "From the plan positioning." } })
    expect(html).toContain("From the plan positioning.")
    expect(html).not.toContain("Saved ")
    expect(html).toContain("Save strategy")
  })

  it("discloses the metered AI recommendation and lists saved drafts with Studio deep links", () => {
    const html = render({ strategy: SAVED, creditsAvailable: 120, initialRecommendations: [DRAFT] })
    expect(html).toContain("120 credits available")
    expect(html).toContain("metered AI draft")
    expect(html).toContain("never overwrite what you typed")
    expect(html).toContain("Advertising strategy recommendations")
    expect(html).toContain("4 credits")
    expect(html).toContain("/project/proj_1/studio?tab=library&amp;item=content_1")
    expect(html).toContain("Generate new recommendations")
  })

  it("shows the empty state and honest no-platform disclaimer", () => {
    const html = render({})
    expect(html).toContain("No recommendations yet")
    expect(html).toContain("Atai doesn&#x27;t place, run, or manage ads")
    expect(html).toContain("no impressions")
  })

  it("disables generation and explains why when AI text isn't configured", () => {
    const html = render({ aiTextReady: false })
    expect(html).toContain("AI text generation isn&#x27;t configured on this deployment yet")
    expect(html).toContain("disabled")
    expect(html).toContain("you can still save your strategy")
  })
})
