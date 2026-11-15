import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Newsletter announcements — the Resend broadcast.
 *
 * The point of these tests is honesty about what was sent: a message the
 * provider accepted, a message it rejected, and the case where nothing could
 * be sent at all because the provider is not configured. "Sent" never means
 * "read".
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/blog/legacy", () => ({ listBlogPosts: () => [] }))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { announceArticle } from "@/lib/blog/newsletter"
import { subscribeNewsletter, unsubscribeNewsletter, updateBlogSettings } from "@/lib/blog/store"
import type { BlogArticleDoc } from "@/lib/blog/types"

const ADMIN = { id: "admin-1" }

function article(overrides: Partial<BlogArticleDoc> = {}): BlogArticleDoc {
  return {
    id: "article-1",
    slug: "validate-a-business-idea",
    title: "How to validate a business idea",
    description: "A practical guide to validating a business idea before you build the product.",
    excerpt: "Validate before you build.",
    body: "## Why validation matters",
    category: "business-building",
    tags: [],
    author: { name: "Atai Team" },
    seo: {},
    status: "published",
    featured: false,
    relatedSlugs: [],
    publishedAt: "2026-01-15",
    updatedAt: "2026-01-15",
    readingMinutes: 4,
    views: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdBy: "admin-1",
    updatedBy: "admin-1",
    ...overrides,
  }
}

function okResponse() {
  return new Response(JSON.stringify({ id: "msg_1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  mongo.reset()
  vi.stubEnv("RESEND_API_KEY", "re_test_key")
  vi.stubEnv("RESEND_FROM_EMAIL", "noreply@atai.ink")
  vi.stubGlobal("fetch", vi.fn(async () => okResponse()))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("announceArticle — when nothing is sent", () => {
  it("does not send on publish while the automatic announcement is off", async () => {
    await subscribeNewsletter("reader@example.com", "blog-index")

    const result = await announceArticle(article(), { trigger: "publish", adminId: ADMIN.id })

    expect(result.status).toBe("skipped")
    expect(result.reason).toMatch(/switched off/i)
    expect(fetch).not.toHaveBeenCalled()
    expect(mongo.collection("blog_campaigns").docs).toHaveLength(0)
  })

  it("sends on publish once the automatic announcement is on", async () => {
    await subscribeNewsletter("reader@example.com", "blog-index")
    await updateBlogSettings({ newsletterAutoAnnounce: true })

    const result = await announceArticle(article(), { trigger: "publish", adminId: ADMIN.id })

    expect(result.status).toBe("sent")
    expect(result.sentCount).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("skips when nobody has subscribed", async () => {
    const result = await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    expect(result.status).toBe("skipped")
    expect(result.reason).toMatch(/no subscribers/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("records a not-configured campaign when the provider has no credentials", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    await subscribeNewsletter("reader@example.com", "blog-index")

    const result = await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    expect(result.status).toBe("not-configured")
    expect(fetch).not.toHaveBeenCalled()
    const campaigns = mongo.collection("blog_campaigns").docs
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].status).toBe("not-configured")
    expect(campaigns[0].sentCount).toBe(0)
  })
})

describe("announceArticle — sending", () => {
  it("sends to every subscriber and records what the provider accepted", async () => {
    await subscribeNewsletter("one@example.com", "blog-index")
    await subscribeNewsletter("two@example.com", "blog-index")

    const result = await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    expect(result.status).toBe("sent")
    expect(result.recipients).toBe(2)
    expect(result.sentCount).toBe(2)
    expect(result.failedCount).toBe(0)

    const campaigns = mongo.collection("blog_campaigns").docs
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].status).toBe("sent")
    expect(campaigns[0].sentCount).toBe(2)
    expect(campaigns[0].trigger).toBe("manual")
    expect(campaigns[0].articleId).toBe("article-1")
  })

  it("never sends to an address that unsubscribed", async () => {
    await subscribeNewsletter("one@example.com", "blog-index")
    await subscribeNewsletter("two@example.com", "blog-index")
    await unsubscribeNewsletter("two@example.com")

    const result = await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    expect(result.recipients).toBe(1)
    expect(result.skippedCount).toBe(1)
    const bodies = (fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls.map((call) =>
      JSON.parse(call[1].body),
    )
    expect(bodies).toHaveLength(1)
    expect(bodies[0].to).toBe("one@example.com")
  })

  it("gives every reader their own unsubscribe link", async () => {
    await subscribeNewsletter("one@example.com", "blog-index")
    await subscribeNewsletter("two@example.com", "blog-index")

    await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    const calls = (fetch as unknown as { mock: { calls: [string, { body: string; headers: Record<string, string> }][] } })
      .mock.calls
    const links = calls.map((call) => {
      const body = JSON.parse(call[1].body)
      return body.headers["List-Unsubscribe"]
    })
    expect(new Set(links).size).toBe(2)
    for (const link of links) {
      expect(link).toMatch(/^<https:\/\/atai\.ink\/api\/blog\/newsletter\/unsubscribe\?id=[^>]+>$/)
    }
  })

  it("sends an idempotency key so a repeat publish cannot deliver twice", async () => {
    await subscribeNewsletter("one@example.com", "blog-index")

    await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    const calls = (fetch as unknown as { mock: { calls: [string, { headers: Record<string, string> }][] } }).mock.calls
    expect(calls[0][1].headers["Idempotency-Key"]).toMatch(/^newsletter_article-1_[0-9a-f]{16}$/)
  })

  it("reports a partial send when the provider rejects one message", async () => {
    await subscribeNewsletter("one@example.com", "blog-index")
    await subscribeNewsletter("two@example.com", "blog-index")
    let call = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1
        if (call === 1) return okResponse()
        return new Response(JSON.stringify({ message: "rejected" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        })
      }),
    )

    const result = await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    expect(result.status).toBe("partial")
    expect(result.sentCount).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(result.error).toBeTruthy()
    expect(mongo.collection("blog_campaigns").docs[0].status).toBe("partial")
  })

  it("reports a failed send when the provider rejects every message", async () => {
    await subscribeNewsletter("one@example.com", "blog-index")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "rejected" }), { status: 500 })),
    )

    const result = await announceArticle(article(), { trigger: "manual", adminId: ADMIN.id })

    expect(result.status).toBe("failed")
    expect(result.sentCount).toBe(0)
    expect(result.failedCount).toBe(1)
  })
})
