import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Blog store — the publishing lifecycle.
 *
 * These tests drive the real store implementation against an in-memory Mongo
 * mock so the behaviour that matters to the Content Studio is pinned down:
 * creating, editing, publishing, scheduling, unpublishing, archiving,
 * duplicating, deleting, slug changes and their permanent redirects.
 */

vi.mock("server-only", () => ({}))

const { mongo, listBlogPosts } = await vi.hoisted(async () => {
  const { createMongoMock } = await import("@/lib/blog/test-support/mongo-mock")
  return { mongo: createMongoMock(), listBlogPosts: vi.fn(() => [] as unknown[]) }
})

vi.mock("@/lib/db/collections", () => ({
  blogArticlesCol: async () => mongo.collection("blog_articles"),
  blogCategoriesCol: async () => mongo.collection("blog_categories"),
  blogRedirectsCol: async () => mongo.collection("blog_redirects"),
  blogRevisionsCol: async () => mongo.collection("blog_revisions"),
  blogStatsCol: async () => mongo.collection("blog_stats"),
  blogNewsletterCol: async () => mongo.collection("blog_newsletter"),
  blogSettingsCol: async () => mongo.collection("blog_settings"),
  blogCampaignsCol: async () => mongo.collection("blog_campaigns"),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/blog/legacy", () => ({ listBlogPosts }))

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  auditAll,
  auditOne,
  blogPerformance,
  blogStats,
  createArticle,
  deleteArticle,
  deleteCategory,
  duplicateArticle,
  getAdminArticle,
  invalidateBlogCache,
  listAdminArticles,
  listRedirects,
  listRevisions,
  publicArticles,
  recordArticleView,
  resolvePublicSlug,
  restoreRevision,
  setArticleStatus,
  subscribeNewsletter,
  updateArticle,
  upsertCategory,
  upsertRedirect,
} from "@/lib/blog/store"
import type { BlogArticleInput } from "@/lib/blog/types"

const ADMIN = "admin-1"

function articleInput(overrides: Partial<BlogArticleInput> = {}): BlogArticleInput {
  return {
    title: "How to validate a business idea",
    slug: "validate-a-business-idea",
    description: "A practical guide to validating a business idea before you build the product.",
    excerpt: "Validate before you build.",
    body: "## Why validation matters\n\nMost ideas fail. Here is how to test yours.\n\n## A simple checklist\n\n- Talk to ten people\n- Price it\n- Sell a pilot\n",
    category: "business-building",
    tags: ["validation", "founders"],
    author: { name: "Atai Team", role: "Editorial" },
    seo: {},
    status: "draft",
    featured: false,
    relatedSlugs: [],
    ...overrides,
  }
}

beforeEach(() => {
  mongo.reset()
  listBlogPosts.mockReset()
  listBlogPosts.mockReturnValue([])
  invalidateBlogCache()
})

describe("createArticle", () => {
  it("stores a new draft with derived slug, reading time and an initial revision", async () => {
    const created = await createArticle(articleInput(), ADMIN)

    expect(created.status).toBe("draft")
    expect(created.slug).toBe("validate-a-business-idea")
    expect(created.readingMinutes).toBeGreaterThanOrEqual(1)
    expect(created.views).toBe(0)
    expect(created.createdBy).toBe(ADMIN)

    const revisions = await listRevisions(created.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0].note).toBe("Created")
    expect(revisions[0].snapshot.title).toBe(created.title)
  })

  it("derives a slug from the title when none is supplied", async () => {
    const created = await createArticle(articleInput({ slug: undefined, title: "Hello, World & Co" }), ADMIN)
    expect(created.slug).toBe("hello-world-co")
  })

  it("rejects a slug that is already taken", async () => {
    await createArticle(articleInput(), ADMIN)
    await expect(createArticle(articleInput({ title: "Another one" }), ADMIN)).rejects.toMatchObject({
      code: "VALIDATION",
      status: 409,
    })
  })

  it("rejects a scheduled article whose date is in the past", async () => {
    await expect(
      createArticle(articleInput({ status: "scheduled", scheduledFor: Date.now() - 60_000 }), ADMIN),
    ).rejects.toMatchObject({ code: "VALIDATION", status: 422 })
  })

  it("keeps the article out of the public feed while it is a draft", async () => {
    await createArticle(articleInput(), ADMIN)
    expect(await publicArticles()).toHaveLength(0)
  })
})

describe("updateArticle", () => {
  it("saves edits and records a revision of the previous state", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    const updated = await updateArticle(
      created.id,
      articleInput({ title: "How to validate a business idea (2026)", body: "## Updated\n\nNew content." }),
      ADMIN,
    )

    expect(updated.title).toBe("How to validate a business idea (2026)")
    expect(updated.updatedBy).toBe(ADMIN)

    const revisions = await listRevisions(created.id)
    expect(revisions).toHaveLength(2)
    const beforeEdit = revisions.find((entry) => entry.note === "Before edit")
    expect(beforeEdit?.snapshot.title).toBe("How to validate a business idea")
  })

  it("preserves the view count and creation metadata across an edit", async () => {
    const created = await createArticle(articleInput({ status: "published" }), ADMIN)
    await recordArticleView(created.slug)
    const updated = await updateArticle(created.id, articleInput({ status: "published", title: "Edited title" }), ADMIN)

    expect(updated.views).toBe(1)
    expect(updated.createdAtMs).toBe(created.createdAtMs)
  })

  it("does not count views for an article that is not published", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    await recordArticleView(created.slug)
    expect((await getAdminArticle(created.id))?.views).toBe(0)
  })

  it("keeps the old URL alive with a permanent redirect when a published slug changes", async () => {
    const created = await createArticle(articleInput({ status: "published" }), ADMIN)
    await updateArticle(created.id, articleInput({ status: "published", slug: "new-business-idea-url" }), ADMIN)

    const redirects = await listRedirects()
    expect(redirects).toHaveLength(1)
    expect(redirects[0].from).toBe("/blog/validate-a-business-idea")
    expect(redirects[0].toSlug).toBe("new-business-idea-url")
  })

  it("does not create a redirect for a draft slug change", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    await updateArticle(created.id, articleInput({ slug: "draft-renamed" }), ADMIN)
    expect(await listRedirects()).toHaveLength(0)
  })

  it("rejects a slug already used by another article", async () => {
    await createArticle(articleInput(), ADMIN)
    const other = await createArticle(articleInput({ title: "Second", slug: "second-post" }), ADMIN)
    await expect(updateArticle(other.id, articleInput({ slug: "validate-a-business-idea", title: "Second" }), ADMIN)).rejects.toMatchObject(
      { status: 409 },
    )
  })

  it("stores sanitised content so a stored script tag cannot survive a write", async () => {
    const created = await createArticle(
      articleInput({
        body: "## Safe heading\n\n<script>alert('xss')</script>\n\n[click](javascript:alert(1))\n\n[ok](https://atai.ink/docs)\n",
        title: "<b>Title</b> Clean title",
      }),
      ADMIN,
    )

    expect(created.body).not.toContain("<script")
    expect(created.body).not.toContain("javascript:")
    expect(created.body).toContain("https://atai.ink/docs")
    expect(created.title).toBe("Title Clean title")
  })
})

