import { describe, expect, it } from "vitest"

import { auditArticle } from "@/lib/blog/audit"
import type { BlogArticleDoc } from "@/lib/blog/types"

type AuditInput = Parameters<typeof auditArticle>[0]

function article(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    id: "a1",
    slug: "validate-a-business-idea",
    title: "How to validate a business idea",
    description: "A practical guide to validating a business idea before you build the product.",
    excerpt: "Validate before you build.",
    body: [
      "## Why validation matters",
      "",
      "Most ideas fail because nobody wanted them. Talk to people first.",
      "",
      "## A simple checklist",
      "",
      "- Talk to ten people",
      "- Price it",
      "- Sell a pilot",
      "",
      "See the [onboarding guide](/docs/onboarding) to get started.",
    ].join("\n"),
    author: { name: "Atai Team", role: "Editorial" },
    featuredImage: { url: "https://atai.ink/hero.png", alt: "A founder reviewing a plan" },
    seo: {},
    publishedAt: "2026-01-15",
    tags: ["validation"],
    ...overrides,
  }
}

function codes(input: AuditInput, context?: Parameters<typeof auditArticle>[1]): string[] {
  return auditArticle(input, context).findings.map((finding) => finding.code)
}

describe("content quality audit", () => {
  it("flags a missing title and a missing author as errors", () => {
    const found = codes(article({ title: "", author: { name: "" } }))
    expect(found).toContain("missing-title")
    expect(found).toContain("missing-author")
  })

  it("flags a thin article", () => {
    expect(codes(article({ body: "Too short to be useful." }))).toContain("thin-content")
  })

  it("flags a missing excerpt and a missing featured image", () => {
    const found = codes(article({ excerpt: "", featuredImage: undefined }))
    expect(found).toContain("missing-excerpt")
    expect(found).toContain("missing-featured-image")
  })

  it("flags a featured image with no alt text", () => {
    const found = codes(article({ featuredImage: { url: "https://atai.ink/hero.png", alt: "" } }))
    expect(found).toContain("missing-image-alt")
  })

  it("flags an article with no internal links", () => {
    const body = "## Section\n\nNo links at all in this article body."
    expect(codes(article({ body }))).toContain("no-internal-links")
  })

  it("flags a duplicate title against another article", () => {
    const found = codes(article(), {
      others: [{ slug: "other-post", title: "How to validate a business idea", description: "Different." }],
    })
    expect(found).toContain("duplicate-title")
  })

  it("flags duplicate metadata against another article", () => {
    const found = codes(article(), {
      others: [
        {
          slug: "other-post",
          title: "A different title",
          description: "A practical guide to validating a business idea before you build the product.",
        },
      ],
    })
    expect(found).toContain("duplicate-meta")
  })

  it("does not flag an article against itself", () => {
    const found = codes(article(), {
      others: [
        {
          slug: "validate-a-business-idea",
          title: "How to validate a business idea",
          description: "A practical guide to validating a business idea before you build the product.",
        },
      ],
    })
    expect(found).not.toContain("duplicate-title")
  })
})

describe("comparison verification audit", () => {
  const comparison = {
    competitorName: "Lovable",
    competitorUrl: "https://lovable.dev",
    rows: [
      {
        dimension: "Primary purpose",
        atai: "Runs the business lifecycle.",
        competitor: "Generates app front-ends.",
        evidence: "https://lovable.dev",
        lastChecked: "2026-01-15",
      },
    ],
    lastReviewed: "2026-01-15",
  }

  it("flags a competitor claim that has no evidence", () => {
    const found = codes(
      article({
        competitor: "Lovable",
        comparison: { ...comparison, rows: [{ ...comparison.rows[0], evidence: undefined }] },
      }),
    )
    expect(found).toContain("unsupported-claims")
  })

  it("flags a claim that was verified more than 90 days ago", () => {
    const found = codes(
      article({
        competitor: "Lovable",
        comparison: { ...comparison, rows: [{ ...comparison.rows[0], lastChecked: "2020-01-01" }] },
      }),
      { nowMs: Date.parse("2026-03-01") },
    )
    expect(found).toContain("stale-claims")
  })

  it("flags a claim with no verification date", () => {
    const found = codes(
      article({
        competitor: "Lovable",
        comparison: { ...comparison, rows: [{ ...comparison.rows[0], lastChecked: undefined }] },
      }),
    )
    expect(found).toContain("undated-claims")
  })

  it("flags a comparison that has no table at all", () => {
    expect(codes(article({ competitor: "Lovable" }))).toContain("comparison-empty")
  })

  it("suggests an FAQ for a comparison article", () => {
    const found = codes(article({ competitor: "Lovable", comparison }))
    expect(found).toContain("comparison-no-faq")
  })

  it("accepts a fully evidenced comparison", () => {
    const found = codes(article({ competitor: "Lovable", comparison }), { nowMs: Date.parse("2026-01-20") })
    expect(found).not.toContain("unsupported-claims")
    expect(found).not.toContain("stale-claims")
    expect(found).not.toContain("undated-claims")
  })
})

describe("SEO quality audit", () => {
  it("flags a missing meta description", () => {
    expect(codes(article({ description: "", seo: {} }))).toContain("missing-meta-description")
  })

  it("flags a meta description that is too short or too long", () => {
    expect(codes(article({ seo: { description: "Too short." } }))).toContain("short-meta-description")
    expect(codes(article({ seo: { description: "x".repeat(200) } }))).toContain("long-meta-description")
  })

  it("flags an H1 in the body because the page already renders one", () => {
    expect(codes(article({ body: "# Title\n\n## Section" }))).toContain("duplicate-h1")
  })

  it("flags a long article with no headings", () => {
    const body = "word ".repeat(500)
    expect(codes(article({ body }))).toContain("no-headings")
  })

  it("flags a skipped heading level", () => {
    expect(codes(article({ body: "## Two\n\n#### Four" }))).toContain("heading-hierarchy")
  })

  it("flags a body image with empty alt text", () => {
    expect(codes(article({ body: "## Section\n\n![](https://atai.ink/a.png)" }))).toContain("body-image-alt")
  })

  it("reports a noindex article as informational", () => {
    const found = codes(article({ seo: { noindex: true } }))
    expect(found).toContain("noindex")
  })

  it("flags a missing publication date and an article with no tags", () => {
    const found = codes(article({ publishedAt: "", tags: [] }))
    expect(found).toContain("missing-date")
    expect(found).toContain("no-tags")
  })
})

describe("audit report", () => {
  it("counts the words and produces a score", () => {
    const report = auditArticle(article())
    expect(report.wordCount).toBeGreaterThan(0)
    expect(report.score).toBeGreaterThan(0)
    expect(report.score).toBeLessThanOrEqual(100)
  })

  it("scores a well-prepared article higher than an empty one", () => {
    const good = auditArticle(article())
    const bad = auditArticle(article({ title: "", excerpt: "", body: "", author: { name: "" }, tags: [] }))
    expect(good.score).toBeGreaterThan(bad.score)
  })

  it("gives every finding a severity, an explanation and a suggested fix", () => {
    const report = auditArticle(article({ title: "", author: { name: "" } }))
    expect(report.findings.length).toBeGreaterThan(0)
    for (const finding of report.findings) {
      expect(["error", "warning", "info"]).toContain(finding.severity)
      expect(finding.message.length).toBeGreaterThan(0)
      expect(finding.fix.length).toBeGreaterThan(0)
    }
  })
})
