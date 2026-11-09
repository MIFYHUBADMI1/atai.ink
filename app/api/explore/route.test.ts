import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression tests for the anonymous /api/explore abuse surface (audit):
 * the raw ?q was compiled straight into Mongo $regex (ReDoS + 500s) and
 * ?page was unclamped (deep-skip scans), for callers with any junk cookie.
 */

vi.mock("server-only", () => ({}))

const { mockFind, mockSkip, mockCount, mockRateLimit, mockLikesAgg, mockProjectDocs, mockUserDocs, mockUsersFind } = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}
  chain.sort = vi.fn(() => chain)
  const mockSkip = vi.fn(() => chain)
  chain.skip = mockSkip
  chain.limit = vi.fn(() => chain)
  const mockProjectDocs = vi.fn(async (): Promise<unknown[]> => [])
  chain.toArray = mockProjectDocs
  const mockFind = vi.fn(() => chain as never)
  const mockUserDocs = vi.fn(async (): Promise<unknown[]> => [])
  const mockUsersFind = vi.fn(() => ({ toArray: mockUserDocs }))
  return {
    mockFind,
    mockSkip,
    mockCount: vi.fn(async () => 0),
    mockRateLimit: vi.fn(async () => undefined),
    mockLikesAgg: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    mockProjectDocs,
    mockUserDocs,
    mockUsersFind,
  }
})

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => null),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: mockRateLimit,
}))

vi.mock("@/lib/db/collections", () => ({
  projectsCol: vi.fn(async () => ({ find: mockFind, countDocuments: mockCount })),
  usersCol: vi.fn(async () => ({ find: mockUsersFind })),
  projectLikesCol: vi.fn(async () => ({ aggregate: mockLikesAgg, find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  userFollowsCol: vi.fn(async () => ({ find: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
}))

vi.mock("@/lib/media/project-thumbnail", () => ({
  resolveProjectThumbnail: vi.fn(() => null),
}))

import { GET } from "./route"

function request(query: string) {
  return new Request(`http://localhost/api/explore${query}`)
}

describe("GET /api/explore", () => {
  beforeEach(() => {
    mockFind.mockClear()
    mockRateLimit.mockClear()
  })

  it("escapes regex metacharacters from the search term", async () => {
    const res = await GET(request("?q=(a%2B)%24*"))
    expect(res.status).toBe(200)

    const filter = (mockFind.mock.calls[0] as unknown[])[0] as {
      $or: Array<Record<"name" | "understanding.purpose" | "sourceUrl", { $regex: string }>>
    }
    const regexes = filter.$or.map((clause) => Object.values(clause)[0].$regex)
    expect(regexes).toEqual(["\\(a\\+\\)\\$\\*", "\\(a\\+\\)\\$\\*", "\\(a\\+\\)\\$\\*"])
  })

  it("caps the search length and clamps deep pagination", async () => {
    await GET(request(`?q=${"x".repeat(5000)}&page=1000000`))

    const filter = (mockFind.mock.calls[0] as unknown[])[0] as { $or: Array<{ name: { $regex: string } }> }
    expect(filter.$or[0].name.$regex).toHaveLength(100)
    // page is clamped to 500 → skip = (500-1) * 24
    expect(mockSkip).toHaveBeenCalledWith(499 * 24)
  })

  it("rate-limits anonymous searchers by client IP", async () => {
    await GET(request("?q=shop&page=1"))
    const arg = (mockRateLimit.mock.calls[0] as unknown[])[0] as { action: string; identifier: string }
    expect(arg.action).toBe("explore_search")
    expect(arg.identifier).toBe("anonymous") // no x-forwarded-for header on this request
  })

  it("does not turn caller-supplied forwarding headers into anonymous limiter keys", async () => {
    vi.stubEnv("VERCEL", "")
    vi.stubEnv("TRUSTED_PROXY_HOPS", "")
    try {
      await GET(new Request("http://localhost/api/explore", { headers: { "x-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.2" } }))
      expect(mockRateLimit).toHaveBeenCalledWith(expect.objectContaining({ identifier: "anonymous" }))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("surfaces a rate-limit rejection as an error response, not a query", async () => {
    mockRateLimit.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { code: "RATE_LIMITED", status: 429 }))
    const res = await GET(request("?q=shop"))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it("never exposes author emails to anonymous callers", async () => {
    mockProjectDocs.mockResolvedValueOnce([{
      id: "p1",
      userId: "u1",
      name: "Public project",
      mode: "idea",
      state: "ready",
      visibility: "public",
      sourceUrl: null,
      understanding: { purpose: "A shop" },
      deploymentHistory: [],
      createdAt: 1,
      updatedAt: 1,
    }])
    // Simulate the DB returning the email anyway — the projection must not
    // request it and the response must not carry it.
    mockUserDocs.mockResolvedValueOnce([{ id: "u1", name: "Owner", email: "owner@example.com", imageUrl: null }])

    const res = await GET(request(""))
    const body = await res.json() as { data: { projects: Array<{ author: Record<string, unknown> }> } }

    expect(body.data.projects[0].author).toEqual({
      id: "u1", name: "Owner", imageUrl: null, following: false, isCurrentUser: false,
    })
    expect(mockUsersFind.mock.calls[0][1]).toMatchObject({ projection: { id: 1, name: 1, imageUrl: 1 } })
    expect(JSON.stringify(body)).not.toContain("owner@example.com")
  })
})
