import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { mockRequireAdmin, mockGet, mockUpdate, mockClear, mockDeployment } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockClear: vi.fn(),
  mockDeployment: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireAdmin: mockRequireAdmin }))
vi.mock("@/lib/business/flags", () => ({
  getBusinessRollout: mockGet,
  updateBusinessRollout: mockUpdate,
  clearBusinessRollout: mockClear,
  deploymentRollout: mockDeployment,
}))

import type { NextRequest } from "next/server"

import { AppError } from "@/lib/errors"
import { DELETE, GET, PATCH } from "./route"

const ADMIN = { id: "admin_1", isAdmin: true }
const ROLLOUT = { mode: "internal", cohort: ["u1"], source: "admin", updatedAt: 5, updatedBy: "admin_1" }

function patch(body: unknown): NextRequest {
  return new Request("https://atai.example/api/admin/connected-business", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAdmin.mockResolvedValue(ADMIN)
  mockGet.mockResolvedValue(ROLLOUT)
  mockUpdate.mockResolvedValue(ROLLOUT)
  mockClear.mockResolvedValue({ mode: "off", cohort: [], source: "default" })
  mockDeployment.mockReturnValue({ mode: "off", cohort: [], source: "default" })
})

describe("GET /api/admin/connected-business", () => {
  it("returns the effective setting and the env fallback", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      data: { rollout: { mode: "internal" }, deployment: { mode: "off" } },
    })
  })

  it("refuses a non-admin", async () => {
    mockRequireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const res = await GET()
    expect(res.status).toBe(403)
  })
})

describe("PATCH /api/admin/connected-business", () => {
  it("saves a mode and cohort", async () => {
    const res = await PATCH(patch({ mode: "internal", cohort: ["u1", "u2"] }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({ mode: "internal", cohort: ["u1", "u2"] }, "admin_1")
  })

  it("accepts a cohort-only change, so the mode cannot flip by accident", async () => {
    const res = await PATCH(patch({ cohort: ["u3"] }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({ cohort: ["u3"] }, "admin_1")
  })

  it("rejects an unknown mode instead of silently turning the surface off", async () => {
    const res = await PATCH(patch({ mode: "everyone" }))
    expect(res.status).toBe(422)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects an empty body", async () => {
    const res = await PATCH(patch({}))
    expect(res.status).toBe(422)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects a cohort of blank ids", async () => {
    const res = await PATCH(patch({ cohort: ["   "] }))
    expect(res.status).toBe(422)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("caps the cohort size", async () => {
    const res = await PATCH(patch({ cohort: Array.from({ length: 201 }, (_, i) => `u${i}`) }))
    expect(res.status).toBe(422)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("refuses a non-admin", async () => {
    mockRequireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const res = await PATCH(patch({ mode: "all" }))
    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/admin/connected-business", () => {
  it("clears the override", async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(mockClear).toHaveBeenCalled()
  })

  it("refuses a non-admin", async () => {
    mockRequireAdmin.mockRejectedValue(new AppError("UNAUTHORIZED", "Admin access required.", 403))
    const res = await DELETE()
    expect(res.status).toBe(403)
    expect(mockClear).not.toHaveBeenCalled()
  })
})
