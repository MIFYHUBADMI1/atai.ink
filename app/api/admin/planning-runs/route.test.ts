/**
 * GET /api/admin/planning-runs — the `limit` query parameter.
 *
 * `getByUserId` / `getByProjectId` hand the limit straight to Mongo, where a
 * negative value means "no limit" and a huge value means an unbounded scan.
 * The route must clamp the caller-supplied limit for every branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { mockGetByUserId, mockGetByProjectId, mockListRecent } = vi.hoisted(() => ({
  mockGetByUserId: vi.fn().mockResolvedValue([]),
  mockGetByProjectId: vi.fn().mockResolvedValue([]),
  mockListRecent: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "admin_1", isAdmin: true })),
}))

vi.mock("@/lib/planning/tracking/planning-run", () => ({
  PlanningRunTracker: class {
    getByUserId = mockGetByUserId
    getByProjectId = mockGetByProjectId
    listRecent = mockListRecent
  },
}))

import type { NextRequest } from "next/server"

import { GET } from "./route"

function request(query: string): NextRequest {
  return new Request(`https://atai.example/api/admin/planning-runs${query}`, { method: "GET" }) as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/admin/planning-runs — limit clamping", () => {
  it("clamps a negative limit to 1 on the userId branch", async () => {
    const res = await GET(request("?userId=u1&limit=-5"))
    expect(res.status).toBe(200)
    expect(mockGetByUserId).toHaveBeenCalledWith("u1", 1)
  })

  it("clamps a negative limit to 1 on the projectId branch", async () => {
    const res = await GET(request("?projectId=p1&limit=-5"))
    expect(res.status).toBe(200)
    expect(mockGetByProjectId).toHaveBeenCalledWith("p1", 1)
  })

  it("clamps an unbounded limit to 100", async () => {
    const res = await GET(request("?userId=u1&limit=100000"))
    expect(res.status).toBe(200)
    expect(mockGetByUserId).toHaveBeenCalledWith("u1", 100)
  })

  it("falls back to 10 when the limit is not a number", async () => {
    const res = await GET(request("?userId=u1&limit=abc"))
    expect(res.status).toBe(200)
    expect(mockGetByUserId).toHaveBeenCalledWith("u1", 10)
  })

  it("passes a valid limit through unchanged", async () => {
    const res = await GET(request("?userId=u1&limit=25"))
    expect(res.status).toBe(200)
    expect(mockGetByUserId).toHaveBeenCalledWith("u1", 25)
  })

  it("clamps on the listRecent branch too", async () => {
    const res = await GET(request("?limit=-1"))
    expect(res.status).toBe(200)
    expect(mockListRecent).toHaveBeenCalledWith(1)
  })
})