describe("setArticleStatus", () => {
  it("publishes a draft and stamps the publication date", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    const published = await setArticleStatus(created.id, "publish", ADMIN)

    expect(published.status).toBe("published")
    expect(published.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await publicArticles()).map((entry) => entry.slug)).toEqual([created.slug])
  })

  it("schedules an article for a future moment", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    const when = Date.now() + 3_600_000
    const scheduled = await setArticleStatus(created.id, "schedule", ADMIN, when)

    expect(scheduled.status).toBe("scheduled")
    expect(scheduled.scheduledFor).toBe(when)
    expect(await publicArticles()).toHaveLength(0)
  })

  it("refuses to schedule into the past", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    await expect(setArticleStatus(created.id, "schedule", ADMIN, Date.now() - 1)).rejects.toMatchObject({
      code: "VALIDATION",
      status: 422,
    })
  })

  it("unpublishes back to a draft and removes it from the public feed", async () => {
    const created = await createArticle(articleInput({ status: "published" }), ADMIN)
    const unpublished = await setArticleStatus(created.id, "unpublish", ADMIN)

    expect(unpublished.status).toBe("draft")
    expect(await publicArticles()).toHaveLength(0)
  })

  it("archives an article and restores it to a draft", async () => {
    const created = await createArticle(articleInput({ status: "published" }), ADMIN)
    const archived = await setArticleStatus(created.id, "archive", ADMIN)
    expect(archived.status).toBe("archived")

    const restored = await setArticleStatus(created.id, "restore", ADMIN)
    expect(restored.status).toBe("draft")
  })

  it("moves an article into review", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    const review = await setArticleStatus(created.id, "review", ADMIN)
    expect(review.status).toBe("review")
  })

  it("publishes a scheduled article automatically once its time has come", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const start = Date.now()
      vi.setSystemTime(start)
      const created = await createArticle(articleInput(), ADMIN)
      await setArticleStatus(created.id, "schedule", ADMIN, start + 60_000)

      expect(await publicArticles()).toHaveLength(0)

      vi.setSystemTime(start + 120_000)
      const published = await publicArticles()
      expect(published.map((entry) => entry.slug)).toContain(created.slug)
      expect((await getAdminArticle(created.id))?.status).toBe("published")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("duplicateArticle", () => {
  it("copies an article into a fresh draft with a non-clashing slug", async () => {
    const created = await createArticle(articleInput({ status: "published" }), ADMIN)
    const copy = await duplicateArticle(created.id, ADMIN)

    expect(copy.status).toBe("draft")
    expect(copy.slug).toBe("validate-a-business-idea-copy")
    expect(copy.title).toContain("(copy)")
    expect(copy.views).toBe(0)
    expect(copy.id).not.toBe(created.id)
  })

  it("suffixes the slug when a copy already exists", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    await duplicateArticle(created.id, ADMIN)
    const second = await duplicateArticle(created.id, ADMIN)
    expect(second.slug).toBe("validate-a-business-idea-copy-2")
  })
})

