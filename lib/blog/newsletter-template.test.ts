import { describe, expect, it } from "vitest"

/**
 * The announcement email that goes to a subscriber.
 *
 * The email carries admin-authored text, so the only safe assumption is that
 * it may contain markup — it must never be able to carry executable markup
 * into a mail client.
 */

import { buildAnnouncementEmail, buildAnnouncementSubject, escapeHtml } from "@/lib/blog/newsletter-template"

const input = {
  title: "How to validate a business idea",
  excerpt: "Validate before you build.",
  url: "https://atai.ink/blog/validate-a-business-idea",
  unsubscribeUrl: "https://atai.ink/api/blog/newsletter/unsubscribe?id=sub-1",
  category: "business-building",
  readingMinutes: 4,
}

describe("buildAnnouncementSubject", () => {
  it("names the publication and the article", () => {
    expect(buildAnnouncementSubject("A guide")).toBe("New on Atai Insights: A guide")
  })

  it("never produces an empty subject", () => {
    expect(buildAnnouncementSubject("   ")).toBe("New on Atai Insights: A new guide")
  })
})

describe("buildAnnouncementEmail", () => {
  it("carries the article link and the reader's unsubscribe link", () => {
    const email = buildAnnouncementEmail(input)

    expect(email.subject).toBe("New on Atai Insights: How to validate a business idea")
    expect(email.html).toContain("https://atai.ink/blog/validate-a-business-idea")
    expect(email.html).toContain("https://atai.ink/api/blog/newsletter/unsubscribe?id=sub-1")
    expect(email.text).toContain("Read it: https://atai.ink/blog/validate-a-business-idea")
    expect(email.text).toContain("Unsubscribe: https://atai.ink/api/blog/newsletter/unsubscribe?id=sub-1")
  })

  it("escapes markup in the title and the excerpt", () => {
    const email = buildAnnouncementEmail({
      ...input,
      title: "</script><script>alert(1)</script>",
      excerpt: "<img src=x onerror=alert(1)>",
    })

    expect(email.html).not.toContain("<script>alert(1)</script>")
    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;script&gt;")
  })

  it("drops a link that is not http(s)", () => {
    const email = buildAnnouncementEmail({ ...input, url: "javascript:alert(1)" })

    expect(email.html).not.toContain("javascript:alert(1)")
    expect(email.html).not.toContain("Read the guide")
  })

  it("always offers a way out", () => {
    const email = buildAnnouncementEmail(input)

    expect(email.html).toMatch(/Unsubscribe from Atai Insights/)
    expect(email.text).toMatch(/you subscribed to Atai Insights on Atai/)
  })
})

describe("escapeHtml", () => {
  it("escapes the characters that break out of markup", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;")
  })
})
