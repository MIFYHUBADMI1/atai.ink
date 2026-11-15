import { describe, expect, it } from "vitest"
import {
  CompetitionReportError,
  buildCompetitionReportMessages,
  classifySources,
  detectInternalLeakage,
  parseCompetitionReport,
  renderCompetitionReportMarkdown,
  type ClassifiedSource,
  type CompetitionReport,
} from "./competition-report"
import { fallbackCompetitionQueries, normalizeMultiSearch } from "./competition-research-context"
import {
  claimsCitingSource,
  groupFiguresByGeography,
  growthFromFigures,
  reportCategoryDistribution,
  sourceCategoryDistribution,
  totalRunCost,
} from "./competition-view-model"

const CAKE_BUSINESS = {
  projectName: "Sweet Creations",
  description: "A custom cake ordering platform for a solo bakery. Customers design celebration cakes and pay deposits online.",
  targetUsers: ["Local residents ordering custom cakes for birthdays and weddings"],
}

function source(partial: Partial<ClassifiedSource> & { id: string }): ClassifiedSource {
  return {
    kind: "web",
    title: "Source",
    category: "competitor_website",
    relevance: "high",
    relevanceScore: 3,
    relevanceReason: "test",
    ...partial,
  }
}

const SOURCES: ClassifiedSource[] = [
  source({ id: "s1", title: "Homegrown — custom cake orders", url: "https://findhomegrown.com", domain: "findhomegrown.com", category: "competitor_website" }),
  source({ id: "s2", title: "BakeSmart cake software", url: "https://bakesmart.com/cake-matrix", domain: "bakesmart.com", category: "competitor_product" }),
  source({ id: "s3", title: "Global cakes and pastries market", url: "https://imarcgroup.com/global-cake-pastries-market", domain: "imarcgroup.com", category: "market_data", relevance: "medium" }),
  source({ id: "s4", title: "littlecaesars-com — restaurants/get_custom_pizza_options", kind: "data_tool", category: "data_tool", relevance: "irrelevant", relevanceScore: 0 }),
  source({ id: "s5", title: "Unrelated result", category: "irrelevant", relevance: "irrelevant", relevanceScore: 0 }),
]

function validReport(): CompetitionReport {
  return {
    keyFindings: [
      { text: "Homegrown takes custom cake orders online.", status: "verified_fact", evidence: [{ sourceId: "s1" }] },
    ],
    limitations: ["Competitor pricing was not found in the sources."],
    opportunities: [
      { text: "Offer instant deposit checkout, which the sources do not show rivals offering.", status: "ai_suggestion", evidence: [{ sourceId: "s1" }] },
    ],
    competitors: [
      {
        name: "Homegrown",
        website: "https://findhomegrown.com",
        category: "direct",
        whyItMayCompete: "Platform for custom cake orders.",
        evidence: [{ sourceId: "s1" }],
        verification: "verified",
        confidence: "high",
      },
      {
        name: "BakeSmart",
        website: "https://bakesmart.com",
        category: "supporting_software",
        whyItMayCompete: "Bakery software that could replace a dedicated ordering platform.",
        evidence: [{ sourceId: "s2" }],
        verification: "ai_suggestion",
        confidence: "medium",
      },
    ],
    marketFigures: [
      {
        label: "Global cakes and pastries market",
        value: 198.8,
        unit: "billion",
        currency: "USD",
        geographyScope: "global",
        geographyLabel: "Global",
        forecastPeriod: "by 2033",
        sourceId: "s3",
        status: "verified_fact",
      },
    ],
    customerBehaviour: [],
    news: [],
    featureComparison: [],
    pricingComparison: [],
    positioningNotes: [],
    gaps: ["Current pricing for Homegrown."],
    questions: ["What does Homegrown charge per order?"],
  }
}

