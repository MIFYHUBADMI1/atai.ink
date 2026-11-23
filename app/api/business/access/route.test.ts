import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireUser, businessWorkspaceAccess } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  businessWorkspaceAccess: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/business/flags", () => ({ businessWorkspaceAccess }))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: "user_1" })
  businessWorkspaceAccess.mockResolvedValue({ enabled: true, reason: "owner" })
})

describe("GET /api/business/access", () => {
  it("reports the caller's own access", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ enabled: true, reason: "owner" })
    expect(businessWorkspaceAccess).toHaveBeenCalledWith("user_1")
  })

  it("reports a closed rollout without a 404", async () => {
    businessWorkspaceAccess.mockResolvedValue({ enabled: false, reason: "off" })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ enabled: false, reason: "off" })
  })

  it("requires a session", async () => {
    const { AppError } = await import("@/lib/errors")
    requireUser.mockRejectedValue(new AppError("UNAUTHORIZED"))

    const response = await GET()

    expect(response.status).toBe(401)
    expect(businessWorkspaceAccess).not.toHaveBeenCalled()
  })
})