describe("deleteArticle", () => {
  it("removes the article and its revision history", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    await deleteArticle(created.id)

    expect(await getAdminArticle(created.id)).toBeNull()
    expect(await listRevisions(created.id)).toHaveLength(0)
  })

  it("rejects deleting an article that does not exist", async () => {
    await expect(deleteArticle("missing")).rejects.toMatchObject({ status: 404 })
  })
})

describe("revisions", () => {
  it("restores an earlier snapshot of the article", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    await updateArticle(created.id, articleInput({ title: "Broken edit" }), ADMIN)

    const revisions = await listRevisions(created.id)
    const beforeEdit = revisions.find((entry) => entry.note === "Before edit")!

    const restored = await restoreRevision(created.id, beforeEdit.id, ADMIN)
    expect(restored.title).toBe("How to validate a business idea")
  })

  it("rejects restoring a revision from another article", async () => {
    const first = await createArticle(articleInput(), ADMIN)
    const second = await createArticle(articleInput({ title: "Other", slug: "other-post" }), ADMIN)
    const revisions = await listRevisions(first.id)

    await expect(restoreRevision(second.id, revisions[0].id, ADMIN)).rejects.toMatchObject({ status: 404 })
  })
})

describe("redirects", () => {
  it("resolves an old public slug to the current article", async () => {
    const created = await createArticle(articleInput({ status: "published" }), ADMIN)
    await updateArticle(created.id, articleInput({ status: "published", slug: "moved-url" }), ADMIN)

    const resolution = await resolvePublicSlug("validate-a-business-idea")
    expect(resolution.kind).toBe("redirect")
    if (resolution.kind === "redirect") expect(resolution.toSlug).toBe("moved-url")
  })

  it("reports an unknown slug as missing", async () => {
    expect((await resolvePublicSlug("nope")).kind).toBe("missing")
  })

  it("refuses a redirect that points at itself", async () => {
    await expect(upsertRedirect("/blog/self", "self", ADMIN)).rejects.toMatchObject({ status: 422 })
  })

  it("refuses a redirect outside /blog/", async () => {
    await expect(upsertRedirect("/pricing", "some-post", ADMIN)).rejects.toMatchObject({ status: 422 })
  })
})

