import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { ArticleCard } from "@/components/blog/article-card"
import { ArticleBody } from "@/components/blog/article-body"
import { ComparisonTable } from "@/components/blog/comparison-table"
import { FaqSection } from "@/components/blog/faq-section"
import { BlogPagination } from "@/components/blog/pagination"
import type { BlogArticleDoc } from "@/lib/blog/types"

function article(overrides: Partial<BlogArticleDoc> = {}): BlogArticleDoc {
  return {
    id: "a1",
    slug: "validate-a-business-idea",
    title: "How to validate a business idea",
    description: "A practical guide to validating a business idea before you build the product.",
    excerpt: "Validate before you build.",
    body: "## Why validation matters\n\nMost ideas fail.",
    category: "business-building",
    tags: ["validation"],
    author: { name: "Atai Team" },
    seo: {},
    status: "published",
    featured: false,
    relatedSlugs: [],
    publishedAt: "2026-01-15",
    updatedAt: "2026-01-15",
    readingMinutes: 4,
    views: 12,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdBy: "admin",
    updatedBy: "admin",
    ...overrides,
  }
}

describe("ArticleCard", () => {
  it("renders the headline as a link to the public article", () => {
    const html = renderToStaticMarkup(<ArticleCard article={article()} />)
    expect(html).toContain('href="/blog/validate-a-business-idea"')
    expect(html).toContain("How to validate a business idea")
  })

  it("links to the category landing page", () => {
    const html = renderToStaticMarkup(<ArticleCard article={article()} />)
    expect(html).toContain('href="/blog/category/business-building"')
  })

  it("shows the reading time and the publication date", () => {
    const html = renderToStaticMarkup(<ArticleCard article={article()} />)
    expect(html).toContain("4 min read")
    // React 19 emits the attribute as `dateTime`; HTML attribute names are
    // case-insensitive so browsers and crawlers still read it as `datetime`.
    expect(html).toMatch(/date[Tt]ime="2026-01-15"/)
  })

  it("renders the featured image with its alt text", () => {
    const html = renderToStaticMarkup(
      <ArticleCard article={article({ featuredImage: { url: "https://atai.ink/a.png", alt: "A founder planning" } })} />,
    )
    expect(html).toContain('src="https://atai.ink/a.png"')
    expect(html).toContain('alt="A founder planning"')
  })

  it("falls back to the description when there is no excerpt", () => {
    const html = renderToStaticMarkup(<ArticleCard article={article({ excerpt: "" })} />)
    expect(html).toContain("A practical guide to validating a business idea")
  })
})

describe("ArticleBody", () => {
  it("puts the article prose into the rendered HTML so crawlers can read it", () => {
    const html = renderToStaticMarkup(
      <ArticleBody markdown={"## Why validation matters\n\nMost ideas fail because nobody wanted them."} />,
    )
    expect(html).toContain("<h2")
    expect(html).toContain("Why validation matters")
    expect(html).toContain("Most ideas fail because nobody wanted them.")
  })

  it("renders a GFM table", () => {
    const html = renderToStaticMarkup(<ArticleBody markdown={"| A | B |\n| - | - |\n| 1 | 2 |"} />)
    expect(html).toContain("<table")
    expect(html).toContain("<td")
  })

  it("does not emit raw script markup into the page", () => {
    const html = renderToStaticMarkup(
      <ArticleBody markdown={"## Safe\n\n<script>alert('xss')</script>"} />,
    )
    expect(html).not.toContain("<script>alert")
  })

  it("renders a FAQ section once, outside the body", () => {
    const markdown = [
      "## Why validation matters",
      "",
      "Most ideas fail.",
      "",
      "## Frequently asked questions",
      "",
      "**Is Atai a code generator?**",
      "",
      "No. Atai runs the business lifecycle.",
    ].join("\n")
    const html = renderToStaticMarkup(<ArticleBody markdown={markdown} />)

    expect(html).toContain("Is Atai a code generator?")
    expect(html).toContain("No. Atai runs the business lifecycle.")
    expect(html.match(/Frequently asked questions/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })
})

describe("ComparisonTable", () => {
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
    lastReviewed: "2026-01-20",
    limitations: "Feature availability changes; verify before deciding.",
  }

  it("renders each evaluated dimension", () => {
    const html = renderToStaticMarkup(<ComparisonTable comparison={comparison} />)
    expect(html).toContain("Primary purpose")
    expect(html).toContain("Runs the business lifecycle.")
    expect(html).toContain("Generates app front-ends.")
  })

  it("shows the source and the date the claim was checked", () => {
    const html = renderToStaticMarkup(<ComparisonTable comparison={comparison} />)
    expect(html).toContain('href="https://lovable.dev"')
    expect(html).toContain("checked 2026-01-15")
  })

  it("shows the limitations and the overall review date", () => {
    const html = renderToStaticMarkup(<ComparisonTable comparison={comparison} />)
    expect(html).toContain("verify before deciding")
    expect(html).toContain("Comparison last reviewed 2026-01-20")
  })

  it("renders nothing when there are no rows", () => {
    const html = renderToStaticMarkup(<ComparisonTable comparison={{ ...comparison, rows: [] }} />)
    expect(html).toBe("")
  })
})

describe("FaqSection", () => {
  it("renders each question and answer", () => {
    const html = renderToStaticMarkup(
      <FaqSection faqs={[{ q: "Is Atai a code generator?", a: "No." }]} />,
    )
    expect(html).toContain("Is Atai a code generator?")
    expect(html).toContain("No.")
    expect(html).toContain("<details")
  })

  it("renders nothing when there are no questions", () => {
    expect(renderToStaticMarkup(<FaqSection faqs={[]} />)).toBe("")
  })
})

describe("BlogPagination", () => {
  it("renders nothing when there is only one page", () => {
    expect(renderToStaticMarkup(<BlogPagination page={1} totalPages={1} basePath="/blog" />)).toBe("")
  })

  it("links to the next and previous pages", () => {
    const html = renderToStaticMarkup(<BlogPagination page={2} totalPages={3} basePath="/blog" />)
    expect(html).toContain('href="/blog?page=3"')
    // Page one is the canonical first page, so the query is dropped rather
    // than rendered as /blog?page=1.
    expect(html).toContain('href="/blog"')
    expect(html).toContain('aria-current="page"')
  })

  it("keeps the active filters in every link", () => {
    const html = renderToStaticMarkup(
      <BlogPagination page={2} totalPages={3} basePath="/blog" searchParams={{ q: "atai" }} />,
    )
    expect(html).toContain("q=atai")
    expect(html).toContain("page=3")
  })

  it("uses the category base path on a category page", () => {
    const html = renderToStaticMarkup(
      <BlogPagination page={1} totalPages={2} basePath="/blog/category/comparisons" />,
    )
    expect(html).toContain('href="/blog/category/comparisons?page=2"')
  })

  it("omits the page parameter on the first page", () => {
    const html = renderToStaticMarkup(
      <BlogPagination page={1} totalPages={3} basePath="/blog" searchParams={{ q: "atai" }} />,
    )
    expect(html).toContain('href="/blog?q=atai"')
  })
})
