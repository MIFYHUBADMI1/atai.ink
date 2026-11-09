import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { auditWebsiteEvidence, deriveRecommendations } from "./auditor"
import type { WebsiteEvidence } from "@/lib/integrations/firecrawl/types"

/**
 * Deterministic SEO auditor tests (Phase 3 — W2). The auditor is pure: same
 * evidence must always yield the same findings (reproducibility), and every
 * signal the crawler does NOT capture must be `not_observed` — never guessed,
 * never shown as a failure. No ranking/traffic claims exist as findings.
 */

function evidenceFixture(overrides: Partial<WebsiteEvidence> = {}, pageOverrides: Partial<WebsiteEvidence["pages"][number]> = {}): WebsiteEvidence {
  return {
    sourceUrl: "https://acme.example.com",
    title: "Acme — build faster",
    description: "Acme helps teams ship internal tools without writing boilerplate.",
    pages: [
      {
        url: "https://acme.example.com",
        title: "Acme — build faster",
        description: "Acme helps teams ship internal tools without writing boilerplate.",
        headings: ["Build faster", "Pricing"],
        links: ["https://acme.example.com/pricing", "https://acme.example.com/docs"],
        images: ["https://acme.example.com/hero.png"],
        markdown: "Welcome to Acme. We help teams ship internal tools.",
        ...pageOverrides,
      },
    ],
    navigation: [],
    assets: [],
    screenshots: [],
    metadata: {},
    usage: { pagesCrawled: 1, creditsEstimated: 1, cached: false },
    collectedAt: 1,
    ...overrides,
  }
}

function find(findings: ReturnType<typeof auditWebsiteEvidence>["findings"], id: string) {
  return findings.find((f) => f.id === id)
}

