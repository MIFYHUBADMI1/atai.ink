import { describe, expect, it } from "vitest"

import {
  buildSlugRedirect,
  canTransition,
  dueScheduledArticles,
  normalizeRedirectPath,
  resolveRedirect,
  transitionError,
  validateSchedule,
} from "@/lib/blog/logic"
import type { BlogArticleDoc } from "@/lib/blog/types"

function scheduled(overrides: Partial<BlogArticleDoc> = {}): BlogArticleDoc {
  return {
    id: "a1",
    slug: "a-slug",
    title: "A title",
    description: "A description",
    excerpt: "An excerpt",
    body: "Body",
    category: "business-building",
    tags: [],
    author: { name: "Atai Team" },
    seo: {},
    status: "scheduled",
    featured: false,
    relatedSlugs: [],
    publishedAt: "2026-01-01",
    updatedAt: "2026-01-01",
    readingMinutes: 1,
    views: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdBy: "admin",
    updatedBy: "admin",
    ...overrides,
  }
}

describe("status transitions", () => {
  it("allows the documented publishing path", () => {
    expect(canTransition("draft", "review")).toBe(true)
    expect(canTransition("review", "published")).toBe(true)
    expect(canTransition("scheduled", "published")).toBe(true)
    expect(canTransition("published", "draft")).toBe(true)
    expect(canTransition("archived", "draft")).toBe(true)
  })

  it("refuses a transition that would skip the editorial workflow", () => {
    expect(canTransition("draft", "archived")).toBe(true)
    expect(canTransition("scheduled", "review")).toBe(false)
    expect(canTransition("published", "scheduled")).toBe(false)
    expect(canTransition("archived", "review")).toBe(false)
  })

  it("treats a no-op transition as allowed", () => {
    expect(canTransition("draft", "draft")).toBe(true)
    expect(transitionError("draft", "draft")).toBeNull()
  })

  it("explains a refused transition", () => {
    expect(transitionError("published", "review")).toContain("published")
    expect(transitionError("published", "review")).toContain("review")
  })
})

describe("scheduling", () => {
  it("requires a future timestamp", () => {
    expect(validateSchedule("scheduled", Date.now() + 60_000, Date.now())).toBeNull()
    expect(validateSchedule("scheduled", Date.now() - 1, Date.now())).toContain("future")
    expect(validateSchedule("scheduled", undefined, Date.now())).toContain("date")
  })

  it("does not apply the scheduling rules to other statuses", () => {
    expect(validateSchedule("draft", undefined, Date.now())).toBeNull()
    expect(validateSchedule("published", Date.now() - 100_000, Date.now())).toBeNull()
  })

  it("selects only the scheduled articles whose time has come", () => {
    const now = 1_000_000
    const docs = [
      scheduled({ id: "due", scheduledFor: now - 1 }),
      scheduled({ id: "later", scheduledFor: now + 1 }),
      scheduled({ id: "not-scheduled", status: "draft", scheduledFor: now - 1 }),
    ]
    expect(dueScheduledArticles(docs, now).map((doc) => doc.id)).toEqual(["due"])
  })
})

describe("redirects", () => {
  it("builds a permanent redirect for a changed slug", () => {
    expect(buildSlugRedirect("old-slug", "new-slug")).toEqual({ from: "/blog/old-slug", toSlug: "new-slug" })
  })

  it("creates no redirect when the slug did not change", () => {
    expect(buildSlugRedirect("same", "same")).toBeNull()
    expect(buildSlugRedirect("", "new")).toBeNull()
  })

  it("normalises a redirect path", () => {
    expect(normalizeRedirectPath("/Blog/Old-Slug/")).toBe("/blog/old-slug")
    expect(normalizeRedirectPath("blog/old-slug")).toBe("/blog/old-slug")
  })

  it("resolves a single hop to the target slug", () => {
    const result = resolveRedirect("/blog/old", [{ from: "/blog/old", toSlug: "new" }])
    expect(result).toEqual({ toSlug: "new", loop: false })
  })

  it("follows a chain to the final slug", () => {
    const result = resolveRedirect("/blog/a", [
      { from: "/blog/a", toSlug: "b" },
      { from: "/blog/b", toSlug: "c" },
    ])
    expect(result.toSlug).toBe("c")
  })

  it("cuts a loop instead of redirecting forever", () => {
    const result = resolveRedirect("/blog/a", [
      { from: "/blog/a", toSlug: "b" },
      { from: "/blog/b", toSlug: "a" },
    ])
    expect(result.loop).toBe(true)
    expect(result.toSlug).toBeNull()
  })

  it("reports no redirect when the path is unknown", () => {
    expect(resolveRedirect("/blog/unknown", [])).toEqual({ toSlug: null, loop: false })
  })
})
