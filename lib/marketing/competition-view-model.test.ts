import { describe, expect, it } from "vitest"
import {
  buildLandscapeModel,
  buildScanSeries,
  competitivenessLabel,
  countMentions,
  extractGrowthSignal,
  formatStamp,
  parseCompetitionBody,
  type CompetitionSnapshotItem,
  type CompetitionSourceView,
} from "./competition-view-model"

const BODY = `## 1. Positioning

Custom cakes for local celebrations.

## 2. Who it serves

Local residents ordering custom cakes.

## 3. Competitors found in the live research

- **Cake Boutique** — premium custom cakes (source: cakeboutique.example)
- **Sweet Dreams Bakery** — budget cakes (source: news.example)
- Custom Cakes Co. — online ordering focus (source: cakeboutique.example)

## 4. Market size & valuation signals

The custom cake market shows 12% growth year over year (source: report.example).

## 5. Recent news & funding

Sweet Dreams Bakery raised a seed round (source: news.example).

## 7. Differentiation opportunities

- Premium customization with unique designs.
- Delivery reliability for event planners.

## 8. What the sources do not establish

- Current pricing for Cake Boutique.

## 9. Questions to investigate next

- Which competitor owns the wedding segment?
`

const sources: CompetitionSourceView[] = [
  { kind: "web", title: "Cake Boutique — custom cakes", snippet: "Cake Boutique leads premium custom cakes.", url: "https://cakeboutique.example" },
  { kind: "web", title: "Sweet Dreams Bakery", snippet: "Sweet Dreams Bakery budget range.", url: "https://sweet.example" },
  { kind: "news", title: "Bakery funding news", snippet: "Sweet Dreams Bakery raises seed.", url: "https://news.example" },
  { kind: "research", title: "Custom cake market report", snippet: "Market overview without named players.", url: "https://report.example" },
]

describe("parseCompetitionBody", () => {
  it("splits numbered headings and extracts competitors with citations", () => {
    const parse = parseCompetitionBody(BODY)
    expect(parse.positioning).toContain("Custom cakes for local celebrations")
    expect(parse.competitors.map((c) => c.name)).toEqual(["Cake Boutique", "Sweet Dreams Bakery", "Custom Cakes Co."])
    expect(parse.competitors[0].citations).toEqual(["cakeboutique.example"])
    expect(parse.opportunities).toHaveLength(2)
    expect(parse.gaps).toHaveLength(1)
    expect(parse.questions).toHaveLength(1)
    expect(parse.market).toContain("12% growth")
  })
  it("returns no competitors when the sources establish none", () => {
    const parse = parseCompetitionBody("## Competitors found in the live research\n\nNo real competitors appear in the sources.")
    expect(parse.competitors).toEqual([])
  })
  it("tolerates unnumbered and bold headings", () => {
    const parse = parseCompetitionBody("### Positioning\n\nX\n\n### Differentiation opportunities\n\n- Y")
    expect(parse.positioning).toBe("X")
    expect(parse.opportunities).toEqual(["Y"])
  })
})

describe("landscape model", () => {
  it("computes mention shares plus an Others bucket from real sources", () => {
    const parse = parseCompetitionBody(BODY)
    const model = buildLandscapeModel(parse.competitors, sources)
    expect(countMentions("Cake Boutique", sources)).toBe(1)
    expect(countMentions("Sweet Dreams Bakery", sources)).toBe(2)
    expect(model.unattributedSources).toBe(1)
    const total = model.slices.reduce((sum, s) => sum + s.mentions, 0)
    expect(total).toBe(4)
    expect(model.slices.map((s) => s.name)).toContain("Others")
  })
  it("never invents mentions for short or absent names", () => {
    expect(countMentions("AB", sources)).toBe(0)
    expect(countMentions("Nobody Co.", sources)).toBe(0)
  })
})

describe("growth signal", () => {
  it("extracts a source-reported growth percentage", () => {
    const signal = extractGrowthSignal("The custom cake market shows 12% growth year over year (source: report.example).")
    expect(signal).not.toBeNull()
    expect(signal?.percent).toBe(12)
    expect(signal?.direction).toBe("up")
  })
  it("detects decline and ignores unrelated percentages", () => {
    expect(extractGrowthSignal("Revenue fell 3% as the market contracts.")?.direction).toBe("down")
    expect(extractGrowthSignal("We bake 100% custom cakes.")).toBeNull()
    expect(extractGrowthSignal(null)).toBeNull()
  })
})

describe("series and labels", () => {
  it("builds an oldest-first scan series from newest-first drafts", () => {
    const drafts: CompetitionSnapshotItem[] = [
      { id: "new", title: "t", body: BODY, creditsCharged: 0, createdAt: 2000, research: { queries: [], collectedAt: 2000, sources, researchCreditsCharged: 0 } },
      { id: "old", title: "t", body: "## Competitors found in the live research\n\n- **Cake Boutique** — x", creditsCharged: 0, createdAt: 1000 },
    ]
    const series = buildScanSeries(drafts)
    expect(series.map((p) => p.id)).toEqual(["old", "new"])
    expect(series[0].competitors).toBe(1)
    expect(series[1].competitors).toBe(3)
    expect(series[1].sources).toBe(4)
  })
  it("labels competitiveness from real counts", () => {
    expect(competitivenessLabel(0).label).toBe("No Signal Yet")
    expect(competitivenessLabel(3).label).toBe("Moderately Competitive")
    expect(competitivenessLabel(9).label).toBe("Crowded Market")
  })
  it("formats deterministic UTC stamps", () => {
    expect(formatStamp(Date.UTC(2026, 10, 10, 14, 45))).toBe("Nov 10, 2026 • 2:45 PM UTC")
    expect(formatStamp(0)).toBe("date unknown")
  })
})