describe("internal prompt leakage", () => {
  it("flags the Nov 13 style reasoning prose", () => {
    const leaked =
      "The user wants a competitor-landscape snapshot for Sweet Crust Bakery. I need to follow the exact structure with 9 sections. Let me analyze the sources first.\n\nSources provided:\n1. shopmarketplacefoods.com"
    expect(detectInternalLeakage(leaked)).not.toBeNull()
    expect(() => parseCompetitionReport(leaked, { sources: SOURCES })).toThrow(CompetitionReportError)
  })

  it("rejects a structurally valid report whose fields carry internal instructions", () => {
    const report = validReport()
    report.keyFindings[0].text = "I must cite sources like (source: domain). Now, I need to extract competitors."
    expect(() => parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })).toThrow(CompetitionReportError)
  })

  it("accepts clean founder-facing content", () => {
    expect(detectInternalLeakage("Homegrown takes custom cake orders online.")).toBeNull()
    const { report } = parseCompetitionReport(JSON.stringify(validReport()), { sources: SOURCES })
    expect(report.competitors).toHaveLength(2)
  })
})

describe("malformed structured output", () => {
  it("throws on non-JSON and on missing schema keys", () => {
    expect(() => parseCompetitionReport("no json here", { sources: SOURCES })).toThrow(CompetitionReportError)
    expect(() => parseCompetitionReport('{"keyFindings": []}', { sources: SOURCES })).toThrow(CompetitionReportError)
  })

  it("throws on invalid enum values", () => {
    const report = validReport()
    ;(report.competitors[0] as { category: string }).category = "frenemy"
    expect(() => parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })).toThrow(CompetitionReportError)
  })

  it("tolerates a fenced object but nothing else", () => {
    const { report } = parseCompetitionReport("```json\n" + JSON.stringify(validReport()) + "\n```", { sources: SOURCES })
    expect(report.competitors[0].name).toBe("Homegrown")
  })
})

describe("opportunity prioritization estimates", () => {
  it("preserves optional AI impact/effort fields and labels them in the founder-facing body", () => {
    const report = validReport()
    report.opportunities[0].impact = "high"
    report.opportunities[0].effort = "low"
    report.opportunities[0].confidence = "medium"
    report.opportunities[0].nextStep = "Validate demand with five target customers."
    const { report: parsed } = parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })
    expect(parsed.opportunities[0].impact).toBe("high")
    expect(parsed.opportunities[0].effort).toBe("low")
    const markdown = renderCompetitionReportMarkdown(parsed, SOURCES)
    expect(markdown).toContain("AI estimate")
    expect(markdown).toContain("Next step: Validate demand")
  })
})

describe("source relevance classification", () => {
  it("labels pizza-chain data tools irrelevant for a cake bakery and keeps them as leads", () => {
    const raw = normalizeMultiSearch(
      {
        data: {
          web: [
            { title: "Cakes & Custom Cakes | MarketPlace Foods", url: "https://shopmarketplacefoods.com/cakes", description: "Custom cakes online ordering" },
            { title: "Best Platform for Custom Cake Orders - Homegrown", url: "https://findhomegrown.com/blog", description: "Custom cake orders platform" },
          ],
          tools: [
            { provider: "littlecaesars-com", capability: "restaurants/get_custom_pizza_options", description: "Pizza customization options" },
            { provider: "dominos-ca", capability: "restaurants/directory", description: "Store directory" },
          ],
        },
      },
      0,
    )
    const classified = classifySources(raw, CAKE_BUSINESS)
    const pizza = classified.find((s) => s.provider === "littlecaesars-com")
    expect(pizza?.category).toBe("data_tool")
    expect(pizza?.relevance).toBe("irrelevant")
    const homegrown = classified.find((s) => s.domain === "findhomegrown.com")
    expect(homegrown?.relevance).not.toBe("irrelevant")
    // Irrelevant sources are preserved, never silently dropped.
    expect(classified).toHaveLength(raw.length)
  })

  it("classifies pricing pages, review communities and report publishers", () => {
    const raw = normalizeMultiSearch(
      {
        data: {
          web: [
            { title: "Acme pricing", url: "https://acme.com/pricing", description: "Custom cake software pricing plans" },
            { title: "Any good websites for taking cake orders?", url: "https://www.reddit.com/r/cakedecorating/comments/x", description: "Cake ordering discussion" },
            { title: "Global cakes market to reach USD 198.8 billion", url: "https://www.imarcgroup.com/global-cake-pastries-market", description: "Market forecast" },
          ],
        },
      },
      0,
    )
    const classified = classifySources(raw, CAKE_BUSINESS)
    expect(classified[0].category).toBe("pricing_page")
    expect(classified[1].category).toBe("customer_research")
    expect(classified[2].category).toBe("market_data")
  })
})

