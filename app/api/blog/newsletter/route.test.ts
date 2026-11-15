import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Public newsletter endpoint.
 *
 * The form is reachable without an account, so the endpoint has to validate
 * the address, throttle abuse and stay idempotent — all without ever telling
 * a caller whether an address is already on the list in a way that leaks data.
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

function post(body: unknown) {
  return new Request("http://localhost/api/blog/newsletter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mongo.reset()
})

describe("POST /api/blog/newsletter", () => {
  it("stores a subscription", async () => {
    const response = await POST(post({ email: "reader@example.com", source: "blog-index" }))
    expect(response.status).toBe(201)

    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.data.alreadySubscribed).toBe(false)
    expect(mongo.collection("blog_newsletter").docs).toHaveLength(1)
  })

  it("normalises the address so a repeat subscription is recognised", async () => {
    await POST(post({ email: "Reader@Example.com" }))
    const response = await POST(post({ email: "reader@example.com" }))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.alreadySubscribed).toBe(true)
    expect(mongo.collection("blog_newsletter").docs).toHaveLength(1)
  })

  it("rejects an invalid address with a 422", async () => {
    const response = await POST(post({ email: "not-an-email" }))
    expect(response.status).toBe(422)

    const payload = await response.json()
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe("VALIDATION")
    expect(mongo.collection("blog_newsletter").docs).toHaveLength(0)
  })

  it("rejects a missing email", async () => {
    const response = await POST(post({}))
    expect(response.status).toBe(422)
  })

  it("rejects a body that is not an object", async () => {
    const response = await POST(
      new Request("http://localhost/api/blog/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["nope"]),
      }),
    )
    expect(response.status).toBe(422)
  })
})
