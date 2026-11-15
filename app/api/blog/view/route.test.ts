import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Public article-view beacon.
 *
 * Only a slug that resolves to a published article may be counted, and the
 * endpoint is throttled per IP bucket so the counters cannot be inflated.
 */

vi.mock("server-only", () => ({}))

const { mongo } = await vi.hoisted(async () => {
  const { createMongoMock } = await import("@/lib/blog/test-support/mongo-mock")
  return { mongo: createMongoMock() }
})

vi.mock("@/lib/db/collections", () => ({
  blogNewsletterCol: async () => mongo.collection("blog_newsletter"),
  blogArticlesCol: async () => mongo.collection("blog_articles"),
  blogCategoriesCol: async () => mongo.collection("blog_categories"),
  blogRedirectsCol: async () => mongo.collection("blog_redirects"),
  blogRevisionsCol: async () => mongo.collection("blog_revisions"),
  blogStatsCol: async () => mongo.collection("blog_stats"),
  blogSettingsCol: async () => mongo.collection("blog_settings"),
  blogCampaignsCol: async () => mongo.collection("blog_campaigns"),
}))

vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => {}) }))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/blog/legacy", () => ({ listBlogPosts: () => [] }))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "./route"
import { invalidateBlogCache } from "@/lib/blog/store"

const published = {
  id: "a1",
  slug: "validate-a-business-idea",
  title: "How to validate a business idea",
  description: "A practical guide to validating a business idea before you build the product.",
  excerpt: "Validate before you build.",
  body: "## Why validation matters\n\nMost ideas fail.",
  category: "business-building",
  tags: [],
  author: { name: "Atai Team" },
  seo: {},
  status: "published",
  featured: false,
  relatedSlugs: [],
  publishedAt: "2026-01-15",
  updatedAt: "2026-01-15",
  readingMinutes: 1,
  views: 0,
  createdAtMs: 0,
  updatedAtMs: 0,
  createdBy: "admin",
  updatedBy: "admin",
}

function post(body: unknown) {
  return new Request("http://localhost/api/blog/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mongo.reset()
  invalidateBlogCache()
})

describe("POST /api/blog/view", () => {
  it("counts a view for a published article", async () => {
    mongo.collection("blog_articles").docs.push({ ...published })
    const response = await POST(post({ slug: published.slug }))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.data.recorded).toBe(true)
    expect(mongo.collection("blog_articles").docs[0].views).toBe(1)
  })

  it("writes a daily stats row so the performance view has a date series", async () => {
    mongo.collection("blog_articles").docs.push({ ...published })
    await POST(post({ slug: published.slug }))

    const stats = mongo.collection("blog_stats").docs
    expect(stats).toHaveLength(1)
    expect(stats[0].slug).toBe(published.slug)
    expect(stats[0].views).toBe(1)
  })

  it("does not count a view for an unknown slug", async () => {
    const response = await POST(post({ slug: "does-not-exist" }))
    expect(response.status).toBe(200)
    expect(mongo.collection("blog_articles").docs).toHaveLength(0)
  })

  it("rejects a request without a slug", async () => {
    const response = await POST(post({}))
    expect(response.status).toBe(422)
  })
})