describe("auditWebsiteEvidence", () => {
  it("passes on-page fundamentals when evidence shows them", () => {
    const { findings } = auditWebsiteEvidence(evidenceFixture())
    expect(find(findings, "https")!.status).toBe("pass")
    expect(find(findings, "title")!.status).toBe("pass")
    expect(find(findings, "meta_description")!.status).toBe("pass")
    expect(find(findings, "headings")!.status).toBe("pass")
    expect(find(findings, "internal_links")!.status).toBe("pass")
    expect(find(findings, "indexable_content")!.status).toBe("pass")
  })

  it("fails when title/description/content are absent, with honest notes", () => {
    const e = evidenceFixture({ title: "", description: "" }, { title: "", description: "", markdown: "   ", headings: [], links: [], images: [] })
    const { findings } = auditWebsiteEvidence(e)
    expect(find(findings, "title")!.status).toBe("fail")
    expect(find(findings, "meta_description")!.status).toBe("fail")
    expect(find(findings, "indexable_content")!.status).toBe("fail")
    // Headings/links with no evidence are NOT observed, not failures.
    expect(find(findings, "headings")!.status).toBe("not_observed")
    expect(find(findings, "internal_links")!.status).toBe("not_observed")
  })

  it("flags an over-long title as a failure", () => {
    const long = "x".repeat(80)
    const e = evidenceFixture({ title: long }, { title: long })
    expect(find(auditWebsiteEvidence(e).findings, "title")!.status).toBe("fail")
  })

  it("marks http (non-https) as a failure", () => {
    const e = evidenceFixture({ sourceUrl: "http://acme.example.com" })
    expect(find(auditWebsiteEvidence(e).findings, "https")!.status).toBe("fail")
  })

  it("NEVER claims rankings, traffic or conversions, and keeps uncapturable signals not_observed", () => {
    const { findings, score } = auditWebsiteEvidence(evidenceFixture())
    // Canonical + robots/sitemap are never observed from markdown-only evidence.
    expect(find(findings, "canonical")!.status).toBe("not_observed")
    expect(find(findings, "robots")!.status).toBe("not_observed")
    expect(score.notObserved).toBeGreaterThanOrEqual(2)
    // No finding references a ranking/traffic number.
    const serialized = JSON.stringify(findings).toLowerCase()
    expect(serialized).not.toMatch(/rank|traffic|page ?one|visitors/)
  })

  it("is reproducible — identical evidence yields identical findings", () => {
    const a = auditWebsiteEvidence(evidenceFixture())
    const b = auditWebsiteEvidence(evidenceFixture())
    expect(a).toEqual(b)
  })

  it("labels every finding with a severity and a category", () => {
    const { findings } = auditWebsiteEvidence(evidenceFixture())
    for (const f of findings) {
      expect(f.severity, f.id).toBeDefined()
      expect(f.category, f.id).toBeDefined()
    }
  })

  it("scores 100 when every observed check passes, and excludes not_observed checks", () => {
    const { auditScore, score } = auditWebsiteEvidence(evidenceFixture())
    expect(auditScore.value).toBe(100)
    // Canonical + robots are never observed, so they are excluded, not failed.
    expect(auditScore.notApplicable).toBeGreaterThanOrEqual(2)
    expect(auditScore.notApplicable).toBe(score.notObserved)
    expect(auditScore.failedWeight).toBe(0)
  })

  it("inspects every crawled page, not just the entry page", () => {
    const e = evidenceFixture()
    e.pages = [
      { ...e.pages[0], url: "https://acme.example.com", title: "Acme home", description: "Home description" },
      {
        url: "https://acme.example.com/pricing",
        title: "",
        description: "Pricing description",
        headings: ["Pricing"],
        links: ["https://acme.example.com"],
        images: [],
        markdown: "Pricing details",
      },
    ]
    e.usage = { pagesCrawled: 2, creditsEstimated: 1, cached: false }

    const { findings } = auditWebsiteEvidence(e)
    const title = find(findings, "title")!
    expect(title.status).toBe("fail")
    expect(title.affectedUrls).toContain("https://acme.example.com/pricing")
    // The second page does have a description, so that check still passes.
    expect(find(findings, "meta_description")!.status).toBe("pass")
  })

  it("flags titles repeated across pages, with the offending URLs", () => {
    const e = evidenceFixture()
    const shared = "Acme — build faster"
    e.pages = [
      { ...e.pages[0], url: "https://acme.example.com", title: shared },
      { ...e.pages[0], url: "https://acme.example.com/pricing", title: shared },
    ]
    e.usage = { pagesCrawled: 2, creditsEstimated: 1, cached: false }

    const { findings } = auditWebsiteEvidence(e)
    const dup = find(findings, "duplicate_titles")!
    expect(dup.status).toBe("fail")
    expect(dup.severity).toBe("medium")
    expect(dup.affectedUrls).toEqual(
      expect.arrayContaining(["https://acme.example.com", "https://acme.example.com/pricing"]),
    )
  })

  it("flags meta descriptions repeated across pages", () => {
    const e = evidenceFixture()
    const shared = "Acme helps teams ship internal tools without writing boilerplate."
    e.pages = [
      { ...e.pages[0], url: "https://acme.example.com", description: shared },
      { ...e.pages[0], url: "https://acme.example.com/pricing", description: shared },
    ]
    e.usage = { pagesCrawled: 2, creditsEstimated: 1, cached: false }

    expect(find(auditWebsiteEvidence(e).findings, "duplicate_descriptions")!.status).toBe("fail")
  })

  it("reports repeats as not_observed when only one page was inspected", () => {
    const { findings } = auditWebsiteEvidence(evidenceFixture())
    expect(find(findings, "duplicate_titles")!.status).toBe("not_observed")
    expect(find(findings, "duplicate_descriptions")!.status).toBe("not_observed")
  })

  it("passes duplicate checks when pages are genuinely unique", () => {
    const e = evidenceFixture()
    e.pages = [
      { ...e.pages[0], url: "https://acme.example.com", title: "Acme home", description: "Home description" },
      { ...e.pages[0], url: "https://acme.example.com/pricing", title: "Pricing", description: "Pricing description" },
    ]
    e.usage = { pagesCrawled: 2, creditsEstimated: 1, cached: false }

    const { findings } = auditWebsiteEvidence(e)
    expect(find(findings, "duplicate_titles")!.status).toBe("pass")
    expect(find(findings, "duplicate_descriptions")!.status).toBe("pass")
  })

  it("fails content only for pages that actually exposed no readable text", () => {
    const e = evidenceFixture()
    e.pages = [
      { ...e.pages[0], url: "https://acme.example.com", markdown: "Readable content" },
      { ...e.pages[0], url: "https://acme.example.com/empty", markdown: "   " },
    ]
    e.usage = { pagesCrawled: 2, creditsEstimated: 1, cached: false }

    const content = find(auditWebsiteEvidence(e).findings, "indexable_content")!
    expect(content.status).toBe("fail")
    expect(content.observed).toContain("1 of 2 pages")
    expect(content.affectedUrls).toContain("https://acme.example.com/empty")
  })

  it("lowers the score only for observed failures, and never to a fabricated value", () => {
    const e = evidenceFixture({ title: "", description: "" }, { title: "", description: "", markdown: "   ", headings: [], links: [], images: [] })
    const { auditScore } = auditWebsiteEvidence(e)
    expect(auditScore.failedWeight).toBeGreaterThan(0)
    expect(auditScore.value).not.toBeNull()
    expect(auditScore.value!).toBeGreaterThan(0)
    expect(auditScore.value!).toBeLessThan(100)
  })
})

describe("deriveRecommendations", () => {
  it("produces guidance only from failing checks, labeled observed-derived", () => {
    const e = evidenceFixture({ description: "" }, { description: "" })
    const { findings } = auditWebsiteEvidence(e)
    const recs = deriveRecommendations(findings)
    const ids = recs.map((r) => r.findingId)
    expect(ids).toContain("meta_description")
    // A not_observed check (canonical) must never generate a recommendation.
    expect(ids).not.toContain("canonical")
    expect(recs.every((r) => r.basis === "observed_failures")).toBe(true)
  })

  it("returns nothing when there are no failures", () => {
    const { findings } = auditWebsiteEvidence(evidenceFixture())
    const clean = findings.filter((f) => f.status !== "fail")
    expect(deriveRecommendations(clean)).toHaveLength(0)
  })
})
