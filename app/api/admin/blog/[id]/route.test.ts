import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Admin blog article API — authorization and input validation.
 *
 * The Content Studio is the only place articles can be changed, so every
 * server-side action must refuse a caller who is not an administrator. Client
 * side checks are never enough; this pins the enforcement to the route.
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
import { DELETE, GET, PATCH } from "./route"

const ADMIN = { id: "admin-1", isAdmin: true }
const params = { params: Promise.resolve({ id: "a1" }) }

function request(body?: unknown) {
  return new Request("http://localhost/api/admin/blog/a1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const validBody = {
  title: "How to validate a business idea",
  slug: "validate-a-business-idea",
  description: "A practical guide to validating a business idea before you build the product.",
  body: "## Why validation matters\n\nMost ideas fail because nobody wanted them.",
  category: "business-building",
  tags: ["validation"],
  author: { name: "Atai Team" },
  seo: {},
  status: "draft",
}

beforeEach(() => {
  mongo.reset()
  requireAdmin.mockReset()
  requireAdmin.mockResolvedValue(ADMIN)
})

describe("admin article API — authorization", () => {
  it("refuses a signed-in user who is not an administrator", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const response = await GET(request(), params)
    expect(response.status).toBe(403)
  })

  it("refuses an anonymous caller", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED"))
    const response = await GET(request(), params)
    expect(response.status).toBe(401)
  })

  it("refuses a non-administrator from changing an article", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const response = await PATCH(request(validBody), params)
    expect(response.status).toBe(403)
    expect(mongo.collection("blog_articles").docs).toHaveLength(0)
  })

  it("refuses a non-administrator from deleting an article", async () => {
    requireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const response = await DELETE(request(), params)
    expect(response.status).toBe(403)
    expect(mongo.collection("blog_articles").docs).toHaveLength(0)
  })
})

describe("admin article API — article access", () => {
  it("returns an article for an administrator", async () => {
    mongo.collection("blog_articles").docs.push({
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
      status: "draft",
      featured: false,
      relatedSlugs: [],
      publishedAt: "2026-01-15",
      updatedAt: "2026-01-15",
      readingMinutes: 1,
      views: 0,
      createdAtMs: 0,
      updatedAtMs: 0,
      createdBy: "admin-1",
      updatedBy: "admin-1",
    })

    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.data.item.href).toBe("/admin/blog/articles/a1")
    expect(payload.data.item.publicUrl).toBe("/blog/validate-a-business-idea")
  })

  it("returns 404 for an article that does not exist", async () => {
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
  })
})

describe("admin article API — input validation", () => {
  it("rejects a body that fails the article schema", async () => {
    const response = await PATCH(request({ title: "" }), params)
    expect(response.status).toBe(422)
    const payload = await response.json()
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe("VALIDATION")
  })

  it("rejects a slug with characters that are not URL safe", async () => {
    const response = await PATCH(request({ ...validBody, slug: "Not A Slug!" }), params)
    expect(response.status).toBe(422)
  })

  it("rejects an image URL that is not served over https", async () => {
    const response = await PATCH(
      request({ ...validBody, featuredImage: { url: "http://insecure.example/a.png", alt: "A picture" } }),
      params,
    )
    expect(response.status).toBe(422)
  })

  it("rejects a body that is not a JSON object", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/blog/a1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["nope"]),
      }),
      params,
    )
    expect(response.status).toBe(422)
  })
})

describe("admin article API — saving an article", () => {
  const storedArticle = {
    id: "a1",
    slug: "validate-a-business-idea",
    title: "How to validate a business idea",
    description: "A practical guide to validating a business idea before you build the product.",
    excerpt: "Validate before you build.",
    body: "## Why validation matters",
    category: "business-building",
    tags: ["validation"],
    author: { name: "Atai Team" },
    seo: {},
    status: "draft",
    featured: false,
    relatedSlugs: [],
    publishedAt: "2026-01-15",
    updatedAt: "2026-01-15",
    readingMinutes: 1,
    views: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdBy: "admin-1",
    updatedBy: "admin-1",
  }

  it("saves a valid article", async () => {
    mongo.collection("blog_articles").docs.push({ ...storedArticle })
    const response = await PATCH(request(validBody), params)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.item.title).toBe("How to validate a business idea")
    expect(payload.data.item.slug).toBe("validate-a-business-idea")
  })

  it("saves an article whose optional fields were stored as null", async () => {
    // Older documents were written before the driver omitted `undefined`, so
    // every optional field came back as an explicit null. The editor echoes
    // those values straight back, and the save must not 422.
    mongo.collection("blog_articles").docs.push({
      ...storedArticle,
      author: { name: "Atai Team", role: null, bio: null, url: null, imageUrl: null },
      competitor: null,
      comparison: null,
      featuredImage: null,
      seo: { title: null, description: null, ogTitle: null, ogDescription: null, focusKeyword: null },
      scheduledFor: null,
    })

    const response = await PATCH(
      request({
        ...validBody,
        author: { name: "Atai Team", role: null, bio: null, url: null, imageUrl: null },
        competitor: null,
        comparison: null,
        featuredImage: null,
        seo: { title: null, description: null, ogTitle: null, ogDescription: null, focusKeyword: null },
        scheduledFor: null,
      }),
      params,
    )
    expect(response.status).toBe(200)
  })
})
