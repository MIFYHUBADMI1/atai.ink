import { describe, expect, it } from "vitest"
import type { WebsiteEvidence } from "@/lib/integrations/firecrawl/types"
import {
  READING_EXCERPT_CHARS,
  READING_PAGE_LIMIT,
  buildReadingSnapshot,
  buildWebsiteDigest,
  toReadableText,
  type WebsiteFacts,
} from "./website-facts"

function facts(overrides: Partial<WebsiteFacts> = {}): WebsiteFacts {
  return {
    submittedUrl: "bakery.example",
    normalizedUrl: "https://bakery.example",
    hostname: "bakery.example",
    pages: [{ url: "https://bakery.example", title: "Corner Bakery", headings: ["Bread", "Hours"] }],
    navigation: [],
    socialLinks: [],
    contactHints: [],
    seoFindings: [],
    pagesCrawled: 1,
    fromCache: false,
    ...overrides,
  }
}

function evidence(markdown: string, url = "https://bakery.example"): WebsiteEvidence {
  return {
    sourceUrl: "https://bakery.example",
    pages: [{ url, headings: ["Bread"], links: [], images: [], markdown }],
    navigation: [],
    assets: [],
    screenshots: [],
    metadata: {},
    usage: { pagesCrawled: 1, creditsEstimated: 1, cached: false },
    collectedAt: 1,
  }
}

describe("toReadableText", () => {
  it("turns crawl markdown into the prose a person would have read", () => {
    const markdown =
      "# Our breads\n\n[Order now](https://bakery.example/order) ![loaf](https://cdn.example/loaf.png)\n\nWe bake **daily** — see https://bakery.example/about"
    expect(toReadableText(markdown)).toBe("Our breads Order now We bake **daily** — see")
  })

  it("leaves plain prose untouched", () => {
    expect(toReadableText("Bread\n\n  baked\t\tdaily.")).toBe("Bread baked daily.")
  })
})

describe("buildReadingSnapshot", () => {
  it("keeps exactly the evidence block the co-founder is given", () => {
    const snapshot = buildReadingSnapshot(facts(), evidence("Bread, baked daily."))
    expect(snapshot.digest).toBe(buildWebsiteDigest(facts()))
  })

  it("keeps the opening of the page and the true length behind it", () => {
    const text = "word ".repeat(500)
    const snapshot = buildReadingSnapshot(facts(), evidence(text))
    const page = snapshot.pages[0]
    expect(page.excerpt.length).toBe(READING_EXCERPT_CHARS)
    expect(page.chars).toBe(text.replace(/\s+/g, " ").trim().length)
    expect(snapshot.charsRead).toBe(page.chars)
  })

  it("collapses whitespace so an excerpt reads like prose, not crawl output", () => {
    const snapshot = buildReadingSnapshot(facts(), evidence("Bread\n\n  baked\t\tdaily."))
    expect(snapshot.pages[0].excerpt).toBe("Bread baked daily.")
  })

  it("cleans crawl markdown out of the excerpt", () => {
    const snapshot = buildReadingSnapshot(facts(), evidence("[Home](https://bakery.example/) Bread, baked daily."))
    expect(snapshot.pages[0].excerpt).toBe("Home Bread, baked daily.")
  })

  it("carries the served address and the redirect into the snapshot", () => {
    const snapshot = buildReadingSnapshot(
      facts({ redirectedFrom: "https://bakery-preview.vercel.app" }),
      undefined,
    )
    expect(snapshot.finalUrl).toBe("https://bakery.example")
    expect(snapshot.redirectedFrom).toBe("https://bakery-preview.vercel.app")
  })

  it("stays bounded when a site returns more pages than we keep", () => {
    const many = Array.from({ length: READING_PAGE_LIMIT + 4 }, (_, index) => ({
      url: `https://bakery.example/p${index}`,
      headings: [],
    }))
    const snapshot = buildReadingSnapshot(facts({ pages: many, pagesCrawled: many.length }), undefined)
    expect(snapshot.pages).toHaveLength(READING_PAGE_LIMIT)
    expect(snapshot.pages.every((page) => page.excerpt === "")).toBe(true)
    // The count still tells the truth about how many pages were read.
    expect(snapshot.pagesRead).toBe(many.length)
  })
})

describe("buildWebsiteDigest", () => {
  it("gives the co-founder the page text, not only the headings", () => {
    const digest = buildWebsiteDigest(
      facts({
        pages: [
          {
            url: "https://bakery.example",
            title: "Corner Bakery",
            headings: ["Bread"],
            text: "We bake sourdough every morning at 5am.",
          },
        ],
      }),
    )
    expect(digest).toContain("Text: We bake sourdough every morning at 5am.")
  })

  it("names the address that was typed when the site redirected", () => {
    const digest = buildWebsiteDigest(facts({ redirectedFrom: "https://bakery-preview.vercel.app" }))
    expect(digest).toContain("Requested address (redirects to the URL above): https://bakery-preview.vercel.app")
  })

  it("spends the text budget once, not once per page", () => {
    const pages = Array.from({ length: 10 }, (_, index) => ({
      url: `https://bakery.example/p${index}`,
      headings: [],
      text: "x".repeat(1_500),
    }))
    const digest = buildWebsiteDigest(facts({ pages, pagesCrawled: pages.length }))
    const carried = digest.split("Text: ").length - 1
    expect(carried).toBeLessThanOrEqual(6)
    expect(digest.length).toBeLessThanOrEqual(12_000)
  })
})
