import { describe, expect, it } from "vitest"

import {
  articleMetadata,
  authorPersonJsonLd,
  blogJsonLd,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  categoryMetadata,
  faqJsonLd,
  jsonLdScript,
} from "@/lib/blog/seo"

const BASE = "https://atai.ink"

const article = {
  slug: "validate-a-business-idea",
  title: "How to validate a business idea",
  description: "A practical guide to validating a business idea before you build the product.",
  excerpt: "Validate before you build.",
  publishedAt: "2026-01-15",
  updatedAt: "2026-02-01",
  tags: ["validation", "founders"],
  author: { name: "Atai Team", url: "/blog/author/atai-team" },
  featuredImage: { url: "https://atai.ink/hero.png", alt: "A founder reviewing a plan" },
}

describe("articleMetadata", () => {
  it("builds a canonical URL that matches the public path", () => {
    const meta = articleMetadata(article, BASE)
    expect(meta.alternates.canonical).toBe("/blog/validate-a-business-idea")
    expect(meta.openGraph.url).toBe(`${BASE}/blog/validate-a-business-idea`)
  })

  it("uses the article description when no SEO description is set", () => {
    expect(articleMetadata(article, BASE).description).toBe(article.description)
  })

  it("prefers the SEO overrides", () => {
    const meta = articleMetadata(
      { ...article, seo: { title: "Custom SEO title", description: "Custom meta description.", canonical: "https://atai.ink/other" } },
      BASE,
    )
    expect(meta.title).toBe("Custom SEO title")
    expect(meta.description).toBe("Custom meta description.")
    expect(meta.alternates.canonical).toBe("https://atai.ink/other")
  })

  it("marks a noindex article as not indexable but still followable", () => {
    const meta = articleMetadata({ ...article, seo: { noindex: true } }, BASE)
    expect(meta.robots).toEqual({ index: false, follow: true })
  })

  it("indexes an ordinary article", () => {
    expect(articleMetadata(article, BASE).robots).toEqual({ index: true, follow: true })
  })

  it("emits a Twitter card with the featured image", () => {
    const meta = articleMetadata(article, BASE)
    expect(meta.twitter.card).toBe("summary_large_image")
    expect(meta.twitter.images).toEqual(["https://atai.ink/hero.png"])
  })

  it("carries the publication and modification dates into Open Graph", () => {
    const meta = articleMetadata(article, BASE)
    expect(meta.openGraph.publishedTime).toBe("2026-01-15")
    expect(meta.openGraph.modifiedTime).toBe("2026-02-01")
  })
})

describe("structured data", () => {
  it("describes the article as a BlogPosting that matches the visible page", () => {
    const jsonLd = blogPostingJsonLd(article, BASE)
    expect(jsonLd["@type"]).toBe("BlogPosting")
    expect(jsonLd.headline).toBe(article.title)
    expect(jsonLd.datePublished).toBe("2026-01-15")
    expect(jsonLd.dateModified).toBe("2026-02-01")
    expect(jsonLd.image).toEqual(["https://atai.ink/hero.png"])
    expect(jsonLd.author["@type"]).toBe("Person")
    expect(jsonLd.publisher["@type"]).toBe("Organization")
  })

  it("emits a FAQPage only when the body actually has FAQ entries", () => {
    expect(faqJsonLd("## No questions here")).toBeNull()
    const jsonLd = faqJsonLd("## Frequently asked questions\n\n**Is it free?**\n\nYes, there is a free tier.")
    expect(jsonLd?.["@type"]).toBe("FAQPage")
    expect(jsonLd?.mainEntity).toHaveLength(1)
    expect(jsonLd?.mainEntity[0].name).toBe("Is it free?")
  })

  it("numbers breadcrumb items from one", () => {
    const jsonLd = breadcrumbJsonLd([
      { name: "Home", url: BASE },
      { name: "Blog", url: `${BASE}/blog` },
    ])
    expect(jsonLd.itemListElement.map((item) => item.position)).toEqual([1, 2])
  })

  it("describes the blog consistently with the site", () => {
    expect(blogJsonLd(BASE)["@type"]).toBe("Blog")
    expect(blogJsonLd(BASE).url).toBe(`${BASE}/blog`)
  })

  it("describes an author as a person who works for the organisation", () => {
    const jsonLd = authorPersonJsonLd({ name: "Atai Team", role: "Editorial" }, BASE)
    expect(jsonLd["@type"]).toBe("Person")
    expect(jsonLd.jobTitle).toBe("Editorial")
    expect(jsonLd.worksFor["@type"]).toBe("Organization")
  })

  it("never invents ratings or reviews", () => {
    const serialized = JSON.stringify(blogPostingJsonLd(article, BASE))
    expect(serialized).not.toContain("ratingValue")
    expect(serialized).not.toContain("reviewRating")
    expect(serialized).not.toContain("aggregateRating")
  })
})

describe("jsonLdScript", () => {
  it("cannot be closed by a title that contains a script tag", () => {
    const script = jsonLdScript({ headline: "</script><script>alert(1)</script>" })
    expect(script).not.toContain("</script>")
    expect(script).toContain("\\u003c")
  })

  it("still produces valid JSON", () => {
    const data = { headline: "A title", tags: ["one", "two"] }
    expect(JSON.parse(jsonLdScript(data))).toEqual(data)
  })
})

describe("categoryMetadata", () => {
  const category = {
    id: "c1",
    slug: "comparisons",
    name: "Comparisons & Alternatives",
    description: "Atai compared with other platforms.",
    order: 2,
    createdAtMs: 0,
    updatedAtMs: 0,
  }

  it("uses the category SEO overrides when present", () => {
    const meta = categoryMetadata({ ...category, seoTitle: "Custom title", seoDescription: "Custom description." }, BASE)
    expect(meta.title).toBe("Custom title")
    expect(meta.description).toBe("Custom description.")
  })

  it("falls back to the category name and description", () => {
    const meta = categoryMetadata(category, BASE)
    expect(meta.title).toBe("Comparisons & Alternatives | Atai Blog")
    expect(meta.description).toBe("Atai compared with other platforms.")
    expect(meta.alternates.canonical).toBe("/blog/category/comparisons")
  })
})
