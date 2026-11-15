import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Admin newsletter API — the subscribers page and the manual announcement.
 *
 * The subscriber list is personal data, so the route must refuse a caller who
 * is not an administrator, and a manual send must report exactly what the
 * mail provider accepted.
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
import { GET, POST } from "./route"

const ADMIN = { id: "admin-1", isAdmin: true }

function request(url: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function articleDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
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

beforeEach(() => {
  mongo.reset()
  requireAdmin.mockReset()
  requireAdmin.mockResolvedValue(ADMIN)
  vi.stubEnv("RESEND_API_KEY", "re_test_key")
  vi.stubEnv("RESEND_FROM_EMAIL", "noreply@atai.ink")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })),
  )
})

describe("GET /api/admin/blog/newsletter", () => {
  it("refuses a caller who is not an administrator", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))

    const response = await GET(request("/api/admin/blog/newsletter"))

    expect(response.status).toBe(403)
  })

  it("lists the subscribers and the real integration state", async () => {
    mongo.collection("blog_newsletter").docs.push({
      id: "sub-1",
      email: "reader@example.com",
      source: "blog-index",
      createdAtMs: 1,
    })

    const response = await GET(request("/api/admin/blog/newsletter"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.total).toBe(1)
    expect(payload.data.subscribers).toBe(1)
    expect(payload.data.items[0].email).toBe("reader@example.com")
    expect(payload.data.integration.configured).toBe(true)
    expect(payload.data.integration.from).toBe("noreply@atai.ink")
    expect(payload.data.campaigns).toEqual([])
  })

  it("reports an unconfigured provider instead of pretending it works", async () => {
    vi.stubEnv("RESEND_API_KEY", "")

    const response = await GET(request("/api/admin/blog/newsletter"))
    const payload = await response.json()

    expect(payload.data.integration.configured).toBe(false)
    expect(payload.data.integration.from).toBe("noreply@atai.ink")
  })

  it("exports the list as CSV", async () => {
    mongo.collection("blog_newsletter").docs.push({
      id: "sub-1",
      email: "reader@example.com",
      source: "blog-index",
      createdAtMs: 1,
    })

    const response = await GET(request("/api/admin/blog/newsletter?format=csv"))

    expect(response.headers.get("content-type")).toContain("text/csv")
    const csv = await response.text()
    expect(csv.split("\n")[0]).toBe("email,source,subscribedAt,status")
    expect(csv).toContain("reader@example.com")
  })

  it("keeps a spreadsheet formula out of the export", async () => {
    mongo.collection("blog_newsletter").docs.push({
      id: "sub-1",
      email: "reader@example.com",
      source: "=cmd|'/c calc'!A1",
      createdAtMs: 1,
    })

    const response = await GET(request("/api/admin/blog/newsletter?format=csv"))
    const csv = await response.text()
    const row = csv.split("\n")[1]

    expect(row.startsWith("=")).toBe(false)
    expect(row).toContain("'=")
  })
})

describe("POST /api/admin/blog/newsletter", () => {
  it("refuses a caller who is not an administrator", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))

    const response = await POST(request("/api/admin/blog/newsletter", { articleId: "a1" }))

    expect(response.status).toBe(403)
  })

  it("rejects a body without an article", async () => {
    const response = await POST(request("/api/admin/blog/newsletter", {}))

    expect(response.status).toBe(422)
  })

  it("returns 404 for an article that does not exist", async () => {
    const response = await POST(request("/api/admin/blog/newsletter", { articleId: "missing" }))

    expect(response.status).toBe(404)
  })

  it("refuses to announce a draft", async () => {
    mongo.collection("blog_articles").docs.push(articleDoc({ id: "a2", status: "draft" }))

    const response = await POST(request("/api/admin/blog/newsletter", { articleId: "a2" }))

    expect(response.status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("announces a published article and reports what the provider accepted", async () => {
    mongo.collection("blog_articles").docs.push(articleDoc())
    mongo.collection("blog_newsletter").docs.push({
      id: "sub-1",
      email: "reader@example.com",
      source: "blog-index",
      createdAtMs: 1,
    })

    const response = await POST(request("/api/admin/blog/newsletter", { articleId: "a1" }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.announcement.status).toBe("sent")
    expect(payload.data.announcement.sentCount).toBe(1)
    expect(mongo.collection("blog_campaigns").docs).toHaveLength(1)
    expect(mongo.collection("blog_campaigns").docs[0].status).toBe("sent")
  })

  it("records the campaign before the first message goes out", async () => {
    mongo.collection("blog_articles").docs.push(articleDoc())
    mongo.collection("blog_newsletter").docs.push({
      id: "sub-1",
      email: "reader@example.com",
      source: "blog-index",
      createdAtMs: 1,
    })
    const seenDuringSend: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // The campaign has to exist while the send is still running — an
        // interrupted send must not leave the admin with an empty history.
        seenDuringSend.push(...mongo.collection("blog_campaigns").docs.map((doc: { status: string }) => doc.status))
        return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      }),
    )

    const response = await POST(request("/api/admin/blog/newsletter", { articleId: "a1" }))

    expect(response.status).toBe(200)
    expect(seenDuringSend).toEqual(["sending"])
    expect(mongo.collection("blog_campaigns").docs[0].status).toBe("sent")
  })
})
