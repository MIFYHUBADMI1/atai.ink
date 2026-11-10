import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
vi.mock("@/lib/client/api", () => ({ postJson: vi.fn() }))
import { CompetitionSnapshotPanel } from "@/components/marketing/competition-snapshot-panel"
import { CompetitorIntelligenceList } from "@/components/project-resources/competitor-intelligence-list"
import { CompetitorsSection } from "@/components/project-resources/competitors-section"
import { readResourcesCompetitors } from "@/lib/resources/competitor-schema"
import type { ApplicationSpecification } from "@/lib/types/specification"

const snapshot = { id: "new", title: "Snapshot", body: '##Positioning\n\n- **Bookkeepers**\n\n[Bad](javascript:alert(1))\n\n<script>alert(1)</script>', createdAt: 1700000000000, creditsCharged: 2 }

describe("Competition and Resources rendering", () => {
  it("renders safe Markdown and accessible historical drafts, not raw headings or active HTML", () => {
    const html = renderToStaticMarkup(<CompetitionSnapshotPanel projectId="p1" snapshot={snapshot} history={[{ ...snapshot, id: "old", body: "## Earlier draft\n\nHistorical plan." }]} creditsAvailable={100} textReady hasPlan />)
    expect(html).toContain("<h2")
    expect(html).toContain("<ul")
    expect(html).toContain("<strong")
    expect(html).toContain("Historical plan.")
    expect(html).toContain("AI-generated, not current research")
    expect(html).toContain("freshness is unknown")
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("##Positioning")
  })
  it("does not flag matching context as stale", () => {
    const html = renderToStaticMarkup(<CompetitionSnapshotPanel projectId="p1" snapshot={{ ...snapshot, contextHash: "current" }} currentContextHash="current" creditsAvailable={0} textReady hasPlan />)
    expect(html).not.toContain("planning context has changed")
    expect(html).not.toContain("freshness is unknown")
  })
  it("shows Resources provenance and a direct research-gap handoff independently of snapshots", () => {
    const intelligence = readResourcesCompetitors({ competitors: { data: [{ name: "Acme", pricing: "Unknown" }], generatedAt: 1700000000000 } })
    const html = renderToStaticMarkup(<CompetitorIntelligenceList projectId="p1" intelligence={intelligence} />)
    expect(html).toContain("Source: Resources")
    expect(html).toContain("needs verification")
    expect(html).toContain("2023-11-14")
    expect(html).toContain("resources?section=competitors")
    expect(html).toContain("Unknown")
    expect(renderToStaticMarkup(<CompetitorIntelligenceList projectId="p1" intelligence={readResourcesCompetitors(null)} />)).toContain("No usable competitor suggestions")
    expect(renderToStaticMarkup(<CompetitorIntelligenceList projectId="p1" intelligence={null} />)).toContain("could not be loaded")
  })
  it("keeps Resources independent and safely renders legacy cache without duplicate keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const html = renderToStaticMarkup(<CompetitorsSection projectId="p1" spec={{} as ApplicationSpecification} credits={100} onCreditsChanged={() => {}} cachedCompetitors={{ generatedAt: 1700000000000, data: [{ name: "Acme", url: "javascript:alert(1)" }, { name: "Acme" }] }} />)
      expect(html).toContain("Competitive intelligence")
      expect(html).toContain("needs verification")
      expect(html).not.toContain('href="javascript:')
      expect(html.match(/<p class="font-semibold text-foreground">Acme/g)).toHaveLength(1)
      expect(error).not.toHaveBeenCalled()
    } finally { error.mockRestore() }
  })
})