describe("competitor classification and evidence attribution", () => {
  it("keeps software vendors as supporting_software and never auto-labels direct", () => {
    const { report } = parseCompetitionReport(JSON.stringify(validReport()), { sources: SOURCES })
    expect(report.competitors[1].category).toBe("supporting_software")
  })

  it("downgrades verified competitors without a competitor-site source", () => {
    const report = validReport()
    report.competitors[0].evidence = [{ sourceId: "s3" }] // market data only
    const { report: parsed, notes } = parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })
    expect(parsed.competitors[0].verification).toBe("ai_suggestion")
    expect(notes.join(" ")).toContain("downgraded")
  })

  it("strips data-tool and irrelevant evidence and marks the competitor research_needed", () => {
    const report = validReport()
    report.competitors[0].evidence = [{ sourceId: "s4" }, { sourceId: "s5" }]
    const { report: parsed } = parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })
    expect(parsed.competitors[0].evidence).toHaveLength(0)
    expect(parsed.competitors[0].verification).toBe("research_needed")
    expect(parsed.competitors[0].confidence).toBe("low")
  })

  it("downgrades verified_fact claims without supporting evidence to AI interpretation", () => {
    const report = validReport()
    report.keyFindings[0].evidence = []
    const { report: parsed } = parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })
    expect(parsed.keyFindings[0].status).toBe("ai_interpretation")
  })

  it("drops unknown source citations and unsafe competitor websites", () => {
    const report = validReport()
    report.keyFindings[0].evidence = [{ sourceId: "s99" }]
    report.competitors[0].website = "javascript:alert(1)"
    const { report: parsed } = parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })
    expect(parsed.keyFindings[0].evidence).toHaveLength(0)
    expect(parsed.keyFindings[0].status).toBe("ai_interpretation")
    expect(parsed.competitors[0].website).toBeUndefined()
  })
})

describe("geographic market separation", () => {
  it("keeps figures from different geographies in separate groups", () => {
    const report = validReport()
    report.marketFigures.push({
      label: "India bakery sector",
      value: 13.8,
      unit: "billion",
      currency: "USD",
      geographyScope: "country",
      geographyLabel: "India",
      publicationDate: "2024",
      sourceId: "s3",
      status: "verified_fact",
    })
    const groups = groupFiguresByGeography(report)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.label).sort()).toEqual(["Global", "India"])
    for (const group of groups) {
      expect(new Set(group.figures.map((f) => f.geographyLabel))).toHaveLength(1)
    }
  })

  it("drops market figures whose source is a data tool or irrelevant", () => {
    const report = validReport()
    report.marketFigures[0].sourceId = "s4"
    const { report: parsed, notes } = parseCompetitionReport(JSON.stringify(report), { sources: SOURCES })
    expect(parsed.marketFigures).toHaveLength(0)
    expect(notes.join(" ")).toContain("not eligible evidence")
  })

  it("growth signal carries its own geography and never blends scopes", () => {
    const report = validReport()
    report.marketFigures[0].value = 6.2
    report.marketFigures[0].unit = "%"
    const signal = growthFromFigures(report)
    expect(signal?.percent).toBe(6.2)
    expect(signal?.geographyLabel).toBe("Global")
    expect(signal?.geographyScope).toBe("global")
  })
})

