import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Unsubscribing from the newsletter.
 *
 * The link carries the subscriber id — a random value only the owner of the
 * address ever sees. GET asks first; POST removes the address.
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

import { GET, POST } from "./route"

function subscriber() {
  return { id: "sub-1", email: "reader@example.com", source: "blog-index", createdAtMs: 1 }
}

beforeEach(() => {
  mongo.reset()
})

describe("GET /api/blog/newsletter/unsubscribe", () => {
  it("asks for confirmation without removing the address", async () => {
    mongo.collection("blog_newsletter").docs.push(subscriber())

    const response = await GET(new Request("http://localhost/api/blog/newsletter/unsubscribe?id=sub-1"))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(html).toContain("reader@example.com")
    expect(html).toContain("Confirm unsubscribe")
    expect(mongo.collection("blog_newsletter").docs[0].unsubscribedAt).toBeUndefined()
  })

  it("says so when the link is not valid", async () => {
    const response = await GET(new Request("http://localhost/api/blog/newsletter/unsubscribe"))
    const html = await response.text()

    expect(html).toContain("not valid")
  })

  it("says so when the subscription is unknown", async () => {
    const response = await GET(new Request("http://localhost/api/blog/newsletter/unsubscribe?id=missing"))
    const html = await response.text()

    expect(html).toContain("couldn't find")
  })
})

describe("POST /api/blog/newsletter/unsubscribe", () => {
  it("removes the address from the list", async () => {
    mongo.collection("blog_newsletter").docs.push(subscriber())

    const response = await POST(
      new Request("http://localhost/api/blog/newsletter/unsubscribe?id=sub-1", { method: "POST" }),
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("unsubscribed")
    expect(mongo.collection("blog_newsletter").docs[0].unsubscribedAt).toBeGreaterThan(0)
  })

  it("accepts the id from a form post", async () => {
    mongo.collection("blog_newsletter").docs.push(subscriber())

    const response = await POST(
      new Request("http://localhost/api/blog/newsletter/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "id=sub-1",
      }),
    )

    expect(response.status).toBe(200)
    expect(mongo.collection("blog_newsletter").docs[0].unsubscribedAt).toBeGreaterThan(0)
  })

  it("does nothing for an unknown subscription", async () => {
    const response = await POST(
      new Request("http://localhost/api/blog/newsletter/unsubscribe?id=missing", { method: "POST" }),
    )

    expect(response.status).toBe(200)
    expect(mongo.collection("blog_newsletter").docs).toHaveLength(0)
  })
})
