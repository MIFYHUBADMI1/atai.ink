import { describe, expect, it } from "vitest"

import robots from "./robots"

describe("robots.txt", () => {
  const rules = robots().rules

  it("allows every user agent", () => {
    expect(rules[0].userAgent).toBe("*")
  })

  it("allows the public blog and its article paths", () => {
    const allow = rules[0].allow ?? []
    expect(allow).toContain("/blog")
    expect(allow).toContain("/blog/")
  })

  it("keeps the admin console and the API out of the index", () => {
    const disallow = rules[0].disallow ?? []
    expect(disallow).toContain("/admin/")
    expect(disallow).toContain("/api/")
    expect(disallow).toContain("/settings/")
  })

  it("does not block the static assets a public article needs", () => {
    const disallow = rules[0].disallow ?? []
    const allow = rules[0].allow ?? []
    expect(disallow).toContain("/_next/")
    expect(allow).toContain("/_next/static/")
  })

  it("gives AI crawlers the same public access as everyone else", () => {
    const aiRule = rules[1]
    expect(aiRule.userAgent).toContain("GPTBot")
    expect(aiRule.userAgent).toContain("ClaudeBot")
    expect(aiRule.userAgent).toContain("PerplexityBot")
    expect(aiRule.allow).toContain("/blog")
    expect(aiRule.disallow).toContain("/admin/")
  })

  it("points crawlers at the sitemaps", () => {
    const sitemaps = robots().sitemap ?? []
    expect(sitemaps.some((url) => url.endsWith("/sitemap.xml"))).toBe(true)
    expect(sitemaps.some((url) => url.endsWith("/seo/sitemap.xml"))).toBe(true)
  })
})