describe("honest charts and counts", () => {
  it("category distribution counts only real classified competitors", () => {
    const { report } = parseCompetitionReport(JSON.stringify(validReport()), { sources: SOURCES })
    const slices = reportCategoryDistribution(report)
    expect(slices.find((s) => s.key === "direct")?.count).toBe(1)
    expect(slices.find((s) => s.key === "supporting_software")?.count).toBe(1)
    expect(slices.reduce((sum, s) => sum + s.count, 0)).toBe(2)
  })

  it("returns empty distributions and no growth signal when evidence is missing", () => {
    const empty = validReport()
    empty.competitors = []
    empty.marketFigures = []
    expect(reportCategoryDistribution(empty)).toEqual([])
    expect(growthFromFigures(empty)).toBeNull()
    expect(sourceCategoryDistribution([])).toEqual([])
  })

  it("source distribution uses real retrieved counts", () => {
    const slices = sourceCategoryDistribution(SOURCES)
    expect(slices.reduce((sum, s) => sum + s.count, 0)).toBe(SOURCES.length)
  })
})

describe("evidence ledger and rendering", () => {
  it("links claims to the sources that support them", () => {
    const { report } = parseCompetitionReport(JSON.stringify(validReport()), { sources: SOURCES })
    expect(claimsCitingSource(report, "s1")).toContain("Homegrown takes custom cake orders online.")
    expect(claimsCitingSource(report, "s1")).toContain("Homegrown")
    expect(claimsCitingSource(report, "s3")).toContain("Global cakes and pastries market")
    expect(claimsCitingSource(report, "s4")).toEqual([])
  })

  it("renders founder-facing markdown with statuses and citations, never raw model text", () => {
    const { report, notes } = parseCompetitionReport(JSON.stringify(validReport()), { sources: SOURCES })
    const markdown = renderCompetitionReportMarkdown(report, SOURCES, notes)
    expect(markdown).toContain("## Competitors found in the live research")
    expect(markdown).toContain("[Verified fact]")
    expect(markdown).toContain("(source: findhomegrown.com)")
    expect(markdown).toContain("Global (global)")
    expect(markdown).not.toContain("The user wants")
  })
})

describe("prompt contract", () => {
  it("asks for JSON only, numbered eligible sources and geography rules", () => {
    const messages = buildCompetitionReportMessages({
      projectName: "Sweet Creations",
      description: CAKE_BUSINESS.description,
      research: { queries: ["custom cake platforms competitors"], sources: SOURCES },
    })
    expect(messages.system).toContain("JSON")
    expect(messages.prompt).toContain("[s1]")
    expect(messages.prompt).toContain("relevance")
    expect(messages.prompt).toContain("geographyScope")
    expect(messages.prompt).toContain("Never include your reasoning")
    expect(messages.prompt.length).toBeLessThan(18_000)
  })

  it("fallback queries never contain ellipses", () => {
    const queries = fallbackCompetitionQueries(
      {
        projectName: "Sweet Creations",
        description: "A custom cake and pastry ordering platform where customers design celebration cakes and pay deposits online for local pickup.",
        targetUsers: ["Local residents ordering custom cakes for birthdays, weddings and corporate events"],
      },
      2026,
    )
    expect(queries).toHaveLength(5)
    for (const query of queries) {
      expect(query).not.toContain("…")
      expect(query.length).toBeLessThanOrEqual(120)
    }
  })
})

describe("credit accounting", () => {
  it("total run cost sums the metered analysis and the fixed search charge", () => {
    expect(
      totalRunCost({ id: "x", title: "t", body: "", creditsCharged: 7870, createdAt: 1, research: { queries: [], collectedAt: 1, sources: [], researchCreditsCharged: 15 } }),
    ).toBe(7885)
    expect(totalRunCost({ id: "x", title: "t", body: "", creditsCharged: 0, createdAt: 1 })).toBe(0)
  })
})