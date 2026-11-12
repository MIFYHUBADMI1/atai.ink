import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
vi.mock("@/lib/client/api", () => ({ postJson: vi.fn() }))
import {
  buildCompetitionQueryMessages,
  buildCompetitionResearchMessages,
  dedupeSources,
  fallbackCompetitionQueries,
  normalizeMultiSearch,
  parseCompetitionQueries,
  COMPETITION_RESEARCH_MAX_SOURCES,
} from "@/lib/marketing/competition-research-context"
import { CompetitionSnapshotPanel } from "@/components/marketing/competition-snapshot-panel"

describe("competition research evidence shaping", () => {
  it("normalizes web, news, research-category and data-tool results, dropping unsafe URLs", () => {
    const sources = normalizeMultiSearch(
      {
        data: {
          web: [
            { title: "Acme rival", url: "https://acme.com/pricing", description: "Acme pricing page", markdown: "# Acme\n\nCharges $9/mo" },
            { title: "Market report", url: "https://research.org/report", category: "research", description: "Category sized at $4B" },
            { title: "Evil", url: "javascript:alert(1)" },
          ],
          news: [{ title: "Acme raises", url: "https://news.example.com/acme", snippet: "Series A", date: "2026-10-02" }],
          tools: [{ provider: "Crunchbase-like", capability: "company funding data", description: "Funding datasets" }],
        },
      },
      0,
    )
    const kinds = sources.map((s) => s.kind)
    expect(kinds).toContain("web")
    expect(kinds).toContain("research")
    expect(kinds).toContain("news")
    expect(kinds).toContain("data_tool")
    expect(sources.every((s) => !s.url || /^https?:\/\//i.test(s.url))).toBe(true)
    const research = sources.find((s) => s.kind === "research")
    expect(research?.domain).toBe("research.org")
    const web = sources.find((s) => s.kind === "web")
    expect(web?.excerpt).toContain("Charges $9/mo")
    const tool = sources.find((s) => s.kind === "data_tool")
    expect(tool?.title).toContain("company funding data")
  })

  it("returns nothing for a malformed response and dedupes across searches by URL", () => {
    expect(normalizeMultiSearch({ data: 42 }, 0)).toEqual([])
    const dup = { kind: "web" as const, title: "Same", url: "https://same.com/a", queryIndex: 0 }
    const other = { kind: "news" as const, title: "Also same", url: "https://SAME.com/a/", queryIndex: 1 }
    expect(dedupeSources([dup, other])).toHaveLength(1)
    expect(dedupeSources([dup, other])[0].queryIndex).toBe(0)
  })

  it("derives plan-based fallback queries and parses the model's JSON queries, stripping quotes", () => {
    const fallback = fallbackCompetitionQueries(
      { projectName: "Cakely", description: "A custom cake ordering app for neighborhood bakeries. More text.", targetUsers: ["Home bakers"] },
      2026,
    )
    expect(fallback).toHaveLength(3)
    expect(fallback[0]).toContain("competitors alternatives")
    expect(fallback[1]).toContain("market size valuation 2026")
    expect(fallback.every((q) => q.length <= 120)).toBe(true)
    expect(fallback.every((q) => !q.includes("Cakely"))).toBe(true)

    expect(parseCompetitionQueries('```json\n{"competitors": "cake ordering apps", "market": "\\"cake market\\" size"}\n```')).toEqual({
      competitors: "cake ordering apps",
      market: "cake market size",
    })
    expect(parseCompetitionQueries("no json here")).toBeNull()
    expect(parseCompetitionQueries('{"market": "  "}')).toBeNull()
  })

  it("builds the grounded analysis prompt with numbered sources, citation rules, and honest empty state", () => {
    const research = {
      queries: ["cake ordering apps competitors"],
      sources: normalizeMultiSearch(
        {
          data: {
            web: [{ title: "Acme rival", url: "https://acme.com", description: "Rival bakery app", markdown: "Details here" }],
            news: [{ title: "Acme raises", url: "https://news.example.com/a", snippet: "Funding", date: "2026-10-02" }],
          },
        },
        0,
      ),
    }
    const messages = buildCompetitionResearchMessages({
      projectName: "Cakely",
      description: "Custom cake ordering",
      marketingPlan: "Positioning: warm neighborhood bakery ordering.",
      research,
    })
    expect(messages.system).toContain("cite")
    expect(messages.prompt).toContain("(source: example.com)".slice(0, 15))
    expect(messages.prompt).toContain("[1] web · Acme rival — acme.com")
    expect(messages.prompt).toContain("2026-10-02")
    expect(messages.prompt).toContain("Details here")
    expect(messages.prompt).toContain("Positioning: warm neighborhood bakery ordering.")
    expect(messages.prompt).toContain("Never invent")
    // The plan + sources fit the explicit budget.
    expect(messages.prompt.length).toBeLessThan(18_000)

    const empty = buildCompetitionResearchMessages({ projectName: "Cakely", research: { queries: [], sources: [] } })
    expect(empty.prompt).toContain("returned nothing usable")
  })
})

describe("competition snapshot panel research rendering", () => {
  const base = { id: "n1", title: "Snapshot", body: "## Positioning\n\nGrounded analysis.", createdAt: 1700000000000, creditsCharged: 5 }

  const research = {
    queries: ["cake ordering apps competitors", "cake market size valuation 2026"],
    collectedAt: 1700000000000,
    researchCreditsCharged: 15,
    sources: [
      { kind: "web" as const, title: "Acme rival", url: "https://acme.com", domain: "acme.com", snippet: "Rival bakery app", queryIndex: 0 },
      { kind: "news" as const, title: "Acme raises", url: "https://news.example.com/a", domain: "news.example.com", date: "2026-10-02", snippet: "Funding round", queryIndex: 1 },
      { kind: "data_tool" as const, title: "Funding data provider", provider: "Provider", snippet: "Company funding datasets" },
    ],
  }

  it("renders the live-sources section with groups, safe external links, queries and the honesty stamp", () => {
    const html = renderToStaticMarkup(
      <CompetitionSnapshotPanel projectId="p1" snapshot={{ ...base, research }} creditsAvailable={100} textReady researchReady hasPlan />,
    )
    expect(html).toContain("Live research 2023-11-14 · 3 sources · 15 credits")
    expect(html).toContain("Live sources (3)")
    expect(html).toContain("Web pages (1)")
    expect(html).toContain("News (1)")
    expect(html).toContain("Data tools &amp; providers (1)")
    expect(html).toContain("cake market size valuation 2026")
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain("verify anything you intend to rely on")
    expect(html).not.toContain('href="javascript:')
  })

  it("keeps the plan-only label for pre-research drafts and blocks the button honestly", () => {
    const legacy = renderToStaticMarkup(
      <CompetitionSnapshotPanel projectId="p1" snapshot={base} creditsAvailable={100} textReady researchReady hasPlan />,
    )
    expect(legacy).toContain("from your plan, not market data")
    expect(legacy).not.toContain("Live sources")

    const blocked = renderToStaticMarkup(
      <CompetitionSnapshotPanel projectId="p1" snapshot={null} creditsAvailable={100} textReady researchReady={false} hasPlan />,
    )
    expect(blocked).toContain("Live web research isn&#x27;t configured on this deployment yet.")
    expect(blocked).not.toContain("Run live competitor research\n")
    expect(blocked).toContain("disabled")
  })
})
