import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireUser, isBusinessWorkspaceEnabled } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isBusinessWorkspaceEnabled: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({ requireUser }))
vi.mock("@/lib/business/flags", () => ({ isBusinessWorkspaceEnabled }))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue({ id: "user_1" })
  isBusinessWorkspaceEnabled.mockResolvedValue(true)
})

describe("GET /api/business/access", () => {
  it("reports the caller's own access", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ enabled: true })
    expect(isBusinessWorkspaceEnabled).toHaveBeenCalledWith("user_1")
  })

  it("reports a closed rollout without a 404", async () => {
    isBusinessWorkspaceEnabled.mockResolvedValue(false)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ enabled: false })
  })

  it("requires a session", async () => {
    const { AppError } = await import("@/lib/errors")
    requireUser.mockRejectedValue(new AppError("UNAUTHORIZED"))

    const response = await GET()

    expect(response.status).toBe(401)
    expect(isBusinessWorkspaceEnabled).not.toHaveBeenCalled()
  })
})