describe("categories", () => {
  it("refuses to delete a category that still has articles", async () => {
    await createArticle(articleInput(), ADMIN)
    const category = await upsertCategory({ name: "Business Building", slug: "business-building" })
    await expect(deleteCategory(category.id)).rejects.toMatchObject({ status: 409 })
  })

  it("deletes a category once no article uses it", async () => {
    const category = await upsertCategory({ name: "Guides", slug: "guides" })
    await deleteCategory(category.id)
    await expect(deleteCategory(category.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe("engagement", () => {
  it("records a view against the article and the daily stats row", async () => {
    const created = await createArticle(articleInput({ status: "published" }), ADMIN)
    await recordArticleView(created.slug)

    const article = await getAdminArticle(created.id)
    expect(article?.views).toBe(1)

    const performance = await blogPerformance(30)
    const row = performance.rows.find((entry) => entry.slug === created.slug)
    expect(row?.views).toBe(1)
  })

  it("does not count a view for an article that does not exist", async () => {
    await recordArticleView("not-a-real-slug")
    expect((await blogStats()).views).toBe(0)
  })

  it("stores a newsletter subscription once", async () => {
    const first = await subscribeNewsletter("Reader@Example.com", "blog-index")
    const second = await subscribeNewsletter("reader@example.com", "blog-index")

    expect(first.alreadySubscribed).toBe(false)
    expect(second.alreadySubscribed).toBe(true)
  })
})

describe("legacy seed fallback", () => {
  const legacyPost = {
    slug: "legacy-post",
    title: "A legacy post",
    description: "A post that still lives in markdown.",
    excerpt: "Still here.",
    date: "2026-01-01",
    tags: ["legacy"],
    body: "## Still here\n\nThe original post body.",
    readingMinutes: 1,
  }

  it("keeps the blog populated when the database is empty", async () => {
    listBlogPosts.mockReturnValue([legacyPost])
    const articles = await publicArticles()
    expect(articles).toHaveLength(1)
    expect(articles[0].slug).toBe("legacy-post")
    expect(articles[0].status).toBe("published")
  })

  it("still serves the seed on a cache hit — a warm cache must not empty the blog", async () => {
    listBlogPosts.mockReturnValue([legacyPost])

    const first = await publicArticles()
    expect(first).toHaveLength(1)

    // Second read is served from the cache; the fallback has to apply here too.
    const second = await publicArticles()
    expect(second).toHaveLength(1)
    expect(second[0].slug).toBe("legacy-post")
  })

  it("prefers the database over the seed once the database has published articles", async () => {
    listBlogPosts.mockReturnValue([legacyPost])
    await createArticle(articleInput({ status: "published" }), ADMIN)

    const articles = await publicArticles()
    expect(articles).toHaveLength(1)
    expect(articles[0].slug).toBe("validate-a-business-idea")
  })
})

describe("admin reporting", () => {
  it("counts every publication status separately", async () => {
    await createArticle(articleInput({ status: "published" }), ADMIN)
    await createArticle(articleInput({ title: "Draft one", slug: "draft-one" }), ADMIN)
    await createArticle(articleInput({ title: "Review one", slug: "review-one", status: "review" }), ADMIN)

    const stats = await blogStats()
    expect(stats.total).toBe(3)
    expect(stats.published).toBe(1)
    expect(stats.drafts).toBe(1)
    expect(stats.review).toBe(1)
  })

  it("filters the admin list by status", async () => {
    await createArticle(articleInput({ status: "published" }), ADMIN)
    await createArticle(articleInput({ title: "Draft one", slug: "draft-one" }), ADMIN)

    const drafts = await listAdminArticles({ status: "draft" })
    expect(drafts).toHaveLength(1)
    expect(drafts[0].slug).toBe("draft-one")
  })

  it("audits a single article and the whole set", async () => {
    const created = await createArticle(articleInput(), ADMIN)
    expect((await auditOne(created.id)).articleId).toBe(created.id)
    expect(await auditAll()).toHaveLength(1)
  })
})
