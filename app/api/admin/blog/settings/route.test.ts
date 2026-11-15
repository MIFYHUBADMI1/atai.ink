import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Discoverability settings API.
 *
 * The interesting behaviour is honesty: the endpoint reports whether each
 * integration is actually connected, and a submission ping says exactly what
 * happened. It must never claim an article is indexed.
 */

vi.mock("server-only", () => ({}))

const { mongo, requireAdmin } = await vi.hoisted(async () => {
  const { createMongoMock } = await import("@/lib/blog/test-support/mongo-mock")
  return { mongo: createMongoMock(), requireAdmin: vi.fn() }
})

vi.mock("@/lib/auth/session", () => ({ requireAdmin }))

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

import { AppError } from "@/lib/errors"
import { GET, PATCH, POST } from "./route"

const ADMIN = { id: "admin-1", isAdmin: true }

beforeEach(() => {
  mongo.reset()
  requireAdmin.mockReset()
  requireAdmin.mockResolvedValue(ADMIN)
  delete process.env.INDEXNOW_KEY
})

describe("GET /api/admin/blog/settings", () => {
  it("refuses a caller who is not an administrator", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const response = await GET()
    expect(response.status).toBe(403)
  })

  it("reports every integration as not connected when nothing is configured", async () => {
    const response = await GET()
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.data.integrations.indexNow.keyConfigured).toBe(false)
    expect(payload.data.integrations.indexNow.enabled).toBe(false)
    expect(payload.data.integrations.indexNow.lastStatus).toBe("not-configured")
    expect(payload.data.integrations.searchConsole.connected).toBe(false)
  })

  it("reports IndexNow as configured once the key is present", async () => {
    process.env.INDEXNOW_KEY = "test-key"
    const response = await GET()
    const payload = await response.json()
    expect(payload.data.integrations.indexNow.keyConfigured).toBe(true)
  })
})

describe("PATCH /api/admin/blog/settings", () => {
  it("refuses a caller who is not an administrator", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const response = await PATCH(
      new Request("http://localhost/api/admin/blog/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indexNowEnabled: true }),
      }),
    )
    expect(response.status).toBe(403)
  })

  it("stores the discoverability settings", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/blog/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indexNowEnabled: true, gscVerification: "google-site-verification=abc" }),
      }),
    )
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.data.settings.indexNowEnabled).toBe(true)
    expect(payload.data.settings.gscVerification).toBe("google-site-verification=abc")
  })
})

describe("POST /api/admin/blog/settings — submission ping", () => {
  it("refuses a caller who is not an administrator", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const response = await POST(
      new Request("http://localhost/api/admin/blog/settings", { method: "POST" }),
    )
    expect(response.status).toBe(403)
  })

  it("sends nothing and says why when the integration is not configured", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/blog/settings", { method: "POST" }),
    )
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.data.status).toBe("not-configured")
    expect(payload.data.keyConfigured).toBe(false)
    expect(payload.data.submittedCount).toBe(0)
  })

  it("accepts a call with no request body at all", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/blog/settings", { method: "POST" }),
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
  })

  it("reports a successful submission without claiming the page is indexed", async () => {
    process.env.INDEXNOW_KEY = "test-key"
    await PATCH(
      new Request("http://localhost/api/admin/blog/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indexNowEnabled: true }),
      }),
    )

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(
      new Request("http://localhost/api/admin/blog/settings", { method: "POST" }),
    )
    const payload = await response.json()

    expect(payload.data.status).toBe("submitted")
    expect(payload.data.keyConfigured).toBe(true)
    expect(payload.data.enabled).toBe(true)
    expect(payload.data).not.toHaveProperty("indexed")
    expect(payload.data).not.toHaveProperty("indexedAt")

    vi.unstubAllGlobals()
  })

  it("reports a failed submission instead of pretending it worked", async () => {
    process.env.INDEXNOW_KEY = "test-key"
    await PATCH(
      new Request("http://localhost/api/admin/blog/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indexNowEnabled: true }),
      }),
    )

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })))

    const response = await POST(
      new Request("http://localhost/api/admin/blog/settings", { method: "POST" }),
    )
    const payload = await response.json()

    expect(payload.data.status).toBe("failed")
    expect(payload.data.error).toContain("500")
    expect(payload.data.submittedCount).toBe(0)

    vi.unstubAllGlobals()
  })
})
