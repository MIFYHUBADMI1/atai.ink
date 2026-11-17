import { describe, expect, it } from "vitest"

import {
  extractBlogFaqs,
  extractLinks,
  headingId,
  markdownToText,
  markdownToc,
  normalizeBlogBody,
  readingMinutes,
  slugifyBlog,
  todayIso,
  wordCount,
} from "@/lib/blog/content"

describe("slugifyBlog", () => {
  it("produces a clean URL slug", () => {
    expect(slugifyBlog("How to Validate a Business Idea")).toBe("how-to-validate-a-business-idea")
  })

  it("strips punctuation and collapses separators", () => {
    expect(slugifyBlog("AI & Tech: What’s Next?")).toBe("ai-tech-what-s-next")
  })

  it("removes accents", () => {
    expect(slugifyBlog("Café Economics")).toBe("cafe-economics")
  })

  it("truncates very long titles", () => {
    expect(slugifyBlog("a".repeat(300))).toHaveLength(120)
  })

  it("returns an empty slug when nothing usable remains", () => {
    expect(slugifyBlog("!!!")).toBe("")
  })
})

describe("word count and reading time", () => {
  it("ignores code fences and markdown syntax", () => {
    expect(wordCount("## Heading\n\nSome real words here.")).toBe(5)
  })

  it("never reports a reading time below one minute", () => {
    expect(readingMinutes("Short.")).toBe(1)
  })

  it("scales with the amount of prose", () => {
    const long = wordCount("word ".repeat(400))
    expect(readingMinutes("word ".repeat(400))).toBe(2)
    expect(long).toBe(400)
  })
})

describe("markdownToText", () => {
  it("drops markup and keeps the words", () => {
    expect(markdownToText("## Title\n\nSome **bold** text and a [link](https://atai.ink).")).toBe(
      "Title Some bold text and a link.",
    )
  })

  it("removes image markup", () => {
    expect(markdownToText("![alt text](https://atai.ink/a.png)")).toBe("")
  })
})

describe("markdownToc", () => {
  it("collects H2 and H3 headings in order", () => {
    const toc = markdownToc("## First\n\ntext\n\n### Nested\n\n## Second")
    expect(toc.map((entry) => entry.text)).toEqual(["First", "Nested", "Second"])
    expect(toc.map((entry) => entry.level)).toEqual([2, 3, 2])
  })

  it("ignores headings inside code fences", () => {
    const toc = markdownToc("```md\n## Not a heading\n```\n\n## Real heading")
    expect(toc).toHaveLength(1)
    expect(toc[0].text).toBe("Real heading")
  })

  it("gives duplicate headings unique anchors", () => {
    const toc = markdownToc("## Setup\n\n## Setup")
    expect(toc[0].id).toBe("setup")
    // The anchor scheme is shared with the renderer, so the second heading is
    // "setup-2" in both the outline and on the page.
    expect(toc[1].id).toBe("setup-2")
  })

  it("skips H1 because the page title already renders as the H1", () => {
    expect(markdownToc("# Title\n\n## Section")).toHaveLength(1)
  })

  it("can include deeper levels on request", () => {
    expect(markdownToc("## Two\n\n#### Four")).toHaveLength(1)
    expect(markdownToc("## Two\n\n#### Four", 4)).toHaveLength(2)
  })
})

describe("normalizeBlogBody", () => {
  it("drops the leading title line because the hero renders the H1", () => {
    expect(normalizeBlogBody("# My Title\n\n## Section")).toBe("## Section")
  })

  it("demotes a stray in-body H1 so it is styled and lands in the outline", () => {
    const body = normalizeBlogBody("## First\n\n# Stray\n\ntext")
    expect(body).toBe("## First\n\n## Stray\n\ntext")
    expect(markdownToc(body).map((entry) => entry.text)).toEqual(["First", "Stray"])
  })

  it("leaves hash comments inside code fences alone", () => {
    const markdown = "```bash\n# run the build\n## not a heading\n```\n\n## Real"
    expect(normalizeBlogBody(markdown)).toBe(markdown)
  })

  it("repairs pasted headings and list items that Markdown would not parse", () => {
    expect(normalizeBlogBody("##Quick start")).toBe("## Quick start")
    expect(normalizeBlogBody("####Deep")).toBe("#### Deep")
    expect(normalizeBlogBody("-first item")).toBe("- first item")
  })

  it("does not invent structure out of prose", () => {
    // A single hash before a word is indistinguishable from a hashtag, and a
    // leading dash before a number is text, not a bullet.
    expect(normalizeBlogBody("#buildwithai is the tag")).toBe("#buildwithai is the tag")
    expect(normalizeBlogBody("-50% off for the first month")).toBe("-50% off for the first month")
    expect(normalizeBlogBody("---")).toBe("---")
  })

  it("keeps the outline anchor in step with the repaired heading", () => {
    const body = normalizeBlogBody("##Pricing")
    expect(markdownToc(body)[0].id).toBe(headingId("Pricing"))
  })
})

describe("headingId", () => {
  it("builds a URL-safe anchor", () => {
    expect(headingId("How to Build & Scale")).toBe("how-to-build-scale")
  })
})

describe("extractBlogFaqs", () => {
  it("reads Q/A pairs from a bold-question section", () => {
    const markdown = [
      "## Frequently asked questions",
      "",
      "**Is Atai a code generator?**",
      "",
      "No. Atai covers the whole business lifecycle.",
      "",
      "**Can I use my own stack?**",
      "",
      "Yes, you can bring your own repository.",
    ].join("\n")
    const faqs = extractBlogFaqs(markdown)
    expect(faqs).toHaveLength(2)
    expect(faqs[0].q).toBe("Is Atai a code generator?")
    expect(faqs[0].a).toContain("whole business lifecycle")
  })

  it("reads questions written as H3 headings", () => {
    const markdown = ["## FAQ", "", "### What does Atai do?", "", "It runs the business lifecycle."].join("\n")
    const faqs = extractBlogFaqs(markdown)
    expect(faqs).toHaveLength(1)
    expect(faqs[0].q).toBe("What does Atai do?")
  })

  it("returns nothing when there is no FAQ section", () => {
    expect(extractBlogFaqs("## Some other section\n\nBody")).toEqual([])
  })
})

describe("extractLinks", () => {
  it("separates internal links from external ones", () => {
    const links = extractLinks("[Docs](/docs) and [Google](https://google.com) and [Top](#top)")
    expect(links.filter((link) => link.internal)).toHaveLength(2)
    expect(links.filter((link) => !link.internal)).toHaveLength(1)
  })
})

describe("todayIso", () => {
  it("returns a plain calendar date", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
