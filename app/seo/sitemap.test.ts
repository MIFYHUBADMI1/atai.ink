import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The knowledge sitemap — the long-tail public surface.
 *
 * It is generated from the published set, so drafts, archived articles and
 * noindex pages must never appear in it.
 */

vi.mock("server-only", () => ({}))

const { publicArticles, publicCategories } = vi.hoisted(() => ({
  publicArticles: vi.fn(async () => [] as { slug: string; updatedAt: string; publishedAt: string; seo?: { noindex?: boolean } }[]),
  publicCategories: vi.fn(async () => [] as { slug: string }[]),
}))

vi.mock("@/lib/blog/store", () => ({ publicArticles, publicCategories }))

import sitemap from "./sitemap"

beforeEach(() => {
  publicArticles.mockResolvedValue([])
  publicCategories.mockResolvedValue([])
})

describe("knowledge sitemap", () => {
  it("lists the public knowledge and marketing pages", async () => {
    const entries = await sitemap()
    const urls = entries.map((entry) => entry.url)
    expect(urls.some((url) => url.endsWith("/docs"))).toBe(true)
    expect(urls.some((url) => url.endsWith("/pricing"))).toBe(true)
  })

  it("lists a published, indexable article", async () => {
    publicArticles.mockResolvedValue([
      { slug: "validate-a-business-idea", publishedAt: "2026-01-15", updatedAt: "2026-02-01" },
    ])
    const entries = await sitemap()
    const entry = entries.find((item) => item.url.endsWith("/blog/validate-a-business-idea"))
    expect(entry).toBeDefined()
    expect(entry?.lastModified).toEqual(new Date("2026-02-01T00:00:00"))
  })

  it("excludes an article that is marked noindex", async () => {
    publicArticles.mockResolvedValue([
      { slug: "hidden-post", publishedAt: "2026-01-15", updatedAt: "2026-01-15", seo: { noindex: true } },
    ])
    const entries = await sitemap()
    expect(entries.some((entry) => entry.url.endsWith("/blog/hidden-post"))).toBe(false)
  })

  it("lists the public category landing pages", async () => {
    publicCategories.mockResolvedValue([{ slug: "comparisons" }])
    const entries = await sitemap()
    expect(entries.some((entry) => entry.url.endsWith("/blog/category/comparisons"))).toBe(true)
  })

  it("never lists an authenticated surface", async () => {
    const entries = await sitemap()
    const urls = entries.map((entry) => entry.url)
    expect(urls.some((url) => url.includes("/admin"))).toBe(false)
    expect(urls.some((url) => url.includes("/api/"))).toBe(false)
    expect(urls.some((url) => url.includes("/dashboard"))).toBe(false)
  })

  it("produces absolute URLs", async () => {
    const entries = await sitemap()
    for (const entry of entries) expect(entry.url.startsWith("https://")).toBe(true)
  })
})